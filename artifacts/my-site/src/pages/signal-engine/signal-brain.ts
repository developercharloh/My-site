// ─── Types ────────────────────────────────────────────────────────────────────

export type MarketType = 'over_under' | 'even_odd' | 'matches_differs';
export type VolatilityStatus = 'ALLOW' | 'BLOCK';

export interface Signal {
    id:             string;
    symbol:         string;
    symbolLabel:    string;
    market:         MarketType;
    direction:      string;   // e.g. 'OVER 4', 'UNDER 5', 'EVEN', 'ODD', 'MATCHES 7', 'DIFFERS 3'
    modelsAgreeing: string[];
    confidence:     number;   // 0–100
    entryPoint:     string;
    createdAt:      number;
    expiresAt:      number;   // createdAt + 120_000 ms
}

export interface MLWeights { w: number[]; b: number; }
export const initialMLWeights = (): MLWeights => ({ w: [0, 0, 0, 0, 0], b: 0 });

interface Vote { model: string; market: MarketType; direction: string; confidence: number; }

// ─── Consensus thresholds ─────────────────────────────────────────────────────
// Detection : ratio > 0.56  →  model casts a vote
// Confidence: clamp((ratio - 0.50) × 500)
//   0.56 → 30 %   0.60 → 50 %   0.62 → 60 %   0.65 → 75 %   0.70 → 100 %
// A signal fires when ≥ 3 models agree on the SAME direction AND avg conf ≥ 60 %
const MIN_AGREE = 3;
const MIN_CONF  = 60;

// ─── Math helpers ─────────────────────────────────────────────────────────────

const clamp   = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const pct     = (arr: number[], pred: (d: number) => boolean) =>
    arr.length ? arr.filter(pred).length / arr.length : 0.5;
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const conf500 = (ratio: number) => clamp((ratio - 0.50) * 500);  // calibrated confidence

function streakOf(digits: number[], pred: (d: number) => boolean): number {
    let n = 0;
    for (let i = digits.length - 1; i >= 0; i--) {
        if (pred(digits[i])) n++; else break;
    }
    return n;
}

function selectOverBarrier(digits: number[]): number {
    const n = digits.length || 1;
    for (let b = 1; b <= 7; b++) {
        if (digits.filter(d => d > b).length / n >= 0.60) return b;
    }
    return 4;
}

function selectUnderBarrier(digits: number[]): number {
    const n = digits.length || 1;
    for (let b = 8; b >= 2; b--) {
        if (digits.filter(d => d < b).length / n >= 0.60) return b;
    }
    return 5;
}

function topDigitOf(digits: number[]): number {
    const c = Array(10).fill(0) as number[];
    digits.forEach(d => c[d]++);
    return c.indexOf(Math.max(...c));
}

function leastDigitOf(digits: number[]): number {
    const c = Array(10).fill(0) as number[];
    digits.forEach(d => c[d]++);
    return c.indexOf(Math.min(...c));
}

// ─── MODEL 1 — Statistical Frequency ─────────────────────────────────────────
// Fires a vote when one category is > 56 % of the last 100 ticks.

function modelStatistical(digits: number[]): Vote[] {
    const d = digits.slice(-100);
    if (d.length < 30) return [];
    const votes: Vote[] = [];

    // Over / Under
    const highR = pct(d, x => x >= 5);
    if (highR > 0.56) {
        votes.push({ model: 'Statistical', market: 'over_under',
            direction: `OVER ${selectOverBarrier(d)}`, confidence: conf500(highR) });
    } else if (highR < 0.44) {
        votes.push({ model: 'Statistical', market: 'over_under',
            direction: `UNDER ${selectUnderBarrier(d)}`, confidence: conf500(1 - highR) });
    }

    // Even / Odd
    const evenR = pct(d, x => x % 2 === 0);
    if (evenR > 0.56) {
        votes.push({ model: 'Statistical', market: 'even_odd', direction: 'EVEN', confidence: conf500(evenR) });
    } else if (evenR < 0.44) {
        votes.push({ model: 'Statistical', market: 'even_odd', direction: 'ODD', confidence: conf500(1 - evenR) });
    }

    // Matches / Differs — dominant digit > 16 %  (baseline = 10 %)
    const cnt  = Array(10).fill(0) as number[];
    d.forEach(x => cnt[x]++);
    const maxR = Math.max(...cnt) / d.length;
    const minR = Math.min(...cnt) / d.length;

    if (maxR > 0.16) {
        // digit appearing much more than expected → MATCHES
        const conf = clamp((maxR - 0.10) * 600);
        votes.push({ model: 'Statistical', market: 'matches_differs',
            direction: `MATCHES ${topDigitOf(d)}`, confidence: conf });
    } else if (minR < 0.04) {
        // digit appearing much less → DIFFERS (avoid that digit)
        const conf = clamp((0.10 - minR) * 600);
        votes.push({ model: 'Statistical', market: 'matches_differs',
            direction: `DIFFERS ${leastDigitOf(d)}`, confidence: conf });
    }

    return votes;
}

// ─── MODEL 2 — Bayesian Probability ──────────────────────────────────────────
// Uses a symmetric Beta(4,4) prior (centred at 50 %) to smooth raw counts.

function modelBayesian(digits: number[]): Vote[] {
    const d = digits.slice(-100);
    if (d.length < 30) return [];
    const PRIOR = 4;
    const votes: Vote[] = [];

    // High / Low
    const highC = d.filter(x => x >= 5).length;
    const pHigh = (highC + PRIOR) / (d.length + 2 * PRIOR);
    if (pHigh > 0.56) {
        votes.push({ model: 'Bayesian', market: 'over_under',
            direction: `OVER ${selectOverBarrier(d)}`, confidence: conf500(pHigh) });
    } else if (pHigh < 0.44) {
        votes.push({ model: 'Bayesian', market: 'over_under',
            direction: `UNDER ${selectUnderBarrier(d)}`, confidence: conf500(1 - pHigh) });
    }

    // Even / Odd
    const evenC = d.filter(x => x % 2 === 0).length;
    const pEven = (evenC + PRIOR) / (d.length + 2 * PRIOR);
    if (pEven > 0.56) {
        votes.push({ model: 'Bayesian', market: 'even_odd', direction: 'EVEN', confidence: conf500(pEven) });
    } else if (pEven < 0.44) {
        votes.push({ model: 'Bayesian', market: 'even_odd', direction: 'ODD', confidence: conf500(1 - pEven) });
    }

    // Matches / Differs — per-digit Bayesian posterior with Beta(1,9) prior (10 % baseline)
    const DIGIT_PRIOR_A = 1, DIGIT_PRIOR_B = 9; // prior centred at 10 %
    const cnt = Array(10).fill(0) as number[];
    d.forEach(x => cnt[x]++);
    const n = d.length;

    let maxPost = 0, maxDig = -1, minPost = 1, minDig = -1;
    for (let dig = 0; dig < 10; dig++) {
        const post = (cnt[dig] + DIGIT_PRIOR_A) / (n + DIGIT_PRIOR_A + DIGIT_PRIOR_B);
        if (post > maxPost) { maxPost = post; maxDig = dig; }
        if (post < minPost) { minPost = post; minDig = dig; }
    }
    if (maxPost > 0.17 && maxDig >= 0) {
        const conf = clamp((maxPost - 0.10) * 600);
        votes.push({ model: 'Bayesian', market: 'matches_differs',
            direction: `MATCHES ${maxDig}`, confidence: conf });
    } else if (minPost < 0.04 && minDig >= 0) {
        const conf = clamp((0.10 - minPost) * 600);
        votes.push({ model: 'Bayesian', market: 'matches_differs',
            direction: `DIFFERS ${minDig}`, confidence: conf });
    }

    return votes;
}

// ─── MODEL 3 — ML Classifier (Online Logistic Regression) ────────────────────

function featuresAt(digits: number[], endIdx: number): number[] {
    const w = digits.slice(Math.max(0, endIdx - 20), endIdx);
    if (w.length < 5) return [0.5, 0.5, 0.5, 0.5, 0.5];
    const highR = pct(w, d => d >= 5);
    const evenR = pct(w, d => d % 2 === 0);
    const strk  = Math.min(streakOf(w, d => (d >= 5) === (w[w.length - 1] >= 5)) / 10, 1);
    const mean  = w.reduce((a, b) => a + b, 0) / w.length;
    const vari  = Math.min(Math.sqrt(w.reduce((a, d) => a + (d - mean) ** 2, 0) / w.length) / 3, 1);
    const cntW  = Array(10).fill(0) as number[];
    w.forEach(d => cntW[d]++);
    const freqDev = Math.max(0, Math.max(...cntW) / w.length - 0.10);
    return [highR, evenR, strk, vari, freqDev];
}

export function trainMLWeights(digits: number[], wts: MLWeights): MLWeights {
    if (digits.length < 50) return wts;
    const lr = 0.02;
    const w  = [...wts.w];
    let b    = wts.b;
    const data = digits.slice(-300);
    for (let i = 20; i < data.length; i++) {
        const feat  = featuresAt(data, i);
        const label = data[i] >= 5 ? 1 : 0;
        const z     = feat.reduce((s, f, j) => s + w[j] * f, 0) + b;
        const err   = sigmoid(z) - label;
        feat.forEach((f, j) => { w[j] -= lr * err * f; });
        b -= lr * err;
    }
    return { w, b };
}

function modelML(digits: number[], wts: MLWeights): Vote[] {
    if (digits.length < 50) return [];
    const d100 = digits.slice(-100);
    const feat = featuresAt(digits, digits.length);
    const z    = feat.reduce((s, f, j) => s + wts.w[j] * f, 0) + wts.b;
    const pHigh = sigmoid(z);
    const votes: Vote[] = [];

    if (pHigh > 0.56) {
        votes.push({ model: 'ML Classifier', market: 'over_under',
            direction: `OVER ${selectOverBarrier(d100)}`, confidence: clamp(pHigh * 100) });
    } else if (pHigh < 0.44) {
        votes.push({ model: 'ML Classifier', market: 'over_under',
            direction: `UNDER ${selectUnderBarrier(d100)}`, confidence: clamp((1 - pHigh) * 100) });
    }

    // Even/Odd: use even-ratio feature from window
    const pEven = feat[1];
    if (pEven > 0.56) {
        votes.push({ model: 'ML Classifier', market: 'even_odd', direction: 'EVEN', confidence: clamp(pEven * 100) });
    } else if (pEven < 0.44) {
        votes.push({ model: 'ML Classifier', market: 'even_odd', direction: 'ODD', confidence: clamp((1 - pEven) * 100) });
    }

    // Matches/Differs: use freq-deviation feature
    const fDev = feat[4]; // max frequency deviation from 10 %
    if (fDev > 0.08) {   // some digit > 18 % in recent window
        // Find which digit is dominant in recent 20 ticks
        const recent = digits.slice(-20);
        const cntR   = Array(10).fill(0) as number[];
        recent.forEach(d => cntR[d]++);
        const maxR = Math.max(...cntR); const topD = cntR.indexOf(maxR);
        const topRatio = maxR / recent.length;
        if (topRatio > 0.18) {
            votes.push({ model: 'ML Classifier', market: 'matches_differs',
                direction: `MATCHES ${topD}`, confidence: clamp(topRatio * 350) });
        }
    }

    return votes;
}

// ─── MODEL 4 — Streak & Pattern ───────────────────────────────────────────────

function modelStreak(digits: number[]): Vote[] {
    if (digits.length < 10) return [];
    const d30  = digits.slice(-30);
    const d100 = digits.slice(-100);
    const last = d30[d30.length - 1];
    const votes: Vote[] = [];

    // High/Low streak → reversal signal
    const hlStrk = streakOf(d30, x => (x >= 5) === (last >= 5));
    if (hlStrk >= 4) {
        if (last >= 5) {
            votes.push({ model: 'Streak/Pattern', market: 'over_under',
                direction: `UNDER ${selectUnderBarrier(d100)}`, confidence: clamp(50 + hlStrk * 7) });
        } else {
            votes.push({ model: 'Streak/Pattern', market: 'over_under',
                direction: `OVER ${selectOverBarrier(d100)}`, confidence: clamp(50 + hlStrk * 7) });
        }
    }

    // Even/Odd streak → reversal signal
    const eoStrk = streakOf(d30, x => (x % 2 === 0) === (last % 2 === 0));
    if (eoStrk >= 4) {
        votes.push({ model: 'Streak/Pattern', market: 'even_odd',
            direction: last % 2 === 0 ? 'ODD' : 'EVEN', confidence: clamp(50 + eoStrk * 7) });
    }

    // Repeating digit in last 5 → DIFFERS that digit
    const last5 = digits.slice(-5);
    if (last5.length === 5 && new Set(last5).size <= 2) {
        votes.push({ model: 'Streak/Pattern', market: 'matches_differs',
            direction: `DIFFERS ${last5[last5.length - 1]}`, confidence: 72 });
    }

    // Very mixed last 10 → MATCHES most common digit in d100
    const last10 = digits.slice(-10);
    if (last10.length === 10 && new Set(last10).size >= 9) {
        votes.push({ model: 'Streak/Pattern', market: 'matches_differs',
            direction: `MATCHES ${topDigitOf(d100)}`, confidence: 62 });
    }

    return votes;
}

// ─── MODEL 5 — Volatility Filter ─────────────────────────────────────────────

export interface VolatilityResult { status: VolatilityStatus; reason: string; }

export function modelVolatility(digits: number[], tickTimes: number[]): VolatilityResult {
    if (digits.length < 25) return { status: 'BLOCK', reason: 'Collecting data…' };

    // Chi-squared uniformity test on last 100 ticks
    const d   = digits.slice(-100);
    const cnt = Array(10).fill(0) as number[];
    d.forEach(x => cnt[x]++);
    const exp  = d.length / 10;
    const chi2 = cnt.reduce((s, c) => s + (c - exp) ** 2 / exp, 0);
    if (chi2 > 50) return { status: 'BLOCK', reason: 'Severely skewed distribution' };

    // Extreme consecutive streak (≥ 8)
    const last = digits[digits.length - 1];
    const hlStrk = streakOf(digits.slice(-30), x => (x >= 5) === (last >= 5));
    if (hlStrk >= 8) return { status: 'BLOCK', reason: `Extreme streak: ${hlStrk}` };

    // Tick timing irregularity
    if (tickTimes.length >= 5) {
        const recent = tickTimes.slice(-5);
        const gaps   = recent.slice(1).map((t, i) => t - recent[i]);
        if (Math.max(...gaps) > 8000) return { status: 'BLOCK', reason: 'Irregular tick intervals' };
    }

    return { status: 'ALLOW', reason: 'Market stable' };
}

// ─── Consensus Engine ─────────────────────────────────────────────────────────

const MARKETS: MarketType[] = ['over_under', 'even_odd', 'matches_differs'];

function buildConsensus(votes: Vote[], volStatus: VolatilityStatus) {
    if (volStatus === 'BLOCK') return [];
    const results: Array<{ market: MarketType; direction: string; models: string[]; confidence: number }> = [];

    for (const market of MARKETS) {
        const mv = votes.filter(v => v.market === market);
        const groups = new Map<string, Vote[]>();
        mv.forEach(v => {
            const g = groups.get(v.direction) ?? [];
            g.push(v);
            groups.set(v.direction, g);
        });

        let best: Vote[] = []; let bestDir = '';
        groups.forEach((vs, dir) => { if (vs.length > best.length) { best = vs; bestDir = dir; } });

        if (best.length < MIN_AGREE) continue;
        const avgConf = best.reduce((s, v) => s + v.confidence, 0) / best.length;
        if (avgConf < MIN_CONF) continue;

        results.push({ market, direction: bestDir, models: best.map(v => v.model), confidence: Math.round(avgConf) });
    }
    return results;
}

// ─── Entry Point builder ──────────────────────────────────────────────────────

function buildEntry(market: MarketType, direction: string, digits: number[]): string {
    if (market === 'over_under') {
        const b = Number(direction.split(' ')[1]);
        return direction.startsWith('OVER')
            ? `Digit must be > ${b}  (${b + 1}–9)`
            : `Digit must be < ${b}  (0–${b - 1})`;
    }
    if (market === 'even_odd') {
        const last = digits[digits.length - 1];
        const eoS  = streakOf(digits.slice(-20), x => (x % 2 === 0) === (last !== undefined ? last % 2 === 0 : true));
        return eoS >= 3 ? 'Next tick — after current streak' : 'After 3 confirming ticks';
    }
    const digit = direction.split(' ')[1];
    return direction.startsWith('MATCHES')
        ? `Entry digit: ${digit}`
        : `Avoid digit ${digit}  (any other digit wins)`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function analyzeSignals(
    digits:        number[],
    tickTimes:     number[],
    symbol:        string,
    symbolLabel:   string,
    weights:       MLWeights,
    activeMarkets: Set<MarketType>,
): Signal[] {
    if (digits.length < 50) return [];

    const allVotes: Vote[] = [
        ...modelStatistical(digits),
        ...modelBayesian(digits),
        ...modelML(digits, weights),
        ...modelStreak(digits),
    ];

    const { status: volStatus } = modelVolatility(digits, tickTimes);
    const agreed = buildConsensus(allVotes, volStatus);

    const now = Date.now();
    return agreed
        .filter(r => !activeMarkets.has(r.market))
        .map(r => ({
            id:             `sig_${now}_${r.market}`,
            symbol,
            symbolLabel,
            market:         r.market,
            direction:      r.direction,
            modelsAgreeing: r.models,
            confidence:     r.confidence,
            entryPoint:     buildEntry(r.market, r.direction, digits),
            createdAt:      now,
            expiresAt:      now + 120_000,
        }));
}
