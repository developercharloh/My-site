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
}

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
    const wsRef     = useRef<WebSocket | null>(null);
    const reqIdRef  = useRef<number>(0);

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

        // For each "entry digit" candidate, find the conditional probability
        // that the NEXT tick wins the trade. Returns top 2 by conditional %.
        const conditionalEntryDigits = (winFn: (nextDigit: number, nextPrev: number) => boolean) => {
            const cond = new Array(10).fill(0).map(() => ({ wins: 0, total: 0 }));
            for (let i = 0; i < digits.length - 1; i++) {
                const cur  = digits[i];
                const next = digits[i + 1];
                cond[cur].total += 1;
                if (winFn(next, cur)) cond[cur].wins += 1;
            }
            return cond
                .map((c, d) => ({ digit: d, conditional: c.total > 0 ? c.wins / c.total : 0, total: c.total }))
                .filter(c => c.total >= 8) // enough samples
                .sort((a, b) => b.conditional - a.conditional)
                .slice(0, 2);
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
                entryRaw  = conditionalEntryDigits(nx => nx % 2 === 0);
                rationale = `Across the last ${N} ticks of ${sym.label}, ${(probability * 100).toFixed(1)}% ended on an even digit. The market is currently biased toward EVEN.`;
            } else {
                direction = 'ODD'; contractType = 'DIGITODD'; probability = odd / N;
                entryRaw  = conditionalEntryDigits(nx => nx % 2 === 1);
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
            entryRaw      = conditionalEntryDigits(nx => nx !== rare);
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
            entryRaw     = conditionalEntryDigits(nx =>
                best.side === 'UNDER' ? nx < best.barrier : nx > best.barrier
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
                entryRaw = conditionalEntryDigits((_nx, prev) => prev !== undefined ? false : false);
            } else {
                direction = 'FALL'; contractType = 'PUT';  probability = falls / total;
            }
            // For rise/fall the "entry digit" loses its conditional meaning;
            // use the digits that most often preceded a same-direction move.
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
                .map((c, d) => ({ digit: d, conditional: c.total > 0 ? c.wins / c.total : 0, total: c.total }))
                .filter(c => c.total >= 8)
                .sort((a, b) => b.conditional - a.conditional)
                .slice(0, 2);
            rationale = `Across ${total} valid tick comparisons on ${sym.label}, the price moved ${direction === 'RISE' ? 'up' : 'down'} ${(probability * 100).toFixed(1)}% of the time — a ${direction === 'RISE' ? 'bullish' : 'bearish'} short-term bias.`;
        }

        // Pad to 2 entry digits if conditional scan returned fewer
        while (entryRaw.length < 2) {
            const used = new Set(entryRaw.map(e => e.digit));
            const fallback = freqPct
                .map((p, d) => ({ digit: d, conditional: p }))
                .filter(e => !used.has(e.digit))
                .sort((a, b) => b.conditional - a.conditional)[0];
            if (!fallback) break;
            entryRaw.push(fallback);
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
        };
    }, []);

    /* ── Launch scan ───────────────────────────────────────────────── */

    const launch = useCallback(() => {
        cleanupWs();
        setStatus('scanning');
        setSignal(null);
        setError('');
        setProgress(0);

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

        const finish = () => clearInterval(pTimer);

        const failTimer = setTimeout(() => {
            if (status !== 'ready' && wsRef.current === ws) {
                finish();
                setStatus('error');
                setError('Scan timed out — Deriv feed unreachable. Check your connection and try again.');
                cleanupWs();
            }
        }, 15000);

        ws.onopen = () => {
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
                const sig = computeSignal(rawPrices, pip, market, sym);
                finish(); clearTimeout(failTimer);
                setProgress(100);
                setSignal(sig);
                setStatus('ready');
                cleanupWs();
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
                    <div className='ai-progress'>
                        <div className='ai-progress__bar' style={{ width: `${progress}%` }} />
                        <div className='ai-progress__txt'>
                            Pulling {TICK_COUNT} live ticks from {symObj.label} and computing probabilities…
                        </div>
                    </div>
                )}
                {status === 'error' && (
                    <div className='ai-alert ai-alert--err'>⚠️ {error}</div>
                )}
            </section>

            {/* Result */}
            {status === 'ready' && signal && (
                <section className='ai-result'>
                    <div className='ai-result__head'>
                        <span className='ai-result__tag'>AI Signal</span>
                        <span className={`ai-result__exec ai-result__exec--${signal.execution}`}>
                            {signal.execution === 'bot' ? '🤖 Best run via Bot' : '✋ Trade Manually'}
                        </span>
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
