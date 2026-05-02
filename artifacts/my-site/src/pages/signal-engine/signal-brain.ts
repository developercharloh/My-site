// ─── Types ────────────────────────────────────────────────────────────────────

export type MarketType = 'over_under' | 'even_odd' | 'matches_differs';
export type VolatilityStatus = 'ALLOW' | 'BLOCK';

export interface Signal {
    id:             string;
    symbol:         string;
    symbolLabel:    string;
    market:         MarketType;
    direction:      string;
    modelsAgreeing: string[];
    confidence:     number;
    entryPoint:     string;
    createdAt:      number;
    expiresAt:      number;
    sampleSize:     number;   // ticks used for analysis (100)
    recentScore:    number;   // agreeing ticks in last 20
    recentTotal:    number;   // always 20
}

export interface MLWeights { w: number[]; b: number; }
export const initialMLWeights = (): MLWeights => ({ w: [0, 0, 0, 0, 0], b: 0 });

interface Vote { model: string; market: MarketType; direction: string; confidence: number; }

// ─── Thresholds ───────────────────────────────────────────────────────────────
// Confidence is always relative to each barrier's EXPECTED rate.
// OVER  barriers: checked 6→1 (tightest first)
// UNDER barriers: checked 3→8 (tightest first)
//
// Per-market thresholds — matches/differs is held to a much stricter bar
// because digit-level predictions are statistically harder than parity/range.
// Over/Under and Even/Odd: fire when ≥ 3 of 5 models agree, avg conf ≥ 52 %.
// Matches/Differs:         fire when ≥ 5 of 5 models agree, avg conf ≥ 70 %.
// Recency gate: last 20 ticks must also confirm direction.
// TTL: 60 s for 1HZ* (1-second) indices, 120 s for R_* (standard) indices.
const MIN_AGREE_MAP: Record<MarketType, number> = {
    over_under:      3,
    even_odd:        3,
    matches_differs: 5,
};
const MIN_CONF_MAP: Record<MarketType, number> = {
    over_under:      52,
    even_odd:        52,
    matches_differs: 70,
};
const EDGE_PCT     = 0.06;       // 6 pp above expected = model detection threshold
const RECENCY_EDGE = 0.06;       // lowered 0.10 → 0.06 — recency gate was killing valid signals

// ─── Math helpers ─────────────────────────────────────────────────────────────

const clamp   = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function barrierConf(observed: number, expected: number): number {
    return clamp((observed - expected) * 500);
}

function streakOf(digits: number[], pred: (d: number) => boolean): number {
    let n = 0;
    for (let i = digits.length - 1; i >= 0; i--) {
        if (pred(digits[i])) n++; else break;
    }
    return n;
}

// ─── Recency check ────────────────────────────────────────────────────────────
// Verifies the pattern is still active in the last 20 ticks.
// Returns score (agreeing count), total (20), and whether it passes the gate.

interface RecencyResult { score: number; total: number; passing: boolean; }

function checkRecency(digits: number[], direction: string, market: MarketType): RecencyResult {
    const last20 = digits.slice(-20);
    const n      = last20.length;
    if (n < 10) return { score: n, total: n, passing: true }; // too few — pass through

    let agreeing: number;
    let minRequired: number;

    if (market === 'over_under') {
        const b = Number(direction.split(' ')[1]);
        if (direction.startsWith('OVER')) {
            const expected = (9 - b) / 10;
            agreeing    = last20.filter(d => d > b).length;
            minRequired = Math.ceil(n * (expected + RECENCY_EDGE));
        } else {
            const expected = b / 10;
            agreeing    = last20.filter(d => d < b).length;
            minRequired = Math.ceil(n * (expected + RECENCY_EDGE));
        }
    } else if (market === 'even_odd') {
        agreeing    = direction === 'EVEN'
            ? last20.filter(d => d % 2 === 0).length
            : last20.filter(d => d % 2 !== 0).length;
        minRequired = Math.ceil(n * (0.50 + RECENCY_EDGE));
    } else {
        // matches_differs
        const dig = Number(direction.split(' ')[1]);
        if (direction.startsWith('MATCHES')) {
            agreeing    = last20.filter(d => d === dig).length;
            minRequired = 3; // 15%+ in 20 ticks (expected 10%)
        } else {
            agreeing    = last20.filter(d => d !== dig).length;
            minRequired = Math.ceil(n * (0.90 - RECENCY_EDGE)); // ≥80% not the digit
        }
    }

    return { score: agreeing, total: n, passing: agreeing >= minRequired };
}

// ─── Barrier helpers ──────────────────────────────────────────────────────────

interface BarrierHit { barrier: number; ratio: number; conf: number; }

function bestOverBarrier(d: number[]): BarrierHit | null {
    const n = d.length || 1;
    for (let b = 6; b >= 1; b--) {
        const expected = (9 - b) / 10;
        const r        = d.filter(x => x > b).length / n;
        const conf     = barrierConf(r, expected);
        if (conf >= MIN_CONF) return { barrier: b, ratio: r, conf };
    }
    return null;
}

function bestUnderBarrier(d: number[]): BarrierHit | null {
    const n = d.length || 1;
    for (let b = 3; b <= 8; b++) {
        const expected = b / 10;
        const r        = d.filter(x => x < b).length / n;
        const conf     = barrierConf(r, expected);
        if (conf >= MIN_CONF) return { barrier: b, ratio: r, conf };
    }
    return null;
}

function bayesOverBarrier(d: number[]): BarrierHit | null {
    const n = d.length || 1;
    for (let b = 6; b >= 1; b--) {
        const expected = (9 - b) / 10;
        const PRIOR    = expected * 8;
        const rawCount = d.filter(x => x > b).length;
        const post     = (rawCount + PRIOR) / (n + 8);
        const conf     = barrierConf(post, expected);
        if (conf >= MIN_CONF) return { barrier: b, ratio: post, conf };
    }
    return null;
}

function bayesUnderBarrier(d: number[]): BarrierHit | null {
    const n = d.length || 1;
    for (let b = 3; b <= 8; b++) {
        const expected = b / 10;
        const PRIOR    = expected * 8;
        const rawCount = d.filter(x => x < b).length;
        const post     = (rawCount + PRIOR) / (n + 8);
        const conf     = barrierConf(post, expected);
        if (conf >= MIN_CONF) return { barrier: b, ratio: post, conf };
    }
    return null;
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

function modelStatistical(digits: number[]): Vote[] {
    const d = digits.slice(-100);
    if (d.length < 30) return [];
    const votes: Vote[] = [];
    const n = d.length;

    const over = bestOverBarrier(d);
    if (over) votes.push({ model: 'Statistical', market: 'over_under',
        direction: `OVER ${over.barrier}`, confidence: over.conf });

    const under = bestUnderBarrier(d);
    if (under) votes.push({ model: 'Statistical', market: 'over_under',
        direction: `UNDER ${under.barrier}`, confidence: under.conf });

    const evenR = d.filter(x => x % 2 === 0).length / n;
    if (evenR > 0.50 + EDGE_PCT)
        votes.push({ model: 'Statistical', market: 'even_odd', direction: 'EVEN', confidence: barrierConf(evenR, 0.50) });
    else if (evenR < 0.50 - EDGE_PCT)
        votes.push({ model: 'Statistical', market: 'even_odd', direction: 'ODD',  confidence: barrierConf(1 - evenR, 0.50) });

    const cnt  = Array(10).fill(0) as number[];
    d.forEach(x => cnt[x]++);
    const maxR = Math.max(...cnt) / n;
    const minR = Math.min(...cnt) / n;
    if (maxR > 0.16) votes.push({ model: 'Statistical', market: 'matches_differs',
        direction: `MATCHES ${topDigitOf(d)}`,   confidence: clamp((maxR - 0.10) * 600) });
    if (minR < 0.06) votes.push({ model: 'Statistical', market: 'matches_differs',
        direction: `DIFFERS ${leastDigitOf(d)}`, confidence: clamp((0.10 - minR) * 600) });

    return votes;
}

// ─── MODEL 2 — Bayesian Probability ──────────────────────────────────────────

function modelBayesian(digits: number[]): Vote[] {
    const d = digits.slice(-100);
    if (d.length < 30) return [];
    const n = d.length;
    const votes: Vote[] = [];

    const over = bayesOverBarrier(d);
    if (over) votes.push({ model: 'Bayesian', market: 'over_under',
        direction: `OVER ${over.barrier}`, confidence: over.conf });

    const under = bayesUnderBarrier(d);
    if (under) votes.push({ model: 'Bayesian', market: 'over_under',
        direction: `UNDER ${under.barrier}`, confidence: under.conf });

    const PRIOR_EO = 4;
    const evenC    = d.filter(x => x % 2 === 0).length;
    const pEven    = (evenC + PRIOR_EO) / (n + 2 * PRIOR_EO);
    if (pEven > 0.50 + EDGE_PCT)
        votes.push({ model: 'Bayesian', market: 'even_odd', direction: 'EVEN', confidence: barrierConf(pEven, 0.50) });
    else if (pEven < 0.50 - EDGE_PCT)
        votes.push({ model: 'Bayesian', market: 'even_odd', direction: 'ODD',  confidence: barrierConf(1 - pEven, 0.50) });

    const DIGIT_PA = 1, DIGIT_PB = 9;
    const cnt = Array(10).fill(0) as number[];
    d.forEach(x => cnt[x]++);
    let maxPost = 0, maxDig = -1, minPost = 1, minDig = -1;
    for (let dig = 0; dig < 10; dig++) {
        const post = (cnt[dig] + DIGIT_PA) / (n + DIGIT_PA + DIGIT_PB);
        if (post > maxPost) { maxPost = post; maxDig = dig; }
        if (post < minPost) { minPost = post; minDig = dig; }
    }
    if (maxPost > 0.17 && maxDig >= 0)
        votes.push({ model: 'Bayesian', market: 'matches_differs',
            direction: `MATCHES ${maxDig}`, confidence: clamp((maxPost - 0.10) * 600) });
    if (minPost < 0.06 && minDig >= 0)
        votes.push({ model: 'Bayesian', market: 'matches_differs',
            direction: `DIFFERS ${minDig}`, confidence: clamp((0.10 - minPost) * 600) });

    return votes;
}

// ─── MODEL 3 — ML Classifier (Online Logistic Regression) ────────────────────

function featuresAt(digits: number[], endIdx: number): number[] {
    const w = digits.slice(Math.max(0, endIdx - 20), endIdx);
    if (w.length < 5) return [0.5, 0.5, 0.5, 0.5, 0.5];
    const highR = w.filter(d => d >= 5).length / w.length;
    const evenR = w.filter(d => d % 2 === 0).length / w.length;
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
    const feat  = featuresAt(digits, digits.length);
    const z     = feat.reduce((s, f, j) => s + wts.w[j] * f, 0) + wts.b;
    const pHigh = sigmoid(z);
    const votes: Vote[] = [];

    if (pHigh > 0.50 + EDGE_PCT) {
        const over = bestOverBarrier(d100);
        if (over) votes.push({ model: 'ML Classifier', market: 'over_under',
            direction: `OVER ${over.barrier}`, confidence: clamp(pHigh * 100) });
    } else if (pHigh < 0.50 - EDGE_PCT) {
        const under = bestUnderBarrier(d100);
        if (under) votes.push({ model: 'ML Classifier', market: 'over_under',
            direction: `UNDER ${under.barrier}`, confidence: clamp((1 - pHigh) * 100) });
    }

    const pEven = feat[1];
    if (pEven > 0.50 + EDGE_PCT)
        votes.push({ model: 'ML Classifier', market: 'even_odd', direction: 'EVEN', confidence: clamp(pEven * 100) });
    else if (pEven < 0.50 - EDGE_PCT)
        votes.push({ model: 'ML Classifier', market: 'even_odd', direction: 'ODD',  confidence: clamp((1 - pEven) * 100) });

    const fDev = feat[4];
    if (fDev > 0.08) {
        const recent = digits.slice(-20);
        const cntR   = Array(10).fill(0) as number[];
        recent.forEach(d => cntR[d]++);
        const maxCnt = Math.max(...cntR);
        const topD   = cntR.indexOf(maxCnt);
        if (maxCnt / recent.length > 0.18)
            votes.push({ model: 'ML Classifier', market: 'matches_differs',
                direction: `MATCHES ${topD}`, confidence: clamp(maxCnt / recent.length * 350) });
    }

    // DIFFERS: if a digit appears rarely in last 100 ticks, vote to avoid it
    const cntD100 = Array(10).fill(0) as number[];
    d100.forEach(d => cntD100[d]++);
    const minCnt = Math.min(...cntD100);
    const minDig = cntD100.indexOf(minCnt);
    if (minCnt / d100.length < 0.07) {
        votes.push({ model: 'ML Classifier', market: 'matches_differs',
            direction: `DIFFERS ${minDig}`,
            confidence: clamp((0.10 - minCnt / d100.length) * 600) });
    }

    return votes;
}

// ─── MODEL 5 — Frequency Bias (wide-window distribution) ─────────────────────
// Uses a 200-tick window with a Z-score test to detect digits that are
// statistically over-represented (MATCHES) or under-represented (DIFFERS).
// Always picks the GLOBAL rarest/most-frequent digit so it converges with
// the other models on the same digit.

function modelFrequency(digits: number[]): Vote[] {
    if (digits.length < 80) return [];
    const d = digits.slice(-200);
    const n = d.length;
    const cnt = Array(10).fill(0) as number[];
    d.forEach(x => cnt[x]++);

    const expected = n / 10;
    const sigma    = Math.sqrt(n * 0.1 * 0.9); // binomial std dev

    let maxC = -1, maxD = 0;
    let minC = n + 1, minD = 0;
    for (let i = 0; i < 10; i++) {
        if (cnt[i] > maxC) { maxC = cnt[i]; maxD = i; }
        if (cnt[i] < minC) { minC = cnt[i]; minD = i; }
    }

    const votes: Vote[] = [];
    const maxZ = (maxC - expected) / sigma;
    const minZ = (expected - minC) / sigma;

    // ~1.5σ ≈ top/bottom ~7% of normal distribution — detectable bias
    if (maxZ > 1.5) {
        votes.push({ model: 'Frequency Bias', market: 'matches_differs',
            direction: `MATCHES ${maxD}`, confidence: clamp(60 + maxZ * 8) });
    }
    if (minZ > 1.5) {
        votes.push({ model: 'Frequency Bias', market: 'matches_differs',
            direction: `DIFFERS ${minD}`, confidence: clamp(60 + minZ * 8) });
    }

    // Also vote on Even/Odd if there's a strong wide-window parity bias
    const evenR = d.filter(x => x % 2 === 0).length / n;
    if (Math.abs(evenR - 0.5) > 0.07) {
        votes.push({ model: 'Frequency Bias', market: 'even_odd',
            direction: evenR > 0.5 ? 'EVEN' : 'ODD',
            confidence: barrierConf(Math.max(evenR, 1 - evenR), 0.50) });
    }

    return votes;
}

// ─── MODEL 4 — Streak & Pattern ───────────────────────────────────────────────
// Streak minimum raised from 4 → 5 for both high/low and even/odd

function modelStreak(digits: number[]): Vote[] {
    if (digits.length < 10) return [];
    const d30  = digits.slice(-30);
    const d100 = digits.slice(-100);
    const last = d30[d30.length - 1];
    const votes: Vote[] = [];

    const hlStrk = streakOf(d30, x => (x >= 5) === (last >= 5));
    if (hlStrk >= 5) {   // raised from 4 → 5
        if (last >= 5) {
            const over = bestOverBarrier(d100);
            if (over) votes.push({ model: 'Streak/Pattern', market: 'over_under',
                direction: `OVER ${over.barrier}`, confidence: clamp(50 + hlStrk * 7) });
        } else {
            const under = bestUnderBarrier(d100);
            if (under) votes.push({ model: 'Streak/Pattern', market: 'over_under',
                direction: `UNDER ${under.barrier}`, confidence: clamp(50 + hlStrk * 7) });
        }
    }

    const eoStrk = streakOf(d30, x => (x % 2 === 0) === (last % 2 === 0));
    if (eoStrk >= 5) {   // raised from 4 → 5
        votes.push({ model: 'Streak/Pattern', market: 'even_odd',
            direction: last % 2 === 0 ? 'EVEN' : 'ODD', confidence: clamp(50 + eoStrk * 7) });
    }

    const last5 = digits.slice(-5);
    if (last5.length === 5 && new Set(last5).size <= 2) {
        const cntL5 = Array(10).fill(0) as number[];
        last5.forEach(d => cntL5[d]++);
        const topL5 = cntL5.indexOf(Math.max(...cntL5));
        votes.push({ model: 'Streak/Pattern', market: 'matches_differs',
            direction: `MATCHES ${topL5}`, confidence: 72 });
    }

    const last10 = digits.slice(-10);
    if (last10.length === 10 && new Set(last10).size >= 9) {
        votes.push({ model: 'Streak/Pattern', market: 'matches_differs',
            direction: `MATCHES ${topDigitOf(d100)}`, confidence: 62 });
    }

    // DIFFERS: if a digit is absent from the last 15 ticks, vote to avoid it
    const last15 = digits.slice(-15);
    if (last15.length >= 15) {
        const cntL15 = Array(10).fill(0) as number[];
        last15.forEach(d => cntL15[d]++);
        const absent = cntL15.map((c, i) => c === 0 ? i : -1).filter(i => i >= 0);
        if (absent.length > 0) {
            // among absent digits, pick the one least frequent overall
            const cntAll = Array(10).fill(0) as number[];
            d100.forEach(d => cntAll[d]++);
            const rarest = absent.reduce((best, d) => cntAll[d] < cntAll[best] ? d : best, absent[0]);
            votes.push({ model: 'Streak/Pattern', market: 'matches_differs',
                direction: `DIFFERS ${rarest}`, confidence: 66 });
        }
    }

    return votes;
}

// ─── MODEL 5 — Volatility Filter ─────────────────────────────────────────────

export interface VolatilityResult { status: VolatilityStatus; reason: string; }

export function modelVolatility(digits: number[], tickTimes: number[]): VolatilityResult {
    if (digits.length < 25) return { status: 'BLOCK', reason: 'Collecting data…' };

    const d   = digits.slice(-100);
    const cnt = Array(10).fill(0) as number[];
    d.forEach(x => cnt[x]++);
    const exp  = d.length / 10;
    const chi2 = cnt.reduce((s, c) => s + (c - exp) ** 2 / exp, 0);
    if (chi2 > 50) return { status: 'BLOCK', reason: 'Severely skewed distribution' };

    const last   = digits[digits.length - 1];
    const hlStrk = streakOf(digits.slice(-30), x => (x >= 5) === (last >= 5));
    if (hlStrk >= 8) return { status: 'BLOCK', reason: `Extreme streak: ${hlStrk}` };

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
        const mv         = votes.filter(v => v.market === market);
        const minAgree   = MIN_AGREE_MAP[market];
        const minConf    = MIN_CONF_MAP[market];

        if (market === 'over_under') {
            for (const prefix of ['OVER', 'UNDER'] as const) {
                const group = mv.filter(v => v.direction.startsWith(prefix));
                if (group.length < minAgree) continue;
                const dirCounts = new Map<string, Vote[]>();
                group.forEach(v => {
                    const arr = dirCounts.get(v.direction) ?? [];
                    arr.push(v);
                    dirCounts.set(v.direction, arr);
                });
                let best: Vote[] = []; let bestDir = '';
                dirCounts.forEach((vs, dir) => {
                    if (vs.length > best.length || (vs.length === best.length && dir > bestDir)) {
                        best = vs; bestDir = dir;
                    }
                });
                if (best.length < minAgree) {
                    best    = group;
                    bestDir = [...dirCounts.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? group[0].direction;
                }
                const avgConf = group.reduce((s, v) => s + v.confidence, 0) / group.length;
                if (avgConf < minConf) continue;
                results.push({ market, direction: bestDir, models: group.map(v => v.model), confidence: Math.round(avgConf) });
            }
            continue;
        }

        if (market === 'matches_differs') {
            // Split into MATCHES vs DIFFERS prefixes (just like OVER/UNDER), then
            // within each prefix find the digit most models converged on. This
            // lets DIFFERS actually fire even when models pick slightly different
            // rare digits, by counting per-digit consensus inside the prefix.
            for (const prefix of ['MATCHES', 'DIFFERS'] as const) {
                const group = mv.filter(v => v.direction.startsWith(prefix));
                if (group.length < minAgree) continue;
                const digCounts = new Map<string, Vote[]>();
                group.forEach(v => {
                    const arr = digCounts.get(v.direction) ?? [];
                    arr.push(v);
                    digCounts.set(v.direction, arr);
                });
                let best: Vote[] = []; let bestDir = '';
                digCounts.forEach((vs, dir) => {
                    if (vs.length > best.length) { best = vs; bestDir = dir; }
                });
                // Require the consensus digit itself to have enough model agreement
                if (best.length < minAgree) continue;
                const avgConf = best.reduce((s, v) => s + v.confidence, 0) / best.length;
                if (avgConf < minConf) continue;
                results.push({ market, direction: bestDir, models: best.map(v => v.model), confidence: Math.round(avgConf) });
            }
            continue;
        }

        // even_odd
        const groups = new Map<string, Vote[]>();
        mv.forEach(v => { const g = groups.get(v.direction) ?? []; g.push(v); groups.set(v.direction, g); });
        let best: Vote[] = []; let bestDir = '';
        groups.forEach((vs, dir) => { if (vs.length > best.length) { best = vs; bestDir = dir; } });
        if (best.length < minAgree) continue;
        const avgConf = best.reduce((s, v) => s + v.confidence, 0) / best.length;
        if (avgConf < minConf) continue;
        results.push({ market, direction: bestDir, models: best.map(v => v.model), confidence: Math.round(avgConf) });
    }
    return results;
}

// ─── Entry Point builder ──────────────────────────────────────────────────────

function buildEntry(market: MarketType, direction: string, digits: number[]): string {
    if (market === 'over_under') {
        const b = Number(direction.split(' ')[1]);
        return direction.startsWith('OVER')
            ? `Last digit > ${b}  (wins on ${b + 1}–9,  ${9 - b} digits)`
            : `Last digit < ${b}  (wins on 0–${b - 1},  ${b} digits)`;
    }
    if (market === 'even_odd') {
        const d100       = digits.slice(-100);
        const parityDigs = direction === 'EVEN' ? [0, 2, 4, 6, 8] : [1, 3, 5, 7, 9];
        const cnt        = Array(10).fill(0) as number[];
        d100.forEach(d => cnt[d]++);
        const entryDig   = parityDigs.reduce((best, d) => cnt[d] > cnt[best] ? d : best, parityDigs[0]);
        return `Entry digit: ${entryDig}`;
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
        ...modelFrequency(digits),
    ];

    const { status: volStatus } = modelVolatility(digits, tickTimes);
    const agreed                = buildConsensus(allVotes, volStatus);

    // Split TTL: 60 s for 1-second indices (1HZ*), 120 s for standard (R_*)
    const ttl = symbol.startsWith('1HZ') ? 60_000 : 120_000;
    const now = Date.now();

    return agreed
        .filter(r => !activeMarkets.has(r.market))
        .map(r => {
            const rec = checkRecency(digits, r.direction, r.market);
            if (!rec.passing) return null; // pattern fading — suppress signal
            return {
                id:             `sig_${now}_${symbol}_${r.market}`,
                symbol,
                symbolLabel,
                market:         r.market,
                direction:      r.direction,
                modelsAgreeing: r.models,
                confidence:     r.confidence,
                entryPoint:     buildEntry(r.market, r.direction, digits),
                createdAt:      now,
                expiresAt:      now + ttl,
                sampleSize:     Math.min(digits.length, 100),
                recentScore:    rec.score,
                recentTotal:    rec.total,
            };
        })
        .filter((s): s is Signal => s !== null);
}
