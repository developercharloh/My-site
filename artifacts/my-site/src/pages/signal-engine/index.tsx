import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, TrendingDown, ChevronDown, Wifi, WifiOff, Loader2 } from 'lucide-react';
import '../entry-zone/entry-zone.scss';
import './signal-engine.scss';
import {
    analyzeSignals, trainMLWeights, modelVolatility,
    initialMLWeights, type Signal, type MarketType, type MLWeights,
} from './signal-brain';

// ─── Constants ────────────────────────────────────────────────────────────────

const DERIV_WS    = 'wss://ws.binaryws.com/websockets/v3?app_id=1';
const TICK_HISTORY = 1000;
const SIGNAL_TTL   = 120_000; // 2 minutes

const MARKETS = [
    {
        group: 'Volatility (1s) Indices',
        items: [
            { symbol: '1HZ10V',  label: 'Volatility 10 (1s) Index'  },
            { symbol: '1HZ15V',  label: 'Volatility 15 (1s) Index'  },
            { symbol: '1HZ25V',  label: 'Volatility 25 (1s) Index'  },
            { symbol: '1HZ30V',  label: 'Volatility 30 (1s) Index'  },
            { symbol: '1HZ50V',  label: 'Volatility 50 (1s) Index'  },
            { symbol: '1HZ75V',  label: 'Volatility 75 (1s) Index'  },
            { symbol: '1HZ90V',  label: 'Volatility 90 (1s) Index'  },
            { symbol: '1HZ100V', label: 'Volatility 100 (1s) Index' },
        ],
    },
    {
        group: 'Volatility Indices',
        items: [
            { symbol: 'R_10',  label: 'Volatility 10 Index'  },
            { symbol: 'R_25',  label: 'Volatility 25 Index'  },
            { symbol: 'R_50',  label: 'Volatility 50 Index'  },
            { symbol: 'R_75',  label: 'Volatility 75 Index'  },
            { symbol: 'R_100', label: 'Volatility 100 Index' },
        ],
    },
] as const;

type MarketSymbol = typeof MARKETS[number]['items'][number]['symbol'];

// ─── Color helpers ────────────────────────────────────────────────────────────

function getRankColor(rank: number): string {
    if (rank === 1)  return '#10b981';
    if (rank === 2)  return '#0ea5e9';
    if (rank === 10) return '#ef4444';
    if (rank === 9)  return '#eab308';
    return '#64748b';
}

function getRankLabel(rank: number): string {
    if (rank === 1)  return 'Most';
    if (rank === 2)  return '2nd';
    if (rank === 10) return 'Least';
    if (rank === 9)  return '2nd↓';
    return '';
}

function computeRanks(dist: number[]): number[] {
    const indexed = dist.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
    const ranks   = new Array(10).fill(0);
    indexed.forEach(({ i }, pos) => { ranks[i] = pos + 1; });
    return ranks;
}

function circleSize(pct: number): number {
    return Math.round(28 + (pct / 20) * 16);
}

const D_COLORS = [
    '#6366f1','#8b5cf6','#0ea5e9','#10b981','#eab308',
    '#f97316','#ef4444','#ec4899','#14b8a6','#84cc16',
];

// ─── Tick WebSocket hook ──────────────────────────────────────────────────────

interface TickData {
    distribution: number[];
    liveDigit:    number | null;
    livePrice:    number | null;
    prevPrice:    number | null;
    pipSize:      number;
    tickCount:    number;
    status:       'connecting' | 'live' | 'error';
    recentDigits: number[];
    allDigits:    number[];        // full rolling buffer (up to TICK_HISTORY)
    tickTimestamps: number[];      // JS timestamps per tick (last 50)
}

const INITIAL: TickData = {
    distribution: Array(10).fill(0),
    liveDigit:    null, livePrice: null, prevPrice: null,
    pipSize: 2, tickCount: 0, status: 'connecting',
    recentDigits: [], allDigits: [], tickTimestamps: [],
};

function lastDigit(price: number, pip: number): number {
    return Math.abs(Math.round(price * Math.pow(10, pip))) % 10;
}

function buildDist(digits: number[]): number[] {
    const counts = Array(10).fill(0);
    for (const d of digits) counts[d]++;
    const n = digits.length || 1;
    return counts.map(c => Math.round((c / n) * 1000) / 10);
}

function useDerivDigits(symbol: string): TickData {
    const [data, setData]  = useState<TickData>(INITIAL);
    const wsRef            = useRef<WebSocket | null>(null);
    const symRef           = useRef(symbol); symRef.current = symbol;
    const bufRef           = useRef<number[]>([]);
    const tsRef            = useRef<number[]>([]);   // timestamps
    const pipRef           = useRef(2);

    const connect = useCallback(() => {
        if (wsRef.current) {
            const ws = wsRef.current;
            ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
            ws.close();
        }
        bufRef.current = []; tsRef.current = [];
        setData({ ...INITIAL });

        const ws = new WebSocket(DERIV_WS);
        wsRef.current = ws;

        ws.onopen = () => ws.send(JSON.stringify({
            ticks_history: symRef.current, count: TICK_HISTORY,
            end: 'latest', style: 'ticks', subscribe: 1,
        }));

        ws.onmessage = ev => {
            const msg = JSON.parse(ev.data as string);
            if (msg.error) { setData(s => ({ ...s, status: 'error' })); return; }

            if (msg.msg_type === 'history') {
                const prices: number[] = msg.history?.prices ?? [];
                const pip = msg.pip_size ?? 2; pipRef.current = pip;
                const digs = prices.map(p => lastDigit(p, pip));
                bufRef.current = digs.slice(-TICK_HISTORY);
                const now = Date.now();
                tsRef.current = digs.map((_, i) => now - (digs.length - 1 - i) * 1000).slice(-50);
                const last = prices[prices.length - 1] ?? null;
                setData({
                    distribution: buildDist(bufRef.current),
                    liveDigit:    last !== null ? lastDigit(last, pip) : null,
                    livePrice:    last, prevPrice: null, pipSize: pip,
                    tickCount:    bufRef.current.length, status: 'live',
                    recentDigits: digs.slice(-40),
                    allDigits:    [...bufRef.current],
                    tickTimestamps: [...tsRef.current],
                });
            }

            if (msg.msg_type === 'tick' && msg.tick) {
                const { quote, pip_size } = msg.tick;
                const pip = pip_size ?? pipRef.current; pipRef.current = pip;
                const dig = lastDigit(quote, pip);
                bufRef.current = [...bufRef.current.slice(-(TICK_HISTORY - 1)), dig];
                tsRef.current  = [...tsRef.current.slice(-49), Date.now()];
                setData(s => ({
                    distribution:   buildDist(bufRef.current),
                    liveDigit:      dig, livePrice: quote, prevPrice: s.livePrice,
                    pipSize:        pip, tickCount: bufRef.current.length, status: 'live',
                    recentDigits:   [...s.recentDigits.slice(-39), dig],
                    allDigits:      [...bufRef.current],
                    tickTimestamps: [...tsRef.current],
                }));
            }
        };

        ws.onerror = () => setData(s => ({ ...s, status: 'error' }));
        ws.onclose = () => { setTimeout(() => { if (symRef.current === symbol) connect(); }, 3000); };
    }, [symbol]);

    useEffect(() => {
        connect();
        return () => {
            const ws = wsRef.current;
            if (ws) { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; ws.close(); }
        };
    }, [connect]);

    return data;
}

// ─── Countdown hook ───────────────────────────────────────────────────────────

function useNow(ms = 1000): number {
    const [now, setNow] = useState(Date.now);
    useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
    return now;
}

function fmtCountdown(ms: number): string {
    if (ms <= 0) return '0:00';
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function QuadrantRow({ digits, distribution, ranks, liveDigit }: {
    digits: number[]; distribution: number[]; ranks: number[]; liveDigit: number | null;
}) {
    const circleRefs = useRef<(HTMLDivElement | null)[]>([]);
    const rowRef     = useRef<HTMLDivElement>(null);
    const [cursorX, setCursorX] = useState<number | null>(null);

    useEffect(() => {
        if (liveDigit === null) return;
        const idx = digits.indexOf(liveDigit);
        if (idx === -1) return;
        const el  = circleRefs.current[idx];
        const row = rowRef.current;
        if (!el || !row) return;
        const er = el.getBoundingClientRect(), rr = row.getBoundingClientRect();
        setCursorX(er.left - rr.left + er.width / 2);
    }, [liveDigit, digits]);

    return (
        <div className='ez-quadrant'>
            <div className='ez-cursor-layer' ref={rowRef}>
                <AnimatePresence>
                    {cursorX !== null && (
                        <motion.div className='ez-cursor'
                            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0, x: cursorX }}
                            transition={{ type: 'spring', stiffness: 500, damping: 28 }}>
                            <span className='ez-cursor__arrow'>▼</span>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
            <div className='ez-circles'>
                {digits.map((d, i) => {
                    const rank = ranks[d]; const color = getRankColor(rank);
                    const p    = distribution[d] ?? 0; const size = circleSize(p);
                    const isLive = liveDigit === d; const isHigh = rank <= 2 || rank >= 9;
                    return (
                        <div key={d} className='ez-circle-col'>
                            <div className='ez-rank-badge' style={{ color }}>{getRankLabel(rank)}</div>
                            <motion.div
                                ref={el => { circleRefs.current[i] = el; }}
                                className='ez-circle'
                                animate={{ width: size, height: size, ...(isLive ? { boxShadow: [`0 0 0px ${color}00`, `0 0 32px ${color}cc`, `0 0 12px ${color}66`], scale: [1, 1.2, 1] } : {}) }}
                                transition={{ duration: 0.45, ease: 'easeOut' }}
                                style={{ background: isHigh ? color : `${color}20`, border: `2px solid ${color}`, color: isHigh ? '#fff' : color, boxShadow: isLive ? `0 0 16px ${color}` : isHigh ? `0 0 6px ${color}44` : 'none' }}
                            >
                                {d}
                                {isLive && (
                                    <motion.div className='ez-circle__pulse'
                                        animate={{ scale: [1, 1.8], opacity: [0.5, 0] }}
                                        transition={{ duration: 0.7, ease: 'easeOut' }}
                                        style={{ background: color }} />
                                )}
                            </motion.div>
                            <div className='ez-bar-track'><motion.div className='ez-bar-fill' style={{ background: color }} animate={{ width: `${Math.min(100, p * 7)}%` }} transition={{ duration: 0.6, ease: 'easeOut' }} /></div>
                            <span className='ez-pct' style={{ color }}>{p.toFixed(1)}%</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function LivePriceDisplay({ livePrice, prevPrice, liveDigit, pipSize, status }: {
    livePrice: number | null; prevPrice: number | null;
    liveDigit: number | null; pipSize: number; status: string;
}) {
    const dir      = livePrice !== null && prevPrice !== null ? livePrice > prevPrice ? 'up' : livePrice < prevPrice ? 'down' : 'flat' : 'flat';
    const priceStr = livePrice !== null ? livePrice.toFixed(pipSize) : '—';
    const prefix   = livePrice !== null ? priceStr.slice(0, -1) : '—';
    const lastChar = liveDigit !== null ? String(liveDigit) : '—';
    const dc       = liveDigit !== null ? D_COLORS[liveDigit] : '#94a3b8';
    return (
        <div className='ez-price'>
            <div className='ez-price__status'>
                {status === 'live' ? <span className='ez-dot ez-dot--live' /> : status === 'connecting' ? <span className='ez-dot ez-dot--connecting' /> : <span className='ez-dot ez-dot--error' />}
                <span className='ez-price__status-text'>{status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Connection error'}</span>
                {dir === 'up'   && <TrendingUp   className='ez-price__arrow ez-price__arrow--up'   />}
                {dir === 'down' && <TrendingDown  className='ez-price__arrow ez-price__arrow--down' />}
            </div>
            <div className='ez-price__value'>
                <span className='ez-price__prefix'>{prefix}</span>
                <AnimatePresence mode='wait'>
                    <motion.span key={lastChar} className='ez-price__last-digit' style={{ color: dc, textShadow: `0 0 16px ${dc}80` }}
                        initial={{ y: -18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 18, opacity: 0 }} transition={{ duration: 0.2 }}>
                        {lastChar}
                    </motion.span>
                </AnimatePresence>
            </div>
        </div>
    );
}

// ─── Signal Card ──────────────────────────────────────────────────────────────

const MARKET_LABEL: Record<MarketType, string> = {
    over_under:       'OVER / UNDER',
    even_odd:         'EVEN / ODD',
    matches_differs:  'MATCH / DIFFER',
};

const MARKET_COLOR: Record<MarketType, string> = {
    over_under:       '#6366f1',
    even_odd:         '#10b981',
    matches_differs:  '#f59e0b',
};

function SignalCard({ signal, now }: { signal: Signal; now: number }) {
    const remaining = signal.expiresAt - now;
    const pct       = Math.max(0, remaining / SIGNAL_TTL);
    const color     = MARKET_COLOR[signal.market];
    const urgent    = remaining < 30_000;

    return (
        <motion.div className='se-signal-card'
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            style={{ '--sig-color': color } as React.CSSProperties}
        >
            {/* Header row */}
            <div className='se-signal-card__head'>
                <span className='se-signal-card__badge' style={{ background: `${color}22`, color }}>
                    {MARKET_LABEL[signal.market]}
                </span>
                <span className={`se-signal-card__timer ${urgent ? 'se-signal-card__timer--urgent' : ''}`}>
                    ⏱ {fmtCountdown(remaining)}
                </span>
            </div>

            {/* Direction */}
            <div className='se-signal-card__direction' style={{ color }}>
                {signal.direction}
            </div>

            {/* Symbol */}
            <div className='se-signal-card__symbol'>{signal.symbolLabel}</div>

            {/* Models */}
            <div className='se-signal-card__models'>
                {signal.modelsAgreeing.map(m => (
                    <span key={m} className='se-signal-card__model-chip'>{m}</span>
                ))}
            </div>

            {/* Confidence bar */}
            <div className='se-signal-card__conf-row'>
                <span className='se-signal-card__conf-label'>Confidence</span>
                <span className='se-signal-card__conf-val' style={{ color }}>{signal.confidence}%</span>
            </div>
            <div className='se-signal-card__conf-track'>
                <motion.div className='se-signal-card__conf-fill'
                    style={{ background: color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${signal.confidence}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                />
            </div>

            {/* Entry point */}
            <div className='se-signal-card__entry'>{signal.entryPoint}</div>

            {/* Countdown bar */}
            <div className='se-signal-card__ttl-track'>
                <motion.div className='se-signal-card__ttl-fill'
                    style={{ background: urgent ? '#ef4444' : color }}
                    animate={{ width: `${pct * 100}%` }}
                    transition={{ duration: 0.9, ease: 'linear' }}
                />
            </div>
        </motion.div>
    );
}

// ─── Volatility status badge ──────────────────────────────────────────────────

function VolBadge({ digits, tickTimes }: { digits: number[]; tickTimes: number[] }) {
    const { status, reason } = modelVolatility(digits, tickTimes);
    return (
        <div className={`se-vol-badge se-vol-badge--${status.toLowerCase()}`}>
            <span className='se-vol-badge__dot' />
            <span>{status === 'ALLOW' ? 'Market Stable' : `Blocked: ${reason}`}</span>
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

const DEFAULT_SYMBOL: MarketSymbol = '1HZ10V';

const SignalEngine = () => {
    const [symbol, setSymbol]       = useState<string>(DEFAULT_SYMBOL);
    const data                      = useDerivDigits(symbol);
    const { distribution, liveDigit, livePrice, prevPrice, pipSize, tickCount, status, allDigits, tickTimestamps } = data;
    const ranks                     = computeRanks(distribution);
    const selectedLabel             = MARKETS.flatMap(g => g.items).find(m => m.symbol === symbol)?.label ?? symbol;

    // Signal engine state
    const [signals,   setSignals]   = useState<Signal[]>([]);
    const [mlWeights, setMlWeights] = useState<MLWeights>(initialMLWeights);
    const tickCountRef              = useRef(0);
    const now                       = useNow(1000);

    // Expire stale signals every second
    useEffect(() => {
        setSignals(prev => prev.filter(s => s.expiresAt > now));
    }, [now]);

    // Run analysis on each new tick
    useEffect(() => {
        if (allDigits.length === 0) return;
        tickCountRef.current++;
        const tc = tickCountRef.current;

        // Retrain ML every 50 ticks
        if (tc % 50 === 0) {
            setMlWeights(prev => trainMLWeights(allDigits, prev));
        }

        // Analyze every 10 ticks
        if (tc % 10 !== 0) return;

        setSignals(prev => {
            const active       = prev.filter(s => s.expiresAt > Date.now());
            const activeMarkets = new Set(active.map(s => s.market)) as Set<MarketType>;
            const newSigs      = analyzeSignals(allDigits, tickTimestamps, symbol, selectedLabel, mlWeights, activeMarkets);
            return newSigs.length > 0 ? [...active, ...newSigs] : active;
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveDigit]);

    // Reset signals when symbol changes
    useEffect(() => {
        setSignals([]);
        tickCountRef.current = 0;
        setMlWeights(initialMLWeights());
    }, [symbol]);

    return (
        <div className='ez-root se-root'>
            {/* ── Header ── */}
            <div className='ez-header'>
                <div className='ez-header__title-block'>
                    <span className='ez-header__title'>Signal Engine</span>
                    <span className='ez-header__sub'>Last {tickCount} / {TICK_HISTORY} ticks · {selectedLabel}</span>
                </div>
                <div className='ez-selector'>
                    <label className='ez-selector__label'>Market</label>
                    <div className='ez-selector__wrap'>
                        <select className='ez-selector__select' value={symbol} onChange={e => setSymbol(e.target.value)}>
                            {MARKETS.map(g => (
                                <optgroup key={g.group} label={g.group}>
                                    {g.items.map(m => <option key={m.symbol} value={m.symbol}>{m.label}</option>)}
                                </optgroup>
                            ))}
                        </select>
                        <ChevronDown className='ez-selector__chevron' />
                    </div>
                </div>
            </div>

            {/* ── Live price ── */}
            <div className='ez-price-row'>
                <LivePriceDisplay livePrice={livePrice} prevPrice={prevPrice} liveDigit={liveDigit} pipSize={pipSize} status={status} />
                <div className='ez-cursor-tag'>
                    {liveDigit !== null && (
                        <>
                            <span className='ez-cursor-tag__arrow' style={{ color: '#ef4444' }}>▼</span>
                            <span className='ez-cursor-tag__label'>Digit</span>
                            <AnimatePresence mode='wait'>
                                <motion.span key={liveDigit} className='ez-cursor-tag__digit' style={{ color: D_COLORS[liveDigit] }}
                                    initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}
                                    transition={{ type: 'spring', stiffness: 500, damping: 22 }}>
                                    {liveDigit}
                                </motion.span>
                            </AnimatePresence>
                        </>
                    )}
                    {status === 'connecting' && <Loader2 className='ez-spinner' />}
                    {status === 'error'      && <WifiOff className='ez-error-icon' />}
                    {status === 'live' && liveDigit === null && <Wifi className='ez-wifi-icon' />}
                </div>
            </div>

            {/* ── Quadrants ── */}
            <div className='ez-quadrants'>
                <QuadrantRow digits={[0, 1, 2, 3, 4]} distribution={distribution} ranks={ranks} liveDigit={liveDigit} />
                <QuadrantRow digits={[5, 6, 7, 8, 9]} distribution={distribution} ranks={ranks} liveDigit={liveDigit} />
            </div>

            {/* ── Signals Card ── */}
            <div className='se-signals-card'>
                <div className='se-signals-card__header'>
                    <span className='se-signals-card__title'>⚡ Signals</span>
                    {allDigits.length > 0 && (
                        <VolBadge digits={allDigits} tickTimes={tickTimestamps} />
                    )}
                </div>
                <div className='se-signals-card__body'>
                    {signals.length === 0 ? (
                        <div className='se-signals-card__empty'>
                            <span className='se-signals-card__empty-icon'>
                                {status === 'connecting' ? '🔌' : allDigits.length < 50 ? '📡' : '🔍'}
                            </span>
                            <span className='se-signals-card__empty-text'>
                                {status === 'connecting'
                                    ? 'Connecting to market…'
                                    : allDigits.length < 50
                                    ? `Collecting data… (${allDigits.length}/50 ticks)`
                                    : 'Scanning for high-confidence signals…'}
                            </span>
                        </div>
                    ) : (
                        <AnimatePresence>
                            {signals.map(sig => (
                                <SignalCard key={sig.id} signal={sig} now={now} />
                            ))}
                        </AnimatePresence>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SignalEngine;
