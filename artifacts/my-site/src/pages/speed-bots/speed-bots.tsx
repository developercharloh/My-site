import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { apolloEngine, ApolloSettings, DEFAULT_SETTINGS, ScanResult } from './apollo-engine';
import './speed-bots.scss';

const DollarFlowBot = lazy(() => import('./dollar-flow-bot'));
const OUBot         = lazy(() => import('./ou-bot'));
const TriBot        = lazy(() => import('./tri-bot'));

const SYMBOLS = [
    { value: '1HZ10V', label: 'Volatility 10 (1s) Index' },
    { value: '1HZ15V', label: 'Volatility 15 (1s) Index' },
    { value: '1HZ25V', label: 'Volatility 25 (1s) Index' },
    { value: '1HZ30V', label: 'Volatility 30 (1s) Index' },
    { value: '1HZ50V', label: 'Volatility 50 (1s) Index' },
    { value: '1HZ75V', label: 'Volatility 75 (1s) Index' },
    { value: '1HZ90V', label: 'Volatility 90 (1s) Index' },
    { value: '1HZ100V', label: 'Volatility 100 (1s) Index' },
    { value: 'R_10', label: 'Volatility 10 Index' },
    { value: 'R_25', label: 'Volatility 25 Index' },
    { value: 'R_50', label: 'Volatility 50 Index' },
    { value: 'R_75', label: 'Volatility 75 Index' },
    { value: 'R_100', label: 'Volatility 100 Index' },
];

type TxFilter = 'all' | 'real' | 'virtual' | 'wins' | 'losses';
type JournalFilter = 'all' | 'info' | 'success' | 'warn' | 'error';
type Theme = 'light' | 'dark';

const THEME_KEY = 'apollo_theme';
// Persist whether the trader has opened the bot at least once. The first
// visit (and any visit after they explicitly close it) shows a launcher
// card; subsequent visits jump straight back into the engine UI so they
// don't have to click through every time.
const BOT_OPEN_KEY = 'apollo_bot_open';

// Tiny SVG sparkline of last digits (each digit normalised to 0..9 → y position).
const TickSparkline: React.FC<{ digits: number[]; width?: number; height?: number }> = ({
    digits,
    width = 160,
    height = 36,
}) => {
    if (digits.length < 2) return null;
    const xStep = width / (digits.length - 1);
    const points = digits
        .map((d, i) => `${(i * xStep).toFixed(1)},${(height - (d / 9) * height).toFixed(1)}`)
        .join(' ');
    const last = digits[digits.length - 1];
    const lastY = height - (last / 9) * height;
    return (
        <svg className='sb-spark' width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
            <polyline points={points} fill='none' stroke='currentColor' strokeWidth='1.6' />
            <circle cx={width} cy={lastY} r='2.5' fill='currentColor' />
        </svg>
    );
};

const typeKey = (t: string) => {
    if (t === 'DIGITOVER') return 'over';
    if (t === 'DIGITUNDER') return 'under';
    if (t === 'DIGITEVEN') return 'even';
    if (t === 'DIGITODD') return 'odd';
    if (t === 'DIGITMATCH') return 'match';
    if (t === 'DIGITDIFF') return 'diff';
    return 'other';
};

const typeShort = (t: string) => {
    if (t === 'DIGITOVER') return '↑';
    if (t === 'DIGITUNDER') return '↓';
    if (t === 'DIGITEVEN') return 'E';
    if (t === 'DIGITODD') return 'O';
    if (t === 'DIGITMATCH') return '=';
    if (t === 'DIGITDIFF') return '≠';
    return '•';
};

const useEngineState = () => {
    const [, setTick] = useState(0);
    useEffect(() => apolloEngine.subscribe(() => setTick(t => t + 1)), []);
    return apolloEngine;
};

const STRATEGIES = {
    vh: {
        icon: '🎯',
        title: 'Over Under Virtual Hook Pro',
        desc: 'Live Digit Over/Under bot — pick your direction & barrier, scan all 13 volatilities for the strongest market, and start with a 9-second countdown. Built-in Virtual Hook Martingale recovery, smart filters, circuit breaker and rapid-fire mode.',
        features: [
            '⚡ 13-market volatility scanner',
            '🛡️ Virtual Hook Martingale recovery',
            '⏱ 9-second pre-trade countdown',
            '🚦 Circuit breaker & smart filters',
        ],
    },
    df: {
        icon: '💵',
        title: 'Dollar Flow Bot',
        desc: 'High-frequency tick-based bot with a dual-market system. Configure Market 1 for primary trading and Market 2 for recovery — supports Over/Under, Even/Odd, Rise/Fall, Matches/Differs, Asian and more. Full martingale, TP/SL, cooldown and consecutive-trade controls.',
        features: [
            '🎯 7 contract families (12 types)',
            '🔄 M1 + M2 dual-market recovery system',
            '📊 Martingale on M2 only (with cap)',
            '⏸ Cooldown & consecutive-trade limits',
        ],
    },
    ou: {
        icon: '🔄',
        title: 'Over 2 / Under 7 Reversal Patterns',
        desc: 'Watches the last 2 digits on Volatility 25 Index. Trades Over 2 when the digit is ≤ 2, or Under 7 when the digit is ≥ 7. Martingale recovery on loss with configurable win-count take profit.',
        features: [
            '🔄 Over 2 / Under 7 reversal entry',
            '📊 Martingale recovery on loss (3.5×)',
            '🎯 Win-count take profit',
            '🛑 Configurable stop loss ($30)',
        ],
    },
    tri: {
        icon: '⚡',
        title: 'Tri-Market Simultaneous Bot',
        desc: 'Fires trades on 3 independent markets at the same tick — Over/Under, Matches/Differs, Rise/Fall or Higher/Lower. Each market has its own martingale, cooldown pause, and max stake cap. Global TP/SL stops all markets together.',
        features: [
            '🔀 3 markets fire simultaneously on every tick',
            '📊 Per-market martingale with cap',
            '⏸ Per-market cooldown after loss streak',
            '🎯 Global Take Profit / Stop Loss',
        ],
    },
} as const;
type StrategyKey = keyof typeof STRATEGIES;

type BotKey = 'vh' | 'df' | 'ou' | 'tri';

const BOT_PILLS: { key: BotKey; icon: string; label: string; badge: string }[] = [
    { key: 'vh',  icon: '🎯', label: 'VH Pro',      badge: '★ LIVE' },
    { key: 'df',  icon: '💵', label: 'Dollar Flow',  badge: '★ NEW' },
    { key: 'ou',  icon: '🔄', label: 'O2U7',         badge: '⚡' },
    { key: 'tri', icon: '⚡', label: 'Tri-Market',   badge: '🔀 NEW' },
];

const BotLauncherCard: React.FC<{ onOpenVH: () => void; onOpenDF: () => void; onOpenOU: () => void; onOpenTri: () => void }> = ({ onOpenVH, onOpenDF, onOpenOU, onOpenTri }) => {
    const [strategyOpen, setStrategyOpen] = React.useState<StrategyKey | null>(null);
    const [selected, setSelected] = React.useState<BotKey>('vh');

    const strat = strategyOpen ? STRATEGIES[strategyOpen] : null;
    const openInfo = (e: React.MouseEvent, key: StrategyKey) => { e.stopPropagation(); setStrategyOpen(key); };

    const openFns: Record<BotKey, () => void> = {
        vh: onOpenVH, df: onOpenDF, ou: onOpenOU, tri: onOpenTri,
    };

    return (
        <div className='sb-launcher'>
            {strat && (
                <div className='sb-strategy-overlay' onClick={() => setStrategyOpen(null)}>
                    <div className='sb-strategy-modal' onClick={e => e.stopPropagation()}>
                        <div className='sb-strategy-modal__head'>
                            <span className='sb-strategy-modal__icon'>{strat.icon}</span>
                            <span className='sb-strategy-modal__title'>{strat.title}</span>
                            <button className='sb-strategy-modal__close' onClick={() => setStrategyOpen(null)}>✕ Close</button>
                        </div>
                        <p className='sb-strategy-modal__desc'>{strat.desc}</p>
                        <ul className='sb-strategy-modal__features'>
                            {strat.features.map(f => <li key={f}>{f}</li>)}
                        </ul>
                    </div>
                </div>
            )}

            <h2 className='sb-launcher__hub-title'>⚡ Speed Bots</h2>

            {/* ── Horizontal pill selector ───────────────────── */}
            <div className='sb-pill-strip'>
                {BOT_PILLS.map(p => (
                    <button
                        key={p.key}
                        className={`sb-pill sb-pill--${p.key} ${selected === p.key ? 'sb-pill--active' : ''}`}
                        onClick={() => setSelected(p.key)}
                    >
                        <span className='sb-pill__icon'>{p.icon}</span>
                        <span className='sb-pill__label'>{p.label}</span>
                        {selected === p.key && <span className='sb-pill__dot' />}
                    </button>
                ))}
            </div>

            {/* ── Single selected bot card ───────────────────── */}
            {selected === 'vh' && (
                <div className='sb-launcher__card sb-launcher__card--single'>
                    <span className='sb-launcher__ribbon'>★ LIVE</span>
                    <div className='sb-launcher__head'>
                        <span className='sb-launcher__icon'>🎯</span>
                        <span className='sb-launcher__chip'>Live Bot</span>
                    </div>
                    <h2 className='sb-launcher__title'>Over Under Virtual Hook Pro 📈📉</h2>
                    <div className='sb-launcher__info-row'>
                        <button className='sb-launcher__info-btn' onClick={e => openInfo(e, 'vh')}>
                            <span className='sb-launcher__info-icon'>ℹ️</span> Strategy &amp; Logic
                        </button>
                    </div>
                    <button className='sb-launcher__btn' onClick={openFns.vh}>
                        <span>▶ Open Bot</span>
                        <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <path d='M5 12h14M12 5l7 7-7 7' />
                        </svg>
                    </button>
                </div>
            )}

            {selected === 'df' && (
                <div className='sb-launcher__card sb-launcher__card--df sb-launcher__card--single'>
                    <span className='sb-launcher__ribbon sb-launcher__ribbon--df'>★ NEW</span>
                    <div className='sb-launcher__head'>
                        <span className='sb-launcher__icon'>💵</span>
                        <span className='sb-launcher__chip sb-launcher__chip--df'>Speed Bot</span>
                    </div>
                    <h2 className='sb-launcher__title'>Dollar Flow Bot 💰📊</h2>
                    <div className='sb-launcher__info-row'>
                        <button className='sb-launcher__info-btn' onClick={e => openInfo(e, 'df')}>
                            <span className='sb-launcher__info-icon'>ℹ️</span> Strategy &amp; Logic
                        </button>
                    </div>
                    <button className='sb-launcher__btn sb-launcher__btn--df' onClick={openFns.df}>
                        <span>▶ Open Bot</span>
                        <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <path d='M5 12h14M12 5l7 7-7 7' />
                        </svg>
                    </button>
                </div>
            )}

            {selected === 'ou' && (
                <div className='sb-launcher__card sb-launcher__card--ou sb-launcher__card--single'>
                    <span className='sb-launcher__ribbon sb-launcher__ribbon--ou'>⚡ SPEED BOT</span>
                    <div className='sb-launcher__head'>
                        <span className='sb-launcher__icon'>🔄</span>
                        <span className='sb-launcher__chip sb-launcher__chip--ou'>Pattern Engine</span>
                    </div>
                    <h2 className='sb-launcher__title'>Over 2 / Under 7 Reversal 📈📉</h2>
                    <div className='sb-launcher__info-row'>
                        <button className='sb-launcher__info-btn' onClick={e => openInfo(e, 'ou')}>
                            <span className='sb-launcher__info-icon'>ℹ️</span> Strategy &amp; Logic
                        </button>
                    </div>
                    <button className='sb-launcher__btn sb-launcher__btn--ou' onClick={openFns.ou}>
                        <span>▶ Open Bot</span>
                        <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <path d='M5 12h14M12 5l7 7-7 7' />
                        </svg>
                    </button>
                </div>
            )}

            {selected === 'tri' && (
                <div className='sb-launcher__card sb-launcher__card--tri sb-launcher__card--single'>
                    <span className='sb-launcher__ribbon sb-launcher__ribbon--tri'>🔀 NEW</span>
                    <div className='sb-launcher__head'>
                        <span className='sb-launcher__icon'>⚡</span>
                        <span className='sb-launcher__chip sb-launcher__chip--tri'>3-Market Engine</span>
                    </div>
                    <h2 className='sb-launcher__title'>Tri-Market Simultaneous Bot 🔀📊</h2>
                    <div className='sb-launcher__info-row'>
                        <button className='sb-launcher__info-btn' onClick={e => openInfo(e, 'tri')}>
                            <span className='sb-launcher__info-icon'>ℹ️</span> Strategy &amp; Logic
                        </button>
                    </div>
                    <button className='sb-launcher__btn sb-launcher__btn--tri' onClick={openFns.tri}>
                        <span>▶ Open Bot</span>
                        <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                            <path d='M5 12h14M12 5l7 7-7 7' />
                        </svg>
                    </button>
                </div>
            )}
        </div>
    );
};

const SpeedBots: React.FC = () => {
    const engine = useEngineState();
    // Always start on the launcher card on every page load.
    const [botOpen, setBotOpen] = useState<'none' | 'vh' | 'df' | 'ou' | 'tri'>('none');
    React.useEffect(() => {
        try { window.localStorage.removeItem(BOT_OPEN_KEY); } catch {}
    }, []);
    const openBot = () => setBotOpen('vh');
    const closeBot = () => setBotOpen('none');
    const [txFilter, setTxFilter] = useState<TxFilter>('all');
    const [journalFilter, setJournalFilter] = useState<JournalFilter>('all');
    const [settings, setSettings] = useState<ApolloSettings>(engine.settings);
    const [scanning, setScanning] = useState(false);
    const [scanResults, setScanResults] = useState<ScanResult[] | null>(null);
    // Countdown popup state — when set, an overlay over the scan modal
    // ticks "Get ready in Xs" with a Cancel button. When the timer hits 0
    // the modal swaps to a "Save & Run" confirmation; the bot only fires
    // the first contract once the trader explicitly clicks Save & Run.
    const [countdown, setCountdown] = useState<{ result: ScanResult; seconds: number } | null>(null);
    const COUNTDOWN_START = 9;
    const runScan = async () => {
        if (scanning) return;
        setScanning(true);
        try {
            const results = await engine.scanVolatilities(SYMBOLS);
            setScanResults(results);
        } finally {
            setScanning(false);
        }
    };
    const applyScanPick = (r: ScanResult) => {
        engine.applyScanResult(r);
        // Sync local settings state so the Symbol field in the volatility
        // banner immediately reflects the picked market.
        setSettings(engine.settings);
        setScanResults(null);
    };
    const startCountdown = (r: ScanResult) => {
        setScanResults(null);
        setCountdown({ result: r, seconds: COUNTDOWN_START });
    };
    const cancelCountdown = () => setCountdown(null);
    // Save & Run: applies the picked setup and fires the FIRST contract
    // immediately. Only callable once the countdown has reached 0 (the
    // button is the trader's explicit confirmation to start trading).
    const saveAndRun = async () => {
        if (!countdown) return;
        const r = countdown.result;
        setCountdown(null);
        engine.applyScanResult(r);
        setSettings(engine.settings);
        setScanResults(null);
        await new Promise(res => setTimeout(res, 50));
        if (!engine.is_running) {
            await engine.start();
        }
    };
    // Tick the countdown 1 second at a time. When it reaches 0 the timer
    // STOPS — we do NOT auto-start the bot. Instead the modal swaps to a
    // "Save & Run" confirmation that the trader must click to fire the
    // first contract. Cleared when state goes back to null.
    useEffect(() => {
        if (!countdown) return;
        if (countdown.seconds <= 0) return; // hold at 0, await user click
        const t = setTimeout(() => {
            setCountdown(c => (c ? { ...c, seconds: c.seconds - 1 } : null));
        }, 1000);
        return () => clearTimeout(t);
    }, [countdown]);
    const [theme, setTheme] = useState<Theme>(() => {
        if (typeof window === 'undefined') return 'light';
        return (window.localStorage.getItem(THEME_KEY) as Theme) || 'light';
    });

    useEffect(() => {
        engine.updateSettings(settings);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settings]);

    useEffect(() => {
        try {
            window.localStorage.setItem(THEME_KEY, theme);
        } catch {
            /* ignore */
        }
    }, [theme]);

    const update = <K extends keyof ApolloSettings>(key: K, value: ApolloSettings[K]) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const reset = () => setSettings({ ...DEFAULT_SETTINGS });

    const filteredTransactions = useMemo(() => {
        const txs = engine.transactions;
        if (txFilter === 'real') return txs.filter(t => !t.is_virtual);
        if (txFilter === 'virtual') return txs.filter(t => t.is_virtual);
        if (txFilter === 'wins') return txs.filter(t => t.status === 'won');
        if (txFilter === 'losses') return txs.filter(t => t.status === 'lost');
        return txs;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine.transactions, txFilter]);

    const filteredJournal = useMemo(() => {
        if (journalFilter === 'all') return engine.journal;
        return engine.journal.filter(j => j.type === journalFilter);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine.journal, journalFilter]);

    const profitClass = engine.total_profit > 0 ? 'pos' : engine.total_profit < 0 ? 'neg' : '';
    const vPlClass = engine.virtual_pl > 0 ? 'pos' : engine.virtual_pl < 0 ? 'neg' : '';
    const symbolLabel = SYMBOLS.find(s => s.value === settings.symbol)?.label ?? settings.symbol;

    const realTxs = engine.transactions.filter(t => !t.is_virtual);
    const realStake = realTxs.reduce((acc, t) => acc + t.buy_price, 0);
    const realPayout = realTxs.reduce((acc, t) => acc + t.payout, 0);
    const realCount = realTxs.length;

    const runningById = useMemo(() => {
        const map = new Map<string, number>();
        let running = 0;
        for (let i = engine.transactions.length - 1; i >= 0; i--) {
            const t = engine.transactions[i];
            if (!t.is_virtual) running = Number((running + t.profit).toFixed(2));
            map.set(t.id, running);
        }
        return map;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [engine.transactions]);

    const evenPct = engine.evenPercentage();
    const oddPct = engine.oddPercentage();

    const event = engine.last_event;

    if (botOpen === 'none') {
        return (
            <div className={`speed-bots speed-bots--${theme}`}>
                <BotLauncherCard
                    onOpenVH={openBot}
                    onOpenDF={() => setBotOpen('df')}
                    onOpenOU={() => setBotOpen('ou')}
                    onOpenTri={() => setBotOpen('tri')}
                />
            </div>
        );
    }

    if (botOpen === 'df') {
        return (
            <Suspense fallback={<div className={`speed-bots speed-bots--${theme}`}><div className='sb-empty'>Loading…</div></div>}>
                <DollarFlowBot onBack={() => setBotOpen('none')} />
            </Suspense>
        );
    }

    if (botOpen === 'ou') {
        return (
            <Suspense fallback={<div className={`speed-bots speed-bots--${theme}`}><div className='sb-empty'>Loading…</div></div>}>
                <OUBot onBack={() => setBotOpen('none')} />
            </Suspense>
        );
    }

    if (botOpen === 'tri') {
        return (
            <Suspense fallback={<div className={`speed-bots speed-bots--${theme}`}><div className='sb-empty'>Loading…</div></div>}>
                <TriBot onBack={() => setBotOpen('none')} />
            </Suspense>
        );
    }



    return (
        <div className={`speed-bots speed-bots--${theme}`}>
            <button
                type='button'
                className='sb-launcher__close'
                onClick={closeBot}
                title='Back to bot card'
            >
                ← Back to card
            </button>
            {scanResults && (
                <div className='sb-modal sb-modal--scan' onClick={() => setScanResults(null)}>
                    <div
                        className='sb-modal__card sb-scan-card'
                        onClick={e => e.stopPropagation()}
                    >
                        <div className='sb-scan-card__header'>
                            <h2 className='sb-scan-card__title'>
                                🔍 Volatility Scan · {scanResults[0]?.side} {scanResults[0]?.barrier}
                            </h2>
                            <p className='sb-scan-card__sub'>
                                Best volatilities for <strong>your</strong> setup ({scanResults[0]?.side}{' '}
                                {scanResults[0]?.barrier}) over the last 500 ticks. Pick a market and
                                hit <strong>Use</strong> to switch to it, or <strong>Run in {COUNTDOWN_START}s</strong>{' '}
                                to count down {COUNTDOWN_START} seconds — when it hits 0 a
                                <strong> Save &amp; Run</strong> button appears that fires the first
                                contract immediately. Direction &amp; barrier stay as you set them.
                            </p>
                        </div>
                        <div className='sb-scan-list'>
                            {scanResults.map((r, idx) => {
                                const tradeable = r.edge > 0 && !r.error;
                                return (
                                    <div
                                        key={r.symbol}
                                        className={`sb-scan-row ${
                                            idx === 0 && tradeable ? 'sb-scan-row--top' : ''
                                        } ${r.symbol === settings.symbol ? 'sb-scan-row--current' : ''}`}
                                    >
                                        <div className='sb-scan-row__rank'>
                                            {idx === 0 && tradeable ? '🥇' : `#${idx + 1}`}
                                        </div>
                                        <div className='sb-scan-row__main'>
                                            <div className='sb-scan-row__name'>{r.label}</div>
                                            {r.error ? (
                                                <div className='sb-scan-row__err'>
                                                    ⚠ {r.error}
                                                </div>
                                            ) : (
                                                <div className='sb-scan-row__stats'>
                                                    <span
                                                        className={`sb-scan-pill sb-scan-pill--best ${
                                                            r.edge > 0 ? 'pos' : 'neg'
                                                        }`}
                                                        title={`Win rate ${r.win_pct.toFixed(1)}% on ${r.sample} ticks vs random ${r.side === 'OVER' ? ((9 - r.barrier) * 10).toFixed(0) : (r.barrier * 10).toFixed(0)}%`}
                                                    >
                                                        {r.side} {r.barrier}{' '}
                                                        {r.edge >= 0 ? '+' : ''}
                                                        {r.edge.toFixed(2)}pp
                                                    </span>
                                                    <span
                                                        className='sb-scan-pill'
                                                        title={`Raw win rate of ${r.side} ${r.barrier} on this market`}
                                                    >
                                                        {r.win_pct.toFixed(1)}% wins
                                                    </span>
                                                    <span className='sb-scan-pill'>
                                                        {r.sample}t
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                        <div className='sb-scan-row__actions'>
                                            <button
                                                type='button'
                                                className='sb-scan-btn sb-scan-btn--ghost'
                                                disabled={!!r.error}
                                                onClick={() => applyScanPick(r)}
                                            >
                                                Use
                                            </button>
                                            <button
                                                type='button'
                                                className='sb-scan-btn sb-scan-btn--primary'
                                                disabled={!!r.error || !!countdown}
                                                onClick={() => startCountdown(r)}
                                            >
                                                ⏱ Run in {COUNTDOWN_START}s
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <button
                            type='button'
                            className='sb-scan-close'
                            onClick={() => setScanResults(null)}
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}
            {countdown && (
                <div className='sb-modal sb-modal--countdown' onClick={cancelCountdown}>
                    <div className='sb-modal__card sb-countdown-card' onClick={e => e.stopPropagation()}>
                        {countdown.seconds > 0 ? (
                            <>
                                <div className='sb-countdown-card__emoji'>⏱</div>
                                <h2 className='sb-countdown-card__title'>
                                    Get ready in {countdown.seconds}s
                                </h2>
                                <p className='sb-countdown-card__sub'>
                                    <strong>{countdown.result.label}</strong> — {countdown.result.side} {countdown.result.barrier}
                                    {' '}(edge +{countdown.result.edge.toFixed(2)}pp)
                                </p>
                                <div className='sb-countdown-card__big'>{countdown.seconds}</div>
                                <div className='sb-countdown-card__actions'>
                                    <button
                                        type='button'
                                        className='sb-scan-btn sb-scan-btn--ghost'
                                        onClick={cancelCountdown}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className='sb-countdown-card__emoji'>✅</div>
                                <h2 className='sb-countdown-card__title'>Ready to trade</h2>
                                <p className='sb-countdown-card__sub'>
                                    <strong>{countdown.result.label}</strong> — {countdown.result.side} {countdown.result.barrier}
                                    {' '}(edge +{countdown.result.edge.toFixed(2)}pp)
                                    <br />
                                    Click <strong>Save &amp; Run</strong> to buy the first contract now.
                                </p>
                                <div className='sb-countdown-card__actions'>
                                    <button
                                        type='button'
                                        className='sb-scan-btn sb-scan-btn--ghost'
                                        onClick={cancelCountdown}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type='button'
                                        className='sb-scan-btn sb-scan-btn--primary'
                                        onClick={saveAndRun}
                                    >
                                        💾 Save &amp; Run
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
            {event && (
                <div className={`sb-modal sb-modal--${event.kind}`} onClick={() => engine.clearLastEvent()}>
                    <div className='sb-modal__card' onClick={e => e.stopPropagation()}>
                        {event.kind === 'tp' ? (
                            <>
                                <div className='sb-modal__emoji'>🎉</div>
                                <h2 className='sb-modal__title'>Congratulations!</h2>
                                <p className='sb-modal__msg'>TP Hit 💵💵 ✅</p>
                                <p className='sb-modal__sub'>
                                    Total profit: <strong>+{engine.total_profit.toFixed(2)} USD</strong>
                                </p>
                            </>
                        ) : event.kind === 'sl' ? (
                            <>
                                <div className='sb-modal__emoji'>🙃</div>
                                <h2 className='sb-modal__title'>Auch, SL Hit</h2>
                                <p className='sb-modal__msg'>Protect your capital</p>
                                <p className='sb-modal__sub'>
                                    Total loss: <strong>{engine.total_profit.toFixed(2)} USD</strong>
                                </p>
                            </>
                        ) : (
                            <>
                                <div className='sb-modal__emoji'>⛔</div>
                                <h2 className='sb-modal__title'>Recovery Paused</h2>
                                <p className='sb-modal__msg'>
                                    {event.message ?? 'No high-conviction setup formed within the observation window.'}
                                </p>
                                <p className='sb-modal__sub'>
                                    Press <strong>▶ Resume</strong> when conditions look better.
                                </p>
                            </>
                        )}
                        <button className='sb-modal__close' onClick={() => engine.clearLastEvent()}>
                            Close
                        </button>
                    </div>
                </div>
            )}
            <div className='speed-bots__topbar'>
                <div className='speed-bots__topbar-stats'>
                    <div className='sb-top-stat sb-top-stat--accent'>
                        <span className='sb-top-stat__label'>Status</span>
                        <span className={`sb-top-stat__value ${engine.is_running ? 'running' : 'idle'}`}>
                            {engine.is_running
                                ? engine.recovery_mode
                                    ? 'Recovery'
                                    : 'Running'
                                : 'Idle'}
                        </span>
                    </div>
                    <div className='sb-top-stat sb-top-stat--accent'>
                        <span className='sb-top-stat__label'>Last Digit</span>
                        <span className='sb-top-stat__value sb-bigdigit'>
                            {engine.last_digit !== null ? engine.last_digit : '—'}
                        </span>
                    </div>
                    <div className='sb-top-stat sb-top-stat--accent'>
                        <span className='sb-top-stat__label'>Last Price</span>
                        <span className='sb-top-stat__value'>
                            {engine.last_quote !== null ? engine.last_quote.toFixed(engine.pip_size) : '—'}
                        </span>
                    </div>
                    <div className='sb-top-stat sb-top-stat--accent'>
                        <span className='sb-top-stat__label'>P&amp;L</span>
                        <span className={`sb-top-stat__value ${profitClass}`}>
                            {engine.total_profit >= 0 ? '+' : ''}
                            {engine.total_profit.toFixed(2)}
                        </span>
                    </div>
                </div>
                <div className='speed-bots__topbar-actions'>
                    <button
                        className='sb-icon-btn sb-icon-btn--solid'
                        title={settings.sound_enabled ? 'Mute sound' : 'Unmute sound'}
                        onClick={() => update('sound_enabled', !settings.sound_enabled)}
                    >
                        {settings.sound_enabled ? '🔔' : '🔕'}
                    </button>
                    <button
                        className='sb-icon-btn sb-icon-btn--solid'
                        title='Toggle theme'
                        onClick={() => setTheme(t => (t === 'light' ? 'dark' : 'light'))}
                    >
                        {theme === 'light' ? '🌙' : '☀️'}
                    </button>
                    {engine.circuit_paused && (
                        <button
                            className='sb-btn sb-btn--resume'
                            onClick={() => engine.resumeFromCircuit()}
                            title='Resume after circuit breaker'
                        >
                            ▶ Resume
                        </button>
                    )}
                    {!engine.is_running ? (
                        <button className='sb-btn sb-btn--start' onClick={() => engine.start()}>
                            ▶ Start
                        </button>
                    ) : (
                        <button className='sb-btn sb-btn--stop' onClick={() => engine.stop()}>
                            ■ Stop
                        </button>
                    )}
                </div>
            </div>

            {(() => {
                const mode = engine.circuit_paused
                    ? { cls: 'paused', label: '⛔ PAUSED — circuit breaker tripped' }
                    : engine.recovery_mode
                    ? engine.vh_enabled && (engine.burst_side === null && engine.burst_shots_left === 0)
                        ? { cls: 'vh', label: '🛡 VIRTUAL HOOK — analysing recovery side' }
                        : { cls: 'recovery', label: '⚡ RECOVERY BURST — real Even/Odd shots' }
                    : engine.cooldown_ticks_remaining > 0
                    ? { cls: 'cooldown', label: `⏳ COOLDOWN — ${engine.cooldown_ticks_remaining} tick(s)` }
                    : engine.is_running
                    ? {
                          cls: 'normal',
                          label: `🚀 NORMAL — ${settings.contract_direction === 'over' ? 'Over' : 'Under'} ${settings.prediction} every tick`,
                      }
                    : { cls: 'idle', label: '⏸ IDLE — press Start to begin' };
                const showEO = engine.recovery_mode || engine.circuit_paused;
                const winRate =
                    engine.wins + engine.losses > 0
                        ? (engine.wins / (engine.wins + engine.losses)) * 100
                        : 0;
                const streakLabel =
                    engine.current_streak.kind === null
                        ? '—'
                        : `${engine.current_streak.count}${engine.current_streak.kind}`;
                return (
                    <section className={`sb-mode-banner sb-mode-banner--${mode.cls}`}>
                        <div className='sb-mode-banner__label'>{mode.label}</div>
                        <div className='sb-mode-banner__chips'>
                            <span className='sb-chip-stat'>
                                Next stake <b>{engine.current_stake.toFixed(2)}</b>
                            </span>
                            <span className='sb-chip-stat'>
                                Win rate <b>{winRate.toFixed(1)}%</b>
                            </span>
                            <span className='sb-chip-stat'>
                                Streak <b>{streakLabel}</b>
                            </span>
                            <span className='sb-chip-stat'>
                                Max loss <b>{engine.max_loss_streak}</b>
                            </span>
                            {showEO && (
                                <>
                                    <span
                                        className='sb-chip-stat sb-chip-stat--even'
                                        title={`Even % over last ${Math.min(engine.tick_history.length, settings.analysis_window)} ticks`}
                                    >
                                        Even <b>{evenPct.toFixed(1)}%</b>
                                    </span>
                                    <span
                                        className='sb-chip-stat sb-chip-stat--odd'
                                        title={`Odd % over last ${Math.min(engine.tick_history.length, settings.analysis_window)} ticks`}
                                    >
                                        Odd <b>{oddPct.toFixed(1)}%</b>
                                    </span>
                                </>
                            )}
                            <TickSparkline digits={engine.tick_history.slice(-30)} />
                        </div>
                    </section>
                );
            })()}

            <section className='sb-card sb-strip'>
                <div className='sb-strip__title'>Settings</div>
                <div className='sb-strip__scroll'>
                    <label className='sb-field'>
                        <span>Symbol</span>
                        <select
                            value={settings.symbol}
                            onChange={e => update('symbol', e.target.value)}
                        >
                            {SYMBOLS.map(s => (
                                <option key={s.value} value={s.value}>
                                    {s.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className='sb-field'>
                        <span>Volatility Scanner</span>
                        <button
                            type='button'
                            className='sb-scan-btn'
                            onClick={runScan}
                            disabled={scanning}
                        >
                            {scanning ? '⏳ Scanning…' : '🔍 Scan Volatilities'}
                        </button>
                    </label>
                    <label className='sb-field'>
                        <span>Stake</span>
                        <input
                            type='number'
                            step='0.01'
                            min='0.35'
                            value={settings.stake}
                            onChange={e => update('stake', Number(e.target.value))}
                        />
                    </label>
                    <label className='sb-field'>
                        <span>Take Profit</span>
                        <input
                            type='number'
                            step='0.1'
                            value={settings.take_profit}
                            onChange={e => update('take_profit', Number(e.target.value))}
                        />
                    </label>
                    <label className='sb-field'>
                        <span>Stop Loss</span>
                        <input
                            type='number'
                            step='0.1'
                            value={settings.stop_loss}
                            onChange={e => update('stop_loss', Number(e.target.value))}
                        />
                    </label>
                    <label className='sb-field'>
                        <span>Martingale x</span>
                        <input
                            type='number'
                            step='0.1'
                            value={settings.martingale}
                            onChange={e => update('martingale', Number(e.target.value))}
                            disabled={!settings.martingale_enabled}
                        />
                    </label>
                    <label className='sb-field'>
                        <span>Direction</span>
                        <select
                            value={settings.contract_direction}
                            onChange={e => {
                                const dir = e.target.value as 'over' | 'under';
                                update('contract_direction', dir);
                                // Clamp barrier into the valid range for the new direction.
                                const min = dir === 'over' ? 0 : 1;
                                const max = dir === 'over' ? 8 : 9;
                                if (settings.prediction < min) update('prediction', min);
                                if (settings.prediction > max) update('prediction', max);
                            }}
                        >
                            <option value='over'>Over (digit &gt; barrier)</option>
                            <option value='under'>Under (digit &lt; barrier)</option>
                        </select>
                    </label>
                    <label className='sb-field'>
                        <span>Barrier</span>
                        <select
                            value={settings.prediction}
                            onChange={e => update('prediction', Number(e.target.value))}
                        >
                            {(settings.contract_direction === 'over'
                                ? [0, 1, 2, 3, 4, 5, 6, 7, 8]
                                : [1, 2, 3, 4, 5, 6, 7, 8, 9]
                            ).map(b => (
                                <option key={b} value={b}>
                                    {settings.contract_direction === 'over' ? `Over ${b}` : `Under ${b}`}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className='sb-field'>
                        <span>Analysis (N)</span>
                        <input
                            type='number'
                            min='5'
                            max='200'
                            value={settings.analysis_window}
                            onChange={e => update('analysis_window', Number(e.target.value))}
                        />
                    </label>
                    <label className='sb-field'>
                        <span>VH Max Steps</span>
                        <input
                            type='number'
                            min='1'
                            value={settings.vh_max_steps}
                            onChange={e => update('vh_max_steps', Number(e.target.value))}
                        />
                    </label>
                    <label className='sb-field'>
                        <span>VH Min Trades</span>
                        <input
                            type='number'
                            min='1'
                            value={settings.vh_min_trades}
                            onChange={e => update('vh_min_trades', Number(e.target.value))}
                        />
                    </label>
                    <label className='sb-field'>
                        <span>Max Consec Losses</span>
                        <input
                            type='number'
                            min='1'
                            value={settings.max_consec_losses}
                            onChange={e => update('max_consec_losses', Number(e.target.value))}
                        />
                    </label>
                    <label className='sb-field'>
                        <span>Max Stake ×Base</span>
                        <input
                            type='number'
                            min='1'
                            step='1'
                            value={settings.max_stake_multiplier}
                            onChange={e => update('max_stake_multiplier', Number(e.target.value))}
                        />
                    </label>
                    <label className='sb-field'>
                        <span>Cap Action</span>
                        <select
                            value={settings.max_stake_action}
                            onChange={e =>
                                update(
                                    'max_stake_action',
                                    e.target.value as ApolloSettings['max_stake_action']
                                )
                            }
                        >
                            <option value='reset'>Reset stake</option>
                            <option value='pause'>Pause bot</option>
                        </select>
                    </label>
                    <label className='sb-field'>
                        <span>Cooldown (ticks)</span>
                        <input
                            type='number'
                            min='0'
                            value={settings.recovery_cooldown_ticks}
                            onChange={e => update('recovery_cooldown_ticks', Number(e.target.value))}
                        />
                    </label>
                    <label className='sb-field'>
                        <span>⚡ Rapid-Fire Mode</span>
                        <select
                            value={settings.rapid_fire_enabled ? 'on' : 'off'}
                            onChange={e =>
                                update('rapid_fire_enabled', e.target.value === 'on')
                            }
                        >
                            <option value='off'>Off (sequential)</option>
                            <option value='on'>On (concurrent)</option>
                        </select>
                    </label>
                    {settings.rapid_fire_enabled && (
                        <label className='sb-field'>
                            <span>Rapid Interval (ms)</span>
                            <input
                                type='number'
                                min='250'
                                step='100'
                                value={settings.rapid_fire_interval_ms}
                                onChange={e =>
                                    update('rapid_fire_interval_ms', Number(e.target.value))
                                }
                            />
                        </label>
                    )}
                    <label className='sb-field'>
                        <span>Stale Tick (ms)</span>
                        <input
                            type='number'
                            min='500'
                            step='100'
                            value={settings.stale_tick_ms}
                            onChange={e => update('stale_tick_ms', Number(e.target.value))}
                        />
                    </label>
                    <label className='sb-checkfield'>
                        <input
                            type='checkbox'
                            checked={settings.martingale_enabled}
                            onChange={e => update('martingale_enabled', e.target.checked)}
                        />
                        <span>Martingale {settings.martingale_enabled ? 'ON' : 'OFF'}</span>
                    </label>
                    <label className='sb-checkfield'>
                        <input
                            type='checkbox'
                            checked={settings.sound_enabled}
                            onChange={e => update('sound_enabled', e.target.checked)}
                        />
                        <span>Sound {settings.sound_enabled ? 'ON' : 'OFF'}</span>
                    </label>
                    {(() => {
                        const rates = engine.barrierWinRates();
                        const list = settings.contract_direction === 'over' ? rates.over : rates.under;
                        const dirLabel = settings.contract_direction === 'over' ? 'Over' : 'Under';
                        const best =
                            list.length > 0
                                ? list.reduce((a, b) => (b.pct > a.pct ? b : a), list[0])
                                : null;
                        const ready = best !== null && best.n > 0;
                        return (
                            <button
                                className='sb-btn sb-btn--inline'
                                title={
                                    ready
                                        ? `Best ${dirLabel} barrier in last ${best!.n} ticks: ${dirLabel} ${best!.barrier} → ${best!.pct.toFixed(1)}% wins`
                                        : `Waiting for tick history to evaluate best ${dirLabel} barrier`
                                }
                                onClick={() => ready && update('prediction', best!.barrier)}
                                disabled={!ready}
                            >
                                Pick best{' '}
                                ({ready
                                    ? `${dirLabel} ${best!.barrier} · ${best!.pct.toFixed(0)}%`
                                    : '—'})
                            </button>
                        );
                    })()}
                    <button className='sb-btn sb-btn--inline' onClick={reset}>
                        Reset
                    </button>
                </div>
            </section>

            {engine.burst_failure_count >= 1 && (
                <section className={`sb-card sb-filter-status ${engine.last_filter_status?.pass ? 'sb-filter-status--pass' : 'sb-filter-status--wait'}`}>
                    <div className='sb-filter-status__head'>
                        <span className='sb-filter-status__title'>
                            🔬 Deep Analysis
                            {engine.burst_failure_count > 1 && (
                                <span className='sb-filter-status__failcount'>
                                    {' '}· {engine.burst_failure_count} failed bursts
                                </span>
                            )}
                        </span>
                        <span className='sb-filter-status__counter'>
                            {engine.observation_ticks_since_burst_failure} ticks
                        </span>
                    </div>
                    <div className='sb-filter-status__msg'>
                        {engine.last_filter_status?.pass
                            ? `✓ Dominance confirmed — firing ${engine.last_filter_status.side === 'DIGITEVEN' ? 'EVEN' : 'ODD'}…`
                            : engine.last_filter_status?.reason
                              ? `Waiting · ${engine.last_filter_status.reason}`
                              : 'Collecting tick data…'}
                    </div>
                </section>
            )}

            <section className='sb-card sb-strip sb-strip--ticks'>
                <div className='sb-strip__title'>Recent Ticks</div>
                <div className='sb-strip__scroll sb-strip__scroll--ticks'>
                    {engine.tick_stream.length === 0 ? (
                        <span className='sb-empty-inline'>Waiting for ticks…</span>
                    ) : (
                        engine.tick_stream.slice(-30).map((t, i) => (
                            <span
                                key={`${t.time}-${i}`}
                                className={`sb-digit ${t.digit % 2 === 0 ? 'even' : 'odd'}`}
                                title={`${new Date(t.time).toLocaleTimeString()} — ${t.quote.toFixed(engine.pip_size)}`}
                            >
                                {t.digit}
                            </span>
                        ))
                    )}
                </div>
            </section>

            <div className='sb-row sb-row--bottom'>
                <section className='sb-card sb-panel sb-tx'>
                    <div className='sb-panel__head'>
                        <h3 className='sb-card__title'>Transactions ({engine.transactions.length})</h3>
                        <div className='sb-filters'>
                            {(['all', 'real', 'virtual', 'wins', 'losses'] as TxFilter[]).map(f => (
                                <button
                                    key={f}
                                    className={`sb-chip ${txFilter === f ? 'sb-chip--active' : ''}`}
                                    onClick={() => setTxFilter(f)}
                                >
                                    {f[0].toUpperCase() + f.slice(1)}
                                </button>
                            ))}
                            <button
                                className='sb-chip sb-chip--reset'
                                onClick={() => engine.resetTransactions()}
                                title='Clear transactions and counters'
                            >
                                ↻ Reset
                            </button>
                        </div>
                    </div>

                    <div className='sb-tx__table-wrap'>
                        {filteredTransactions.length === 0 ? (
                            <div className='sb-empty'>No transactions yet — start the bot to begin.</div>
                        ) : (
                            <table className='sb-tx__table'>
                                <thead>
                                    <tr>
                                        <th>Time</th>
                                        <th>Contract</th>
                                        <th className='ar'>Stake</th>
                                        <th className='ar'>Entry Spot</th>
                                        <th className='ar'>Exit Spot</th>
                                        <th>Result</th>
                                        <th className='ar'>P&amp;L</th>
                                        <th className='ar'>Running P&amp;L</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredTransactions.map(tx => {
                                        const entry = tx.entry_spot;
                                        const exit = tx.exit_spot;
                                        const running = runningById.get(tx.id) ?? 0;
                                        return (
                                            <tr key={tx.id} className={tx.status === 'pending' ? 'sb-tx__row-pending' : tx.is_virtual ? 'sb-tx__row-virtual' : ''}>
                                                <td className='sb-tx__time'>
                                                    {new Date(tx.time).toLocaleTimeString()}
                                                </td>
                                                <td>
                                                    <div className='sb-tx__type'>
                                                        <span className='sb-tx__type-label'>{tx.contract_label}</span>
                                                        {tx.is_virtual && <span className='sb-tx__vh'>VH</span>}
                                                    </div>
                                                </td>
                                                <td className='ar'>{tx.buy_price.toFixed(2)}</td>
                                                <td className='ar mono'>
                                                    {entry ?? '—'}
                                                </td>
                                                <td className='ar mono'>
                                                    {exit ?? '—'}
                                                </td>
                                                <td>
                                                    {tx.status === 'pending' ? (
                                                        <span className='sb-tx__result'>⏳</span>
                                                    ) : tx.is_virtual ? (
                                                        <span className={`sb-tx__result ${tx.is_win ? 'pos' : 'neg'}`}>
                                                            {tx.is_win ? '✓ VH WIN' : '✕ VH LOSS'}
                                                        </span>
                                                    ) : (
                                                        <span className={`sb-tx__result ${tx.is_win ? 'pos' : 'neg'}`}>
                                                            {tx.is_win ? '✓ WIN' : '✕ LOSS'}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className={`ar ${tx.status === 'pending' ? '' : tx.is_win ? 'pos' : 'neg'}`}>
                                                    {tx.status === 'pending' ? '—' : `${tx.is_virtual ? '(v) ' : ''}${tx.profit >= 0 ? '+' : ''}${tx.profit.toFixed(2)}`}
                                                </td>
                                                <td className={`ar ${running > 0 ? 'pos' : running < 0 ? 'neg' : ''}`}>
                                                    {running >= 0 ? '+' : ''}
                                                    {running.toFixed(2)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>

                    <div className='sb-tx__summary'>
                        <div className='sb-tx__sum-row'>
                            <div className='sb-tx__sum-cell'>
                                <span className='sb-tx__sum-label'>Total stake</span>
                                <span className='sb-tx__sum-value'>{realStake.toFixed(2)} USD</span>
                            </div>
                            <div className='sb-tx__sum-cell'>
                                <span className='sb-tx__sum-label'>Total payout</span>
                                <span className='sb-tx__sum-value'>{realPayout.toFixed(2)} USD</span>
                            </div>
                            <div className='sb-tx__sum-cell'>
                                <span className='sb-tx__sum-label'>No. of runs</span>
                                <span className='sb-tx__sum-value'>{realCount}</span>
                            </div>
                        </div>
                        <div className='sb-tx__sum-row'>
                            <div className='sb-tx__sum-cell'>
                                <span className='sb-tx__sum-label'>Contracts lost</span>
                                <span className='sb-tx__sum-value'>{engine.losses}</span>
                            </div>
                            <div className='sb-tx__sum-cell'>
                                <span className='sb-tx__sum-label'>Contracts won</span>
                                <span className='sb-tx__sum-value'>{engine.wins}</span>
                            </div>
                            <div className='sb-tx__sum-cell'>
                                <span className='sb-tx__sum-label'>Total profit/loss</span>
                                <span className={`sb-tx__sum-value ${profitClass}`}>
                                    {engine.total_profit >= 0 ? '+' : ''}{engine.total_profit.toFixed(2)} USD
                                </span>
                            </div>
                        </div>
                    </div>
                </section>

                <section className='sb-card sb-panel'>
                    <div className='sb-panel__head'>
                        <h3 className='sb-card__title'>
                            Journal ({filteredJournal.length}/{engine.journal.length})
                        </h3>
                        <div className='sb-filters'>
                            {(['all', 'success', 'warn', 'error', 'info'] as JournalFilter[]).map(f => (
                                <button
                                    key={f}
                                    className={`sb-chip sb-chip--j-${f} ${journalFilter === f ? 'sb-chip--active' : ''}`}
                                    onClick={() => setJournalFilter(f)}
                                >
                                    {f[0].toUpperCase() + f.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className='sb-journal'>
                        {filteredJournal.length === 0 ? (
                            <div className='sb-empty'>Journal is empty.</div>
                        ) : (
                            filteredJournal.map(j => (
                                <div key={j.id} className={`sb-journal__entry sb-journal__entry--${j.type}`}>
                                    <span className='sb-journal__time'>
                                        {new Date(j.time).toLocaleTimeString()}
                                    </span>
                                    <span className='sb-journal__msg'>{j.message}</span>
                                </div>
                            ))
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
};

export default SpeedBots;
