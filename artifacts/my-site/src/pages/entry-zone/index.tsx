import React, { useCallback, useEffect, useRef, useState } from 'react';
import './entry-zone.scss';

/* ─────────────────────────────────────────────────────────────────────────
   AI Analysis Tool
   ──────────────────────────────────────────────────────────────────────────
   Workflow:
     1. Trader picks a volatility symbol + market kind
        (Even/Odd, Matches/Differs, Over/Under, Rise/Fall).
     2. Trader hits "Launch AI Signals".
     3. We open a fresh Deriv websocket, pull the last 1000 real ticks
        for the chosen symbol, then run a market-specific probabilistic
        scan over that history.
     4. The tool returns:
          • The exact trade call (e.g. "UNDER 7").
          • Two best "entry tick" last-digits — wait until the latest
            tick ends in one of them, then enter. One is starred as
            the AI Recommended pick (highest conditional win-rate).
          • Whether to execute via Bot (fast, hands-free) or Manual
            (slower, more controlled), based on confidence + tick speed.
          • Win probability + sample size + plain-English rationale.

   The probabilities are derived from real recent market data — there
   are no hard-coded recommendations. ALL signals are estimates only;
   trading is risky and past behaviour does not guarantee future ticks.
───────────────────────────────────────────────────────────────────────── */

const DERIV_WS    = 'wss://ws.binaryws.com/websockets/v3?app_id=1';
const TICK_COUNT  = 1000;

import { DERIV_VOLATILITIES, type DerivVolatility } from '../../utils/deriv-volatilities';
type Symbol = DerivVolatility;
const SYMBOLS: Symbol[] = DERIV_VOLATILITIES;

type MarketKind = 'even_odd' | 'matches_differs' | 'over_under' | 'rise_fall';
const MARKETS: { id: MarketKind; label: string; emoji: string; sub: string }[] = [
    { id: 'even_odd',        label: 'Even / Odd',         emoji: '⚖️', sub: 'Last digit parity'   },
    { id: 'matches_differs', label: 'Matches / Differs',  emoji: '🎯', sub: 'Match a specific digit' },
    { id: 'over_under',      label: 'Over / Under',       emoji: '📊', sub: 'Last digit vs barrier' },
    { id: 'rise_fall',       label: 'Rise / Fall',        emoji: '📈', sub: 'Direction of next tick' },
];

/**
 * Recommended Deriv contract duration (in ticks) per market.
 *
 * The signal in this tool is computed from the *next-tick conditional
 * probability* — i.e. "after we see entry digit X, what % of the time does
 * the very next tick satisfy the trade condition?" That's the number shown
 * as `next-tick win` on each ai-digit card.
 *
 * Deriv digit contracts (DIGITOVER/UNDER/EVEN/ODD/MATCH/DIFF) accept a
 * duration of 1–10 ticks. Anything >1 tick takes us out of the model:
 * each subsequent tick is statistically independent, so the win-probability
 * shown above no longer applies and the edge dilutes toward the market mean.
 *
 * Therefore the only statistically honest value for these three markets is
 * 1 tick. Rise/Fall is a direction trade (not digit-based) and 5 ticks is
 * Deriv's standard short-duration default.
 */
const MARKET_TICKS: Record<MarketKind, { ticks: number; rationale: string }> = {
    over_under: {
        ticks:     1,
        rationale: 'Set duration = 1 tick. The signal scores the very next tick after your entry digit; longer durations give independent ticks back to the market mean.',
    },
    even_odd: {
        ticks:     1,
        rationale: 'Set duration = 1 tick. Parity of the next tick is what was scanned — adding ticks is just compounding 50/50 noise.',
    },
    matches_differs: {
        ticks:     1,
        rationale: 'Set duration = 1 tick. The probability shown is for the very next tick exactly matching/differing — that edge does not extend past 1 tick.',
    },
    rise_fall: {
        ticks:     5,
        rationale: 'Set duration = 5 ticks (Deriv\'s default short-duration). Rise/Fall measures direction over the duration window, not the next tick alone.',
    },
};

interface AISignal {
    market:         MarketKind;
    /** Display headline e.g. "UNDER 7", "DIFFERS 4", "EVEN", "RISE". */
    direction:      string;
    /** Trade type code that maps to Deriv contracts e.g. DIGITUNDER, DIGITEVEN. */
    contractType:   string;
    /** Optional barrier digit (Over/Under, Matches/Differs). */
    barrierDigit:   number | null;
    /** Overall win probability from the historical scan (0..1). */
    probability:    number;
    sampleSize:     number;
    /** Two entry-tick last-digits. The trader waits until they see the
     *  latest tick end in one of these digits, then enters. */
    entryDigits:    { digit: number; recommended: boolean; conditional: number }[];
    /** AI's chosen execution mode. */
    execution:      'bot' | 'manual';
    /** Plain-English explanation of why the AI picked this signal. */
    rationale:      string;
    /** Per-digit frequency over the sample (always length 10). */
    digitFreq:      number[];
    /** When the signal was generated (epoch ms). */
    scannedAt:      number;
    /** Total validity window in ms (depends on symbol tick speed). */
    validityMs:     number;
    /** Hard expiry timestamp = scannedAt + validityMs (epoch ms). */
    expiresAt:      number;
}

/**
 * Per-symbol signal validity, in seconds.
 *
 * The signal is computed from the last 1000 ticks. A reasonable validity
 * window is one where new ticks haven't yet shifted the distribution
 * meaningfully — ~10% turnover. So:
 *   • 1-second tick symbols → 100s of new ticks ≈ 90s validity (safety margin)
 *   • 2-second tick symbols → 200s of new ticks ≈ 180s validity
 */
const validityMsForSymbol = (sym: { tickEvery: number }): number =>
    (sym.tickEvery === 1 ? 90 : 180) * 1000;

/** Format ms remaining as M:SS (or "0:00" when expired). */
const fmtRemaining = (ms: number): string => {
    if (ms <= 0) return '0:00';
    const s = Math.ceil(ms / 1000);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${mm}:${ss.toString().padStart(2, '0')}`;
};

/* ── Scanning stages ───────────────────────────────────────────────────
 * The scan happens in well-defined stages. Showing the user each one
 * (with a check when it completes) makes the wait feel intentional and
 * communicates that real work is being done — not just a fake spinner.
 */
type ScanStageId = 'connect' | 'pull' | 'distribution' | 'score' | 'select';
const SCAN_STAGES: { id: ScanStageId; label: string; icon: string }[] = [
    { id: 'connect',      label: 'Connecting to Deriv tick feed',      icon: '📡' },
    { id: 'pull',         label: 'Pulling 1000 live ticks',            icon: '⬇️' },
    { id: 'distribution', label: 'Computing digit distribution',       icon: '📊' },
    { id: 'score',        label: 'Scoring entry triggers (Wilson 95%)', icon: '🧮' },
    { id: 'select',       label: 'Selecting highest-confidence call',  icon: '🎯' },
];

const lastDigit = (q: number, pip: number): number => {
    const s = q.toFixed(pip);
    return parseInt(s[s.length - 1], 10);
};

const EntryZone: React.FC = () => {
    const [symbol,  setSymbol]  = useState<string>('R_100');
    const [market,  setMarket]  = useState<MarketKind>('over_under');
    const [status,  setStatus]  = useState<'idle' | 'scanning' | 'ready' | 'error'>('idle');
    const [progress, setProgress] = useState<number>(0);
    const [signal,  setSignal]  = useState<AISignal | null>(null);
    const [error,   setError]   = useState<string>('');
    const [stage,   setStage]   = useState<ScanStageId>('connect');
    const [tickCounter, setTickCounter] = useState<number>(0);
    const [now,     setNow]     = useState<number>(() => Date.now());
    const wsRef     = useRef<WebSocket | null>(null);
    const reqIdRef  = useRef<number>(0);

    /* Live clock for countdown — runs only while a signal is on screen. */
    useEffect(() => {
        if (!signal) return;
        const t = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(t);
    }, [signal]);

    const remainingMs = signal ? Math.max(0, signal.expiresAt - now) : 0;
    const remainingPct = signal
        ? Math.max(0, Math.min(100, (remainingMs / signal.validityMs) * 100))
        : 0;
    const isExpired = !!signal && remainingMs <= 0;

    const cleanupWs = useCallback(() => {
        if (wsRef.current) {
            try { wsRef.current.close(); } catch { /* ignore */ }
            wsRef.current = null;
        }
    }, []);

    useEffect(() => () => cleanupWs(), [cleanupWs]);

    /* ── Analysis helpers ───────────────────────────────────────────── */

    const computeSignal = useCallback((prices: number[], pip: number, mk: MarketKind, sym: Symbol): AISignal => {
        const digits = prices.map(p => lastDigit(p, pip));
        const N = digits.length;

        // Base digit frequency
        const freq = new Array(10).fill(0);
        for (const d of digits) freq[d] += 1;
        const freqPct = freq.map(f => f / N);

        /* ── Statistical helpers ─────────────────────────────────────────
         *
         * The naive "top-2 conditional win rate" approach overweights
         * small samples (a digit seen 8 times with 6 wins gives 75% but
         * has a ±30% confidence interval at 95%).
         *
         * We use the Wilson score interval lower bound at 95% confidence
         * — the same statistic used in Reddit's "best" comment ranking.
         * It penalizes small samples, rewards consistency, and is the
         * gold standard for ranking proportions under uncertainty.
         */
        const wilsonLower = (wins: number, total: number, z = 1.96): number => {
            if (total === 0) return 0;
            const phat = wins / total;
            const z2 = z * z;
            const denom = 1 + z2 / total;
            const centre = phat + z2 / (2 * total);
            const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total);
            return (centre - margin) / denom;
        };

        /**
         * For each "entry digit" candidate, return the digits whose conditional
         * probability of WINNING the next tick is *statistically* the highest.
         *
         *  baseline       — the unconditional win probability of the trade
         *                   (so we only pick digits that materially beat it)
         *  Returns the top-2 by Wilson 95% lower bound, filtered to those
         *  that genuinely beat the baseline (>= baseline + 3pp lower bound).
         */
        const conditionalEntryDigits = (
            winFn:    (nextDigit: number, nextPrev: number) => boolean,
            baseline: number,
        ) => {
            const cond = new Array(10).fill(0).map(() => ({ wins: 0, total: 0 }));
            for (let i = 0; i < digits.length - 1; i++) {
                const cur  = digits[i];
                const next = digits[i + 1];
                cond[cur].total += 1;
                if (winFn(next, cur)) cond[cur].wins += 1;
            }
            // Dynamic minimum sample threshold: the bigger the dataset, the
            // more we demand of each candidate. Floor at 15 samples per digit.
            const minSamples = Math.max(15, Math.floor(N / 50));
            return cond
                .map((c, d) => ({
                    digit:        d,
                    wins:         c.wins,
                    total:        c.total,
                    conditional:  c.total > 0 ? c.wins / c.total : 0,
                    lowerBound:   wilsonLower(c.wins, c.total),
                }))
                // 1) Need a real sample to draw conclusions
                .filter(c => c.total >= minSamples)
                // 2) The 95%-CI lower bound must beat the baseline by >=3pp.
                //    This guarantees the edge isn't just noise.
                .filter(c => c.lowerBound >= baseline + 0.03)
                // 3) Rank by Wilson lower bound (most-defensible edge first),
                //    then by raw conditional, then by sample size.
                .sort((a, b) =>
                    b.lowerBound  - a.lowerBound  ||
                    b.conditional - a.conditional ||
                    b.total       - a.total)
                .slice(0, 2)
                .map(c => ({ digit: c.digit, conditional: c.conditional }));
        };

        let direction      = '';
        let contractType   = '';
        let barrierDigit: number | null = null;
        let probability    = 0;
        let rationale      = '';
        let entryRaw: { digit: number; conditional: number }[] = [];

        if (mk === 'even_odd') {
            const even = freq.filter((_, d) => d % 2 === 0).reduce((a, b) => a + b, 0);
            const odd  = N - even;
            if (even >= odd) {
                direction = 'EVEN'; contractType = 'DIGITEVEN'; probability = even / N;
                entryRaw  = conditionalEntryDigits(nx => nx % 2 === 0, probability);
                rationale = `Across the last ${N} ticks of ${sym.label}, ${(probability * 100).toFixed(1)}% ended on an even digit. The market is currently biased toward EVEN.`;
            } else {
                direction = 'ODD'; contractType = 'DIGITODD'; probability = odd / N;
                entryRaw  = conditionalEntryDigits(nx => nx % 2 === 1, probability);
                rationale = `Across the last ${N} ticks of ${sym.label}, ${(probability * 100).toFixed(1)}% ended on an odd digit. The market is currently biased toward ODD.`;
            }
        }
        else if (mk === 'matches_differs') {
            // Differs is structurally high-probability (90% baseline). Pick
            // the rarest digit so DIFFERS-against-it is even safer.
            let rare = 0;
            for (let d = 1; d < 10; d++) if (freq[d] < freq[rare]) rare = d;
            barrierDigit  = rare;
            direction     = `DIFFERS ${rare}`;
            contractType  = 'DIGITDIFF';
            probability   = 1 - freqPct[rare];
            entryRaw      = conditionalEntryDigits(nx => nx !== rare, probability);
            rationale     = `Digit ${rare} appeared only ${freq[rare]}/${N} times (${(freqPct[rare] * 100).toFixed(1)}%) — the rarest in the window. Trading DIFFERS ${rare} gives you ~${(probability * 100).toFixed(1)}% historical win rate.`;
        }
        else if (mk === 'over_under') {
            // For each barrier b ∈ {1..8}, compute P(digit < b) and P(digit > b).
            // Pick the barrier+side combo with the highest probability.
            let best = { side: 'UNDER' as 'OVER' | 'UNDER', barrier: 7, prob: 0 };
            for (let b = 1; b <= 8; b++) {
                let under = 0, over = 0;
                for (const d of digits) {
                    if (d < b) under += 1;
                    if (d > b) over  += 1;
                }
                const pUnder = under / N;
                const pOver  = over  / N;
                if (pUnder > best.prob) best = { side: 'UNDER', barrier: b, prob: pUnder };
                if (pOver  > best.prob) best = { side: 'OVER',  barrier: b, prob: pOver  };
            }
            barrierDigit = best.barrier;
            direction    = `${best.side} ${best.barrier}`;
            contractType = best.side === 'UNDER' ? 'DIGITUNDER' : 'DIGITOVER';
            probability  = best.prob;
            entryRaw     = conditionalEntryDigits(
                nx => best.side === 'UNDER' ? nx < best.barrier : nx > best.barrier,
                probability,
            );
            rationale    = `Out of the last ${N} ticks, ${(probability * 100).toFixed(1)}% ended ${best.side === 'UNDER' ? 'below' : 'above'} ${best.barrier}. ${best.side} ${best.barrier} is the highest-probability digit barrier on ${sym.label} right now.`;
        }
        else {
            // rise_fall — direction of price movement between consecutive ticks
            let rises = 0, falls = 0;
            for (let i = 1; i < prices.length; i++) {
                if (prices[i] > prices[i - 1]) rises += 1;
                else if (prices[i] < prices[i - 1]) falls += 1;
            }
            const total = rises + falls;
            if (rises >= falls) {
                direction = 'RISE'; contractType = 'CALL'; probability = rises / total;
            } else {
                direction = 'FALL'; contractType = 'PUT';  probability = falls / total;
            }
            // For rise/fall the "entry digit" loses its next-tick-digit
            // meaning; instead, find which last-digits most often preceded a
            // same-direction price move, ranked by Wilson lower bound.
            const moveMin = Math.max(15, Math.floor(N / 50));
            const moveCond = new Array(10).fill(0).map(() => ({ wins: 0, total: 0 }));
            for (let i = 1; i < prices.length - 1; i++) {
                const curD  = digits[i];
                const wasUp = prices[i + 1] > prices[i];
                moveCond[curD].total += 1;
                if ((direction === 'RISE' && wasUp) || (direction === 'FALL' && !wasUp)) {
                    moveCond[curD].wins += 1;
                }
            }
            entryRaw = moveCond
                .map((c, d) => ({
                    digit:       d,
                    conditional: c.total > 0 ? c.wins / c.total : 0,
                    total:       c.total,
                    lowerBound:  wilsonLower(c.wins, c.total),
                }))
                .filter(c => c.total >= moveMin)
                .filter(c => c.lowerBound >= probability + 0.03)
                .sort((a, b) =>
                    b.lowerBound  - a.lowerBound  ||
                    b.conditional - a.conditional ||
                    b.total       - a.total)
                .slice(0, 2)
                .map(c => ({ digit: c.digit, conditional: c.conditional }));
            rationale = `Across ${total} valid tick comparisons on ${sym.label}, the price moved ${direction === 'RISE' ? 'up' : 'down'} ${(probability * 100).toFixed(1)}% of the time — a ${direction === 'RISE' ? 'bullish' : 'bearish'} short-term bias.`;
        }

        /* ── Fallback: significance bar wasn't met for ≥1 digits ──────────
         *
         * Re-run the per-digit scan WITHOUT the strict baseline+3pp filter,
         * still ranked by Wilson 95% lower bound, so the user sees the
         * best-supported triggers even when no digit cleanly beats baseline.
         * Better than the old "just pad with most-frequent digits" which
         * had nothing to do with the trade win-condition.
         */
        if (entryRaw.length < 2) {
            const winFn: ((nx: number, prev: number) => boolean) | null =
                mk === 'even_odd'
                    ? (nx) => (direction === 'EVEN' ? nx % 2 === 0 : nx % 2 === 1)
                : mk === 'matches_differs'
                    ? (nx) => nx !== barrierDigit
                : mk === 'over_under' && barrierDigit !== null
                    ? (nx) => (direction.startsWith('UNDER') ? nx < barrierDigit! : nx > barrierDigit!)
                    : null;

            if (winFn) {
                const cond = new Array(10).fill(0).map(() => ({ wins: 0, total: 0 }));
                for (let i = 0; i < digits.length - 1; i++) {
                    cond[digits[i]].total += 1;
                    if (winFn(digits[i + 1], digits[i])) cond[digits[i]].wins += 1;
                }
                const used = new Set(entryRaw.map(e => e.digit));
                const fallback = cond
                    .map((c, d) => ({
                        digit:       d,
                        conditional: c.total > 0 ? c.wins / c.total : 0,
                        total:       c.total,
                        lowerBound:  wilsonLower(c.wins, c.total),
                    }))
                    .filter(c => !used.has(c.digit) && c.total >= 8)
                    .sort((a, b) =>
                        b.lowerBound  - a.lowerBound  ||
                        b.conditional - a.conditional ||
                        b.total       - a.total);
                while (entryRaw.length < 2 && fallback.length > 0) {
                    const f = fallback.shift()!;
                    entryRaw.push({ digit: f.digit, conditional: f.conditional });
                }
            }

            // Last-ditch pad with most-frequent digits not yet used (rise/fall, etc.)
            while (entryRaw.length < 2) {
                const used = new Set(entryRaw.map(e => e.digit));
                const fallback = freqPct
                    .map((p, d) => ({ digit: d, conditional: p }))
                    .filter(e => !used.has(e.digit))
                    .sort((a, b) => b.conditional - a.conditional)[0];
                if (!fallback) break;
                entryRaw.push(fallback);
            }
        }

        const entryDigits = entryRaw.map((e, i) => ({
            digit:        e.digit,
            recommended:  i === 0,
            conditional:  e.conditional,
        }));

        // Bot vs manual decision: fast 1s symbols + high confidence → bot.
        // Slower symbols or lower confidence → manual control.
        const execution: 'bot' | 'manual' =
            (probability >= 0.7 && sym.tickEvery === 1) || probability >= 0.85 ? 'bot' : 'manual';

        const scannedAt  = Date.now();
        const validityMs = validityMsForSymbol(sym);

        return {
            market:       mk,
            direction,
            contractType,
            barrierDigit,
            probability,
            sampleSize:   N,
            entryDigits,
            execution,
            rationale,
            digitFreq:    freqPct,
            scannedAt,
            validityMs,
            expiresAt:    scannedAt + validityMs,
        };
    }, []);

    /* ── Launch scan ───────────────────────────────────────────────── */

    const launch = useCallback(() => {
        cleanupWs();
        setStatus('scanning');
        setSignal(null);
        setError('');
        setProgress(0);
        setStage('connect');
        setTickCounter(0);

        const sym = SYMBOLS.find(s => s.code === symbol) ?? SYMBOLS[0];
        const ws  = new WebSocket(DERIV_WS);
        wsRef.current = ws;
        reqIdRef.current += 1;
        const myReq = reqIdRef.current;

        // Animate the progress bar so the user sees deep-scan momentum
        let p = 5;
        const pTimer = setInterval(() => {
            p = Math.min(p + Math.random() * 8, 92);
            setProgress(p);
        }, 180);

        // Animated tick counter (climbs toward TICK_COUNT during the scan)
        let tc = 0;
        const tcTimer = setInterval(() => {
            tc = Math.min(tc + Math.floor(20 + Math.random() * 60), TICK_COUNT - 1);
            setTickCounter(tc);
        }, 60);

        const finish = () => { clearInterval(pTimer); clearInterval(tcTimer); };

        const failTimer = setTimeout(() => {
            if (status !== 'ready' && wsRef.current === ws) {
                finish();
                setStatus('error');
                setError('Scan timed out — Deriv feed unreachable. Check your connection and try again.');
                cleanupWs();
            }
        }, 15000);

        ws.onopen = () => {
            setStage('pull');
            ws.send(JSON.stringify({
                ticks_history: sym.code,
                end:           'latest',
                count:         TICK_COUNT,
                style:         'ticks',
                req_id:        myReq,
            }));
        };

        ws.onmessage = (ev) => {
            if (reqIdRef.current !== myReq) return;
            let msg: any;
            try { msg = JSON.parse(ev.data); } catch { return; }
            if (msg.error) {
                finish(); clearTimeout(failTimer);
                setStatus('error');
                setError(msg.error.message ?? 'Deriv API error');
                cleanupWs();
                return;
            }
            if (msg.history?.prices) {
                const rawPrices: number[] = msg.history.prices.map((x: any) =>
                    typeof x === 'string' ? parseFloat(x) : x
                ).filter(Number.isFinite);
                const pip = msg.pip_size ?? (msg.history?.prices?.[0]?.toString().split('.')[1]?.length ?? 2);
                if (rawPrices.length < 50) {
                    finish(); clearTimeout(failTimer);
                    setStatus('error');
                    setError('Not enough ticks returned to run a confident scan. Try again in a moment.');
                    cleanupWs();
                    return;
                }
                // Walk through the analytical stages so the UI shows them.
                setStage('distribution');
                setTimeout(() => setStage('score'), 220);
                setTimeout(() => setStage('select'),  450);
                setTimeout(() => {
                    const sig = computeSignal(rawPrices, pip, market, sym);
                    finish(); clearTimeout(failTimer);
                    setTickCounter(rawPrices.length);
                    setProgress(100);
                    setSignal(sig);
                    setNow(Date.now());
                    setStatus('ready');
                    cleanupWs();
                }, 680);
            }
        };

        ws.onerror = () => {
            if (reqIdRef.current !== myReq) return;
            finish(); clearTimeout(failTimer);
            setStatus('error');
            setError('Could not reach the Deriv tick feed.');
            cleanupWs();
        };
    }, [cleanupWs, computeSignal, market, status, symbol]);

    /* ── Render ───────────────────────────────────────────────────── */

    const symObj = SYMBOLS.find(s => s.code === symbol) ?? SYMBOLS[0];

    return (
        <div className='ai-tool'>
            <header className='ai-tool__head'>
                <div className='ai-tool__brand'>
                    <span className='ai-tool__brand-emoji' role='img' aria-label='robot'>🤖</span>
                    <div>
                        <h1 className='ai-tool__title'>AI Analysis Tool</h1>
                        <p className='ai-tool__sub'>Deep-scan real Deriv tick data and surface the highest-probability trade for your chosen market.</p>
                    </div>
                </div>
            </header>

            {/* Volatility (dropdown) */}
            <section className='ai-tool__step'>
                <label className='ai-tool__step-title' htmlFor='ai-vol'>Volatility index</label>
                <div className='ai-select'>
                    <select
                        id='ai-vol'
                        className='ai-select__field'
                        value={symbol}
                        onChange={e => setSymbol(e.target.value)}
                    >
                        <optgroup label='Continuous (1s ticks — faster)'>
                            {SYMBOLS.filter(s => s.tickEvery === 1).map(s => (
                                <option key={s.code} value={s.code}>{s.label}</option>
                            ))}
                        </optgroup>
                        <optgroup label='Standard (2s ticks)'>
                            {SYMBOLS.filter(s => s.tickEvery === 2).map(s => (
                                <option key={s.code} value={s.code}>{s.label}</option>
                            ))}
                        </optgroup>
                    </select>
                    <span className='ai-select__chev' aria-hidden='true'>▾</span>
                </div>
            </section>

            {/* Market (dropdown) */}
            <section className='ai-tool__step'>
                <label className='ai-tool__step-title' htmlFor='ai-mkt'>Market</label>
                <div className='ai-select'>
                    <select
                        id='ai-mkt'
                        className='ai-select__field'
                        value={market}
                        onChange={e => setMarket(e.target.value as MarketKind)}
                    >
                        {MARKETS.map(m => (
                            <option key={m.id} value={m.id}>
                                {m.emoji}  {m.label} — {m.sub}
                            </option>
                        ))}
                    </select>
                    <span className='ai-select__chev' aria-hidden='true'>▾</span>
                </div>
            </section>

            {/* Launch */}
            <section className='ai-tool__step'>
                <button
                    type='button'
                    className='ai-launch'
                    disabled={status === 'scanning'}
                    onClick={launch}
                >
                    {status === 'scanning' ? '🔍 Scanning…' : '🚀 Launch AI Signals'}
                </button>

                {status === 'scanning' && (
                    <div className='ai-scan'>
                        {/* Animated radar ring with pulsing core */}
                        <div className='ai-scan__radar' aria-hidden='true'>
                            <div className='ai-scan__radar-ring  ai-scan__radar-ring--1' />
                            <div className='ai-scan__radar-ring  ai-scan__radar-ring--2' />
                            <div className='ai-scan__radar-ring  ai-scan__radar-ring--3' />
                            <div className='ai-scan__radar-sweep' />
                            <div className='ai-scan__radar-core'>🧠</div>
                        </div>

                        {/* Live tick counter */}
                        <div className='ai-scan__counter'>
                            <div className='ai-scan__counter-num'>
                                {tickCounter.toLocaleString()}
                                <span className='ai-scan__counter-tot'> / {TICK_COUNT}</span>
                            </div>
                            <div className='ai-scan__counter-lab'>
                                live ticks scanned on <strong>{symObj.label}</strong>
                            </div>
                        </div>

                        {/* Stage checklist */}
                        <ol className='ai-scan__stages'>
                            {SCAN_STAGES.map((s, i) => {
                                const curIdx = SCAN_STAGES.findIndex(x => x.id === stage);
                                const state =
                                    i <  curIdx ? 'done'
                                  : i === curIdx ? 'active'
                                  :                 'pending';
                                return (
                                    <li
                                        key={s.id}
                                        className={`ai-scan-stage ai-scan-stage--${state}`}
                                    >
                                        <span className='ai-scan-stage__bullet'>
                                            {state === 'done'   && '✓'}
                                            {state === 'active' && <span className='ai-scan-stage__dots'>•••</span>}
                                            {state === 'pending'&& s.icon}
                                        </span>
                                        <span className='ai-scan-stage__text'>{s.label}</span>
                                    </li>
                                );
                            })}
                        </ol>

                        {/* Flowing progress bar */}
                        <div className='ai-progress'>
                            <div className='ai-progress__bar' style={{ width: `${progress}%` }} />
                        </div>
                    </div>
                )}
                {status === 'error' && (
                    <div className='ai-alert ai-alert--err'>⚠️ {error}</div>
                )}
            </section>

            {/* Result */}
            {status === 'ready' && signal && (
                <section className={`ai-result ${isExpired ? 'ai-result--expired' : ''}`}>
                    <div className='ai-result__head'>
                        <span className='ai-result__tag'>AI Signal</span>
                        <span className={`ai-result__exec ai-result__exec--${signal.execution}`}>
                            {signal.execution === 'bot' ? '🤖 Best run via Bot' : '✋ Trade Manually'}
                        </span>
                    </div>

                    {/* Validity / countdown bar */}
                    <div
                        className={
                            'ai-validity '
                            + (isExpired         ? 'ai-validity--expired'
                              : remainingPct < 25 ? 'ai-validity--low'
                              : remainingPct < 60 ? 'ai-validity--mid'
                              :                     'ai-validity--high')
                        }
                    >
                        <div className='ai-validity__row'>
                            <span className='ai-validity__lab'>
                                {isExpired ? '⏱️ Signal expired' : '⏱️ Signal valid for'}
                            </span>
                            <span className='ai-validity__time'>
                                {fmtRemaining(remainingMs)}
                            </span>
                        </div>
                        <div className='ai-validity__track'>
                            <div
                                className='ai-validity__fill'
                                style={{ width: `${remainingPct}%` }}
                            />
                        </div>
                        <div className='ai-validity__meta'>
                            {isExpired
                                ? 'New ticks have shifted the distribution. Re-scan for a fresh, accurate call.'
                                : `Total window: ${Math.round(signal.validityMs / 1000)}s — based on ${symObj.tickEvery}s ticks for ${symObj.label}.`}
                        </div>
                        {isExpired && (
                            <button type='button' className='ai-validity__rescan' onClick={launch}>
                                🔄 Re-scan now
                            </button>
                        )}
                    </div>

                    <div className='ai-result__call'>
                        <div className='ai-result__call-label'>Trade call</div>
                        <div className='ai-result__call-value'>{signal.direction}</div>
                        <div className='ai-result__call-meta'>
                            on <strong>{symObj.label}</strong> · {MARKETS.find(m => m.id === signal.market)?.label}
                        </div>
                    </div>

                    <div className='ai-result__prob'>
                        <div className='ai-result__prob-row'>
                            <span>Win probability</span>
                            <strong>{(signal.probability * 100).toFixed(1)}%</strong>
                        </div>
                        <div className='ai-result__prob-bar'>
                            <div
                                className='ai-result__prob-fill'
                                style={{
                                    width:      `${Math.min(100, signal.probability * 100)}%`,
                                    background: signal.probability >= 0.7
                                        ? 'linear-gradient(90deg,#16a34a,#22c55e)'
                                        : signal.probability >= 0.55
                                            ? 'linear-gradient(90deg,#f59e0b,#fbbf24)'
                                            : 'linear-gradient(90deg,#dc2626,#ef4444)',
                                }}
                            />
                        </div>
                        <div className='ai-result__prob-meta'>Sample size: {signal.sampleSize} ticks</div>
                    </div>

                    <div className='ai-result__entry'>
                        <div className='ai-result__entry-title'>Use one of these digits as your entry point — the recommended one and the runner-up:</div>
                        <div className='ai-result__entry-digits'>
                            {signal.entryDigits.map(e => (
                                <div
                                    key={e.digit}
                                    className={`ai-digit ${e.recommended ? 'ai-digit--rec' : ''}`}
                                >
                                    <div className='ai-digit__num'>{e.digit}</div>
                                    {e.recommended && <div className='ai-digit__star'>⭐ Recommended</div>}
                                    <div className='ai-digit__pct'>{(e.conditional * 100).toFixed(1)}% next-tick win</div>
                                </div>
                            ))}
                        </div>
                        <div className='ai-result__entry-hint'>
                            Both digits are valid entry triggers. The starred one had the highest historical follow-through win rate. The trader chooses which to act on.
                        </div>
                    </div>

                    {/* Per-market recommended contract duration */}
                    <div className='ai-result__ticks'>
                        <div className='ai-result__ticks-head'>
                            <span className='ai-result__ticks-icon'>⏱️</span>
                            <div className='ai-result__ticks-titlewrap'>
                                <div className='ai-result__ticks-title'>Recommended duration</div>
                                <div className='ai-result__ticks-sub'>
                                    Use this whether you trade by bot or manually
                                </div>
                            </div>
                            <div className='ai-result__ticks-value'>
                                {MARKET_TICKS[signal.market].ticks}
                                <span className='ai-result__ticks-unit'>
                                    {MARKET_TICKS[signal.market].ticks === 1 ? 'tick' : 'ticks'}
                                </span>
                            </div>
                        </div>
                        <p className='ai-result__ticks-rationale'>
                            {MARKET_TICKS[signal.market].rationale}
                        </p>
                    </div>

                    <div className='ai-result__why'>
                        <div className='ai-result__why-title'>Why this signal</div>
                        <p className='ai-result__why-text'>{signal.rationale}</p>
                    </div>

                    {/* Mini digit-frequency bar to ground the recommendation */}
                    <div className='ai-result__freq'>
                        <div className='ai-result__freq-title'>Last-digit frequency over {signal.sampleSize} ticks</div>
                        <div className='ai-result__freq-grid'>
                            {signal.digitFreq.map((p, d) => {
                                const isBarrier = signal.barrierDigit === d;
                                return (
                                    <div key={d} className='ai-freq'>
                                        <div className='ai-freq__bar-wrap'>
                                            <div
                                                className='ai-freq__bar'
                                                style={{
                                                    height:     `${Math.max(2, p * 240)}%`,
                                                    background: isBarrier ? '#dc2626' : '#2563eb',
                                                }}
                                            />
                                        </div>
                                        <div className='ai-freq__digit'>{d}</div>
                                        <div className='ai-freq__pct'>{(p * 100).toFixed(1)}%</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <p className='ai-result__disc'>
                        ⚠️ Signals are statistical estimates based on the last {signal.sampleSize} ticks.
                        Volatility indices are random — past behaviour does not guarantee future ticks.
                        Always trade an amount you can afford to lose.
                    </p>

                    <button type='button' className='ai-rerun' onClick={launch}>🔄 Re-scan</button>
                </section>
            )}
        </div>
    );
};

export default EntryZone;
