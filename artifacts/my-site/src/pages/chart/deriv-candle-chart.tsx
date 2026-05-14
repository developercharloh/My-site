import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import {
    DERIV_CONTINUOUS_VOLATILITIES,
    DERIV_STANDARD_VOLATILITIES,
} from '@/utils/deriv-volatilities';
import './deriv-candle-chart.scss';

interface Candle { epoch: number; open: number; high: number; low: number; close: number; }

const GRANULARITIES = [
    { label: '1m',  value: 60      },
    { label: '5m',  value: 300     },
    { label: '15m', value: 900     },
    { label: '1h',  value: 3600    },
    { label: '4h',  value: 14400   },
    { label: '1D',  value: 86400   },
];

const SYM_GROUPS = [
    { label: 'Continuous (1s)', items: DERIV_CONTINUOUS_VOLATILITIES },
    { label: 'Standard (2s)',   items: DERIV_STANDARD_VOLATILITIES   },
];

const PAD = { top: 20, right: 62, bottom: 32, left: 4 };
const MAX_CANDLES = 120;

function fp(n: number): string {
    return n < 10 ? n.toFixed(4) : n < 100 ? n.toFixed(3) : n.toFixed(2);
}
function ft(epoch: number, gran: number): string {
    const d = new Date(epoch * 1000);
    if (gran >= 86400) return `${d.getMonth() + 1}/${d.getDate()}`;
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    return gran >= 3600 ? `${hh}:00` : `${hh}:${mm}`;
}

interface Size { w: number; h: number; }

const DerivCandleChart: React.FC = () => {
    const [symbol,      setSymbol]      = useState('1HZ100V');
    const [granularity, setGranularity] = useState(60);
    const [candles,     setCandles]     = useState<Candle[]>([]);
    const [size,        setSize]        = useState<Size>({ w: 600, h: 400 });
    const [loading,     setLoading]     = useState(true);
    const [error,       setError]       = useState<string | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const subIdRef     = useRef<string | null>(null);
    const msgSubRef    = useRef<{ unsubscribe: () => void } | null>(null);
    const reqBase      = useRef((Math.floor(Date.now() / 1000) % 50000) * 1000);
    const reqCtr       = useRef(0);
    const myIds        = useRef(new Set<number>());

    const nextId = useCallback(() => {
        const id = reqBase.current + (++reqCtr.current);
        myIds.current.add(id);
        return id;
    }, []);

    const rawSend = useCallback((msg: Record<string, unknown>) => {
        try { (api_base.api as any)?.send(msg); } catch { /* ignore */ }
    }, []);

    const forget = useCallback((subId: string | null) => {
        if (subId) rawSend({ forget: subId });
    }, [rawSend]);

    const subscribe = useCallback(() => {
        if (!(api_base.api as any)) return;
        setLoading(true);
        setError(null);
        setCandles([]);
        forget(subIdRef.current);
        subIdRef.current = null;
        rawSend({
            req_id:           nextId(),
            ticks_history:    symbol,
            adjust_start_time: 1,
            count:            MAX_CANDLES,
            end:              'latest',
            granularity,
            style:            'candles',
            subscribe:        1,
        });
    }, [symbol, granularity, nextId, rawSend, forget]);

    useEffect(() => {
        if (!(api_base.api as any)) return;
        msgSubRef.current?.unsubscribe();
        msgSubRef.current = (api_base.api as any).onMessage().subscribe((raw: any) => {
            const msg = raw?.data ?? raw;
            if (!msg) return;
            const reqId = msg?.req_id as number | undefined;
            const subId = msg?.subscription?.id as string | undefined;
            const mine  = (reqId !== undefined && myIds.current.has(reqId)) ||
                          (subId !== undefined && subId === subIdRef.current);
            if (!mine) return;

            if (msg.error) {
                setError(msg.error.message ?? 'API error');
                setLoading(false);
                return;
            }

            if (msg.msg_type === 'candles') {
                if (subId && !subIdRef.current) subIdRef.current = subId;
                const raw_candles: Array<any> = msg.candles ?? [];
                setCandles(raw_candles.map(c => ({
                    epoch: c.epoch,
                    open:  parseFloat(c.open),
                    high:  parseFloat(c.high),
                    low:   parseFloat(c.low),
                    close: parseFloat(c.close),
                })));
                setLoading(false);
            }

            if (msg.msg_type === 'ohlc') {
                const o = msg.ohlc;
                if (!o) return;
                const updated: Candle = {
                    epoch: o.open_time,
                    open:  parseFloat(o.open),
                    high:  parseFloat(o.high),
                    low:   parseFloat(o.low),
                    close: parseFloat(o.close),
                };
                setCandles(prev => {
                    if (!prev.length) return [updated];
                    const last = prev[prev.length - 1];
                    if (last.epoch === updated.epoch) {
                        const copy = prev.slice();
                        copy[copy.length - 1] = updated;
                        return copy;
                    }
                    return [...prev.slice(-MAX_CANDLES + 1), updated];
                });
            }
        });

        subscribe();

        return () => {
            msgSubRef.current?.unsubscribe();
            forget(subIdRef.current);
            subIdRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol, granularity]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(entries => {
            const e = entries[0];
            if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height });
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const renderChart = () => {
        if (!candles.length) return null;
        const { w, h } = size;
        const chartW = w - PAD.left - PAD.right;
        const chartH = h - PAD.top  - PAD.bottom;
        if (chartW <= 0 || chartH <= 0) return null;

        const visible = candles.slice(-Math.floor(chartW / 6));
        const count   = visible.length;
        if (!count) return null;

        const allHigh  = visible.map(c => c.high);
        const allLow   = visible.map(c => c.low);
        const priceMin = Math.min(...allLow);
        const priceMax = Math.max(...allHigh);
        const priceRange = priceMax - priceMin || 1;
        const pricePad   = priceRange * 0.05;
        const pMin = priceMin - pricePad;
        const pMax = priceMax + pricePad;
        const pRange = pMax - pMin;

        const toY = (p: number) => PAD.top + chartH - ((p - pMin) / pRange) * chartH;

        const candleW    = chartW / count;
        const bodyW      = Math.max(1, candleW * (1 - 0.25) - 1);
        const halfBodyW  = bodyW / 2;

        const priceSteps = 6;
        const stepVal    = pRange / priceSteps;
        const priceLabels = Array.from({ length: priceSteps + 1 }, (_, i) => pMin + i * stepVal);

        const timeStep = Math.max(1, Math.floor(count / 6));
        const timeLabels = visible
            .map((c, i) => ({ i, label: ft(c.epoch, granularity) }))
            .filter((_, i) => i % timeStep === 0);

        return (
            <svg width={w} height={h} className='dchart__svg'>
                {/* Grid lines */}
                {priceLabels.map((p, i) => (
                    <line key={i}
                        x1={PAD.left} y1={toY(p)}
                        x2={PAD.left + chartW} y2={toY(p)}
                        stroke='rgba(148,163,184,0.12)' strokeWidth={1}
                    />
                ))}

                {/* Candles */}
                {visible.map((c, i) => {
                    const cx      = PAD.left + (i + 0.5) * candleW;
                    const isUp    = c.close >= c.open;
                    const bodyTop = toY(Math.max(c.open, c.close));
                    const bodyBot = toY(Math.min(c.open, c.close));
                    const bodyH   = Math.max(1, bodyBot - bodyTop);
                    const fill    = isUp ? '#10b981' : '#ef4444';
                    const wick    = isUp ? '#059669' : '#dc2626';
                    return (
                        <g key={c.epoch}>
                            <line
                                x1={cx} y1={toY(c.high)}
                                x2={cx} y2={toY(c.low)}
                                stroke={wick} strokeWidth={1}
                            />
                            <rect
                                x={cx - halfBodyW} y={bodyTop}
                                width={bodyW} height={bodyH}
                                fill={fill} rx={1}
                            />
                        </g>
                    );
                })}

                {/* Price axis labels */}
                {priceLabels.map((p, i) => (
                    <text key={i}
                        x={PAD.left + chartW + 4} y={toY(p) + 4}
                        fontSize={10} fill='#94a3b8' textAnchor='start'
                        fontFamily='SF Mono, Menlo, monospace'
                    >
                        {fp(p)}
                    </text>
                ))}

                {/* Time axis labels */}
                {timeLabels.map(({ i, label }) => (
                    <text key={i}
                        x={PAD.left + (i + 0.5) * candleW} y={h - 6}
                        fontSize={10} fill='#94a3b8' textAnchor='middle'
                        fontFamily='SF Mono, Menlo, monospace'
                    >
                        {label}
                    </text>
                ))}

                {/* Live price line */}
                {(() => {
                    const last = visible[visible.length - 1];
                    if (!last) return null;
                    const y = toY(last.close);
                    const isUp = last.close >= last.open;
                    return (
                        <>
                            <line
                                x1={PAD.left} y1={y} x2={PAD.left + chartW} y2={y}
                                stroke={isUp ? '#10b981' : '#ef4444'}
                                strokeWidth={1} strokeDasharray='3 3' opacity={0.7}
                            />
                            <rect
                                x={PAD.left + chartW + 1} y={y - 9}
                                width={57} height={18}
                                fill={isUp ? '#10b981' : '#ef4444'}
                                rx={3}
                            />
                            <text
                                x={PAD.left + chartW + 30} y={y + 4}
                                fontSize={10} fill='#fff' textAnchor='middle'
                                fontFamily='SF Mono, Menlo, monospace' fontWeight='700'
                            >
                                {fp(last.close)}
                            </text>
                        </>
                    );
                })()}
            </svg>
        );
    };

    return (
        <div className='dchart'>
            {/* ── Control bar ─────────────────────────────────────────────── */}
            <div className='dchart__bar'>
                <select
                    className='dchart__sym-select'
                    value={symbol}
                    onChange={e => setSymbol(e.target.value)}
                >
                    {SYM_GROUPS.map(g => (
                        <optgroup key={g.label} label={g.label}>
                            {g.items.map(v => (
                                <option key={v.code} value={v.code}>{v.label}</option>
                            ))}
                        </optgroup>
                    ))}
                </select>
                <div className='dchart__gran-row'>
                    {GRANULARITIES.map(g => (
                        <button
                            key={g.value}
                            className={`dchart__gran-btn ${granularity === g.value ? 'dchart__gran-btn--active' : ''}`}
                            onClick={() => setGranularity(g.value)}
                        >
                            {g.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Chart area ──────────────────────────────────────────────── */}
            <div className='dchart__canvas' ref={containerRef}>
                {loading ? (
                    <div className='dchart__overlay'>
                        <span className='dchart__spinner' />
                        <span>Loading {symbol} candles…</span>
                    </div>
                ) : error ? (
                    <div className='dchart__overlay dchart__overlay--error'>
                        <span>⚠️</span>
                        <span>{error}</span>
                        <button className='dchart__retry' onClick={subscribe}>Retry</button>
                    </div>
                ) : (
                    renderChart()
                )}
            </div>
        </div>
    );
};

export default DerivCandleChart;
