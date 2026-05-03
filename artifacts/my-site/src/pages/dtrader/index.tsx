import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import {
    DTraderEngine,
    type DTBuyFeedback,
    type DTConfig,
    type DTContractType,
    type DTDurationUnit,
    type DTLog,
    type DTPosition,
    type DTProposal,
    type DTStatus,
} from '@/utils/dtrader-engine';
import './dtrader.scss';

// ─── Symbols (same set as Signal Engine) ─────────────────────────────────────
const SYMBOLS: Array<{ value: string; label: string }> = [
    { value: '1HZ10V',  label: 'Volatility 10 (1s)'  },
    { value: '1HZ25V',  label: 'Volatility 25 (1s)'  },
    { value: '1HZ50V',  label: 'Volatility 50 (1s)'  },
    { value: '1HZ75V',  label: 'Volatility 75 (1s)'  },
    { value: '1HZ100V', label: 'Volatility 100 (1s)' },
    { value: 'R_10',    label: 'Volatility 10'  },
    { value: 'R_25',    label: 'Volatility 25'  },
    { value: 'R_50',    label: 'Volatility 50'  },
    { value: 'R_75',    label: 'Volatility 75'  },
    { value: 'R_100',   label: 'Volatility 100' },
];

// ─── Contract category model ─────────────────────────────────────────────────
type CategoryKey = 'rise_fall' | 'higher_lower' | 'touch' | 'matches_diff' | 'over_under' | 'even_odd';

interface CategoryDef {
    key:        CategoryKey;
    label:      string;
    emoji:      string;
    /** Pair of (label → contract type). Used for the direction toggle. */
    options:    Array<{ label: string; type: DTContractType }>;
    needsBarrier:    boolean; // relative barrier '+0.001'
    needsPrediction: boolean; // single digit
    barrierDefault?: string;
    units:      DTDurationUnit[]; // allowed duration units
    minDuration: Partial<Record<DTDurationUnit, number>>;
    maxDuration: Partial<Record<DTDurationUnit, number>>;
}

const CATEGORIES: CategoryDef[] = [
    {
        key: 'rise_fall',  label: 'Rise / Fall', emoji: '📈',
        options: [{ label: 'Rise', type: 'CALL' }, { label: 'Fall', type: 'PUT' }],
        needsBarrier: false, needsPrediction: false,
        units: ['t', 's', 'm'],
        minDuration: { t: 1, s: 15, m: 1 }, maxDuration: { t: 10, s: 3600, m: 60 },
    },
    {
        key: 'higher_lower', label: 'Higher / Lower', emoji: '↕️',
        options: [{ label: 'Higher', type: 'CALL' }, { label: 'Lower', type: 'PUT' }],
        needsBarrier: true, needsPrediction: false, barrierDefault: '+0.001',
        units: ['s', 'm'],
        minDuration: { s: 15, m: 1 }, maxDuration: { s: 3600, m: 60 },
    },
    {
        key: 'touch', label: 'Touch / No Touch', emoji: '🎯',
        options: [{ label: 'Touch', type: 'ONETOUCH' }, { label: 'No Touch', type: 'NOTOUCH' }],
        needsBarrier: true, needsPrediction: false, barrierDefault: '+0.001',
        units: ['s', 'm'],
        minDuration: { s: 15, m: 1 }, maxDuration: { s: 3600, m: 60 },
    },
    {
        key: 'matches_diff', label: 'Matches / Differs', emoji: '🎲',
        options: [{ label: 'Matches', type: 'DIGITMATCH' }, { label: 'Differs', type: 'DIGITDIFF' }],
        needsBarrier: false, needsPrediction: true,
        units: ['t'], minDuration: { t: 1 }, maxDuration: { t: 10 },
    },
    {
        key: 'over_under', label: 'Over / Under', emoji: '⚖️',
        options: [{ label: 'Over', type: 'DIGITOVER' }, { label: 'Under', type: 'DIGITUNDER' }],
        needsBarrier: false, needsPrediction: true,
        units: ['t'], minDuration: { t: 1 }, maxDuration: { t: 10 },
    },
    {
        key: 'even_odd', label: 'Even / Odd', emoji: '🔢',
        options: [{ label: 'Even', type: 'DIGITEVEN' }, { label: 'Odd', type: 'DIGITODD' }],
        needsBarrier: false, needsPrediction: false,
        units: ['t'], minDuration: { t: 1 }, maxDuration: { t: 10 },
    },
];

const UNIT_LABEL: Record<DTDurationUnit, string> = { t: 'ticks', s: 'seconds', m: 'minutes', h: 'hours' };

// ─── Component ───────────────────────────────────────────────────────────────

const DTraderPage = observer(() => {
    // Engine instance lives across renders
    const engineRef = useRef<DTraderEngine | null>(null);
    if (engineRef.current === null) engineRef.current = new DTraderEngine();
    const engine = engineRef.current;

    // ── UI state ─────────────────────────────────────────────────────────────
    const [symbol,        setSymbol]        = useState<string>('1HZ100V');
    const [categoryKey,   setCategoryKey]   = useState<CategoryKey>('rise_fall');
    const [contractType,  setContractType]  = useState<DTContractType>('CALL');
    const [durationUnit,  setDurationUnit]  = useState<DTDurationUnit>('t');
    const [durationValue, setDurationValue] = useState<number>(5);
    const [stake,         setStake]         = useState<number>(1);
    const [barrierOffset, setBarrierOffset] = useState<string>('+0.001');
    const [prediction,    setPrediction]    = useState<number>(5);

    // ── Live data ────────────────────────────────────────────────────────────
    const [status,    setStatus]    = useState<DTStatus>('idle');
    const [spot,      setSpot]      = useState<string>('—');
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const [proposal,  setProposal]  = useState<DTProposal | null>(null);
    const [logs,      setLogs]      = useState<DTLog[]>([]);
    const [positions, setPositions] = useState<DTPosition[]>([]);
    const [feedback,  setFeedback]  = useState<DTBuyFeedback | null>(null);

    const category = useMemo(() => CATEGORIES.find(c => c.key === categoryKey)!, [categoryKey]);

    const currency = (api_base?.account_info as any)?.currency || 'USD';
    const isLoggedIn = !!api_base?.is_authorized;

    // ── Wire engine callbacks once ───────────────────────────────────────────
    useEffect(() => {
        engine.onStatus   = setStatus;
        engine.onTick     = (s, d) => { setSpot(s); setLastDigit(d); };
        engine.onProposal = p => setProposal(p);
        engine.onLog      = l => setLogs(prev => [...prev.slice(-199), l]);
        engine.onPosition = p => setPositions(prev => {
            const idx = prev.findIndex(x => x.contractId === p.contractId);
            if (idx === -1) return [p, ...prev].slice(0, 50);
            const copy = prev.slice();
            copy[idx] = p;
            return copy;
        });
        engine.onBuyFeedback = f => setFeedback(f);

        return () => { engine.stop(); };
    }, [engine]);

    // Auto-dismiss feedback after a few seconds (success faster than error)
    useEffect(() => {
        if (!feedback) return;
        const ms = feedback.kind === 'success' ? 3500 : 5500;
        const t = setTimeout(() => setFeedback(null), ms);
        return () => clearTimeout(t);
    }, [feedback]);

    // ── Build current config & start / patch engine ──────────────────────────
    const buildConfig = useCallback((): DTConfig => {
        const barrier = category.needsBarrier
            ? barrierOffset
            : category.needsPrediction
                ? String(prediction)
                : null;
        return {
            symbol,
            contractType,
            durationValue,
            durationUnit,
            stake,
            barrier,
            currency,
        };
    }, [symbol, contractType, durationValue, durationUnit, stake, barrierOffset, prediction, category, currency]);

    // Start engine when logged in
    useEffect(() => {
        if (!isLoggedIn) return;
        if (status === 'idle') {
            engine.start(buildConfig());
        }
        // We intentionally don't restart on every cfg change — we patch instead.
    }, [isLoggedIn, engine, status, buildConfig]);

    // Push config patches whenever any input changes
    useEffect(() => {
        if (status === 'idle' || status === 'error') return;
        engine.updateConfig(buildConfig());
    }, [engine, status, buildConfig]);

    // ── Handlers ─────────────────────────────────────────────────────────────
    const handleCategoryChange = (key: CategoryKey) => {
        const def = CATEGORIES.find(c => c.key === key)!;
        setCategoryKey(key);
        setContractType(def.options[0].type);
        // Reset duration unit/value to category defaults
        const unit = def.units[0];
        setDurationUnit(unit);
        setDurationValue(def.minDuration[unit] ?? 1);
        if (def.needsBarrier && def.barrierDefault) setBarrierOffset(def.barrierDefault);
    };

    const handleBuy = () => engine.buy();

    const handleClear = () => { setLogs([]); setPositions(prev => prev.filter(p => p.isOpen)); };

    // ── Rendering helpers ────────────────────────────────────────────────────

    const minDur = category.minDuration[durationUnit] ?? 1;
    const maxDur = category.maxDuration[durationUnit] ?? 10;

    const hasOpen = positions.some(p => p.isOpen);

    if (!isLoggedIn) {
        return (
            <div className='dtp__login-prompt'>
                <div className='dtp__login-icon'>🔐</div>
                <div className='dtp__login-title'>DTrader</div>
                <div className='dtp__login-msg'>
                    Log in to your Deriv account to place manual trades.
                </div>
            </div>
        );
    }

    return (
        <div className='dtp'>
            {/* ── Header: symbol + spot ───────────────────────────────────── */}
            <div className='dtp__header'>
                <div className='dtp__sym-wrap'>
                    <label className='dtp__lbl'>Symbol</label>
                    <select
                        className='dtp__sym-select'
                        value={symbol}
                        onChange={e => setSymbol(e.target.value)}
                    >
                        {SYMBOLS.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                    </select>
                </div>
                <div className='dtp__spot-wrap'>
                    <div className='dtp__spot-label'>Spot</div>
                    <div className='dtp__spot-value'>{spot}</div>
                    {lastDigit !== null && (
                        <div className='dtp__spot-digit'>{lastDigit}</div>
                    )}
                </div>
            </div>

            {/* ── Body: form on left, ticket on right (stacks on mobile) ──── */}
            <div className='dtp__body'>
                <div className='dtp__form'>
                    {/* Category tabs */}
                    <div className='dtp__cat-row'>
                        {CATEGORIES.map(c => (
                            <button
                                key={c.key}
                                className={`dtp__cat ${c.key === categoryKey ? 'dtp__cat--active' : ''}`}
                                onClick={() => handleCategoryChange(c.key)}
                            >
                                <span className='dtp__cat-emoji'>{c.emoji}</span>
                                <span className='dtp__cat-label'>{c.label}</span>
                            </button>
                        ))}
                    </div>

                    {/* Direction toggle */}
                    <div className='dtp__dir-row'>
                        {category.options.map(opt => (
                            <button
                                key={opt.type}
                                className={`dtp__dir dtp__dir--${opt.type === 'CALL' || opt.type === 'ONETOUCH' || opt.type === 'DIGITMATCH' || opt.type === 'DIGITOVER' || opt.type === 'DIGITEVEN' ? 'up' : 'down'} ${contractType === opt.type ? 'dtp__dir--active' : ''}`}
                                onClick={() => setContractType(opt.type)}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>

                    {/* Inputs grid */}
                    <div className='dtp__inputs'>
                        {/* Duration */}
                        <div className='dtp__field'>
                            <label className='dtp__lbl'>Duration</label>
                            <div className='dtp__field-row'>
                                <input
                                    type='number'
                                    className='dtp__input'
                                    value={durationValue}
                                    min={minDur}
                                    max={maxDur}
                                    onChange={e => {
                                        const v = parseInt(e.target.value, 10);
                                        if (!isNaN(v)) setDurationValue(Math.min(maxDur, Math.max(minDur, v)));
                                    }}
                                />
                                <select
                                    className='dtp__unit-select'
                                    value={durationUnit}
                                    onChange={e => {
                                        const u = e.target.value as DTDurationUnit;
                                        setDurationUnit(u);
                                        const lo = category.minDuration[u] ?? 1;
                                        const hi = category.maxDuration[u] ?? 10;
                                        setDurationValue(v => Math.min(hi, Math.max(lo, v)));
                                    }}
                                >
                                    {category.units.map(u => (
                                        <option key={u} value={u}>{UNIT_LABEL[u]}</option>
                                    ))}
                                </select>
                            </div>
                            <div className='dtp__hint'>{minDur}–{maxDur} {UNIT_LABEL[durationUnit]}</div>
                        </div>

                        {/* Stake */}
                        <div className='dtp__field'>
                            <label className='dtp__lbl'>Stake ({currency})</label>
                            <input
                                type='number'
                                className='dtp__input'
                                step='0.01'
                                min={0.35}
                                value={stake}
                                onChange={e => {
                                    const v = parseFloat(e.target.value);
                                    if (!isNaN(v)) setStake(v);
                                }}
                            />
                            <div className='dtp__hint'>min 0.35</div>
                        </div>

                        {/* Barrier (Higher/Lower, Touch) */}
                        {category.needsBarrier && (
                            <div className='dtp__field'>
                                <label className='dtp__lbl'>Barrier (offset)</label>
                                <input
                                    type='text'
                                    className='dtp__input'
                                    value={barrierOffset}
                                    onChange={e => setBarrierOffset(e.target.value)}
                                />
                                <div className='dtp__hint'>e.g. +0.001 above spot, -0.001 below</div>
                            </div>
                        )}

                        {/* Prediction (digits) */}
                        {category.needsPrediction && (
                            <div className='dtp__field dtp__field--full'>
                                <label className='dtp__lbl'>Prediction (digit)</label>
                                <div className='dtp__digit-row'>
                                    {[0,1,2,3,4,5,6,7,8,9].map(d => (
                                        <button
                                            key={d}
                                            className={`dtp__digit ${prediction === d ? 'dtp__digit--active' : ''}`}
                                            onClick={() => setPrediction(d)}
                                        >
                                            {d}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Ticket (proposal + buy) ────────────────────────────── */}
                <div className='dtp__ticket'>
                    <div className='dtp__ticket-title'>Ticket</div>
                    <div className='dtp__ticket-row'>
                        <span className='dtp__ticket-key'>Payout</span>
                        <span className='dtp__ticket-val dtp__ticket-val--big'>
                            {proposal ? `${proposal.payout.toFixed(2)} ${currency}` : '—'}
                        </span>
                    </div>
                    <div className='dtp__ticket-row'>
                        <span className='dtp__ticket-key'>Profit</span>
                        <span className='dtp__ticket-val' style={{ color: '#10b981' }}>
                            {proposal
                                ? `+${proposal.profit.toFixed(2)} (${proposal.profitPct.toFixed(1)}%)`
                                : '—'}
                        </span>
                    </div>
                    <div className='dtp__ticket-row'>
                        <span className='dtp__ticket-key'>Cost</span>
                        <span className='dtp__ticket-val'>
                            {proposal ? `${proposal.askPrice.toFixed(2)} ${currency}` : '—'}
                        </span>
                    </div>
                    {proposal?.longcode && (
                        <div className='dtp__ticket-longcode'>{proposal.longcode}</div>
                    )}

                    {/* Prominent buy feedback — sits right above BUY so it's
                        impossible to miss on mobile, even with the log offscreen */}
                    {feedback && (
                        <div
                            key={feedback.seq}
                            className={`dtp__buy-feedback dtp__buy-feedback--${feedback.kind}`}
                            onClick={() => setFeedback(null)}
                        >
                            <span className='dtp__buy-feedback-icon'>
                                {feedback.kind === 'success' ? '✅' : '⚠️'}
                            </span>
                            <span className='dtp__buy-feedback-msg'>{feedback.message}</span>
                        </div>
                    )}

                    <button
                        className='dtp__buy-btn'
                        onClick={handleBuy}
                        disabled={!proposal || status !== 'ready'}
                    >
                        {status === 'subscribing' && !proposal
                            ? 'Loading proposal…'
                            : `BUY  ${proposal ? `$${proposal.askPrice.toFixed(2)}` : ''}`}
                    </button>
                    {status === 'error' && (
                        <div className='dtp__ticket-err'>Engine error — see log</div>
                    )}
                </div>
            </div>

            {/* ── Positions + log ────────────────────────────────────────── */}
            <div className='dtp__lower'>
                <div className='dtp__positions'>
                    <div className='dtp__section-head'>
                        <span>Positions {hasOpen && <span className='dtp__live-dot'>● live</span>}</span>
                        <button className='dtp__clear-btn' onClick={handleClear}>Clear settled</button>
                    </div>
                    {positions.length === 0 ? (
                        <div className='dtp__empty'>No positions yet — pick a contract and press BUY.</div>
                    ) : (
                        <div className='dtp__pos-list'>
                            {positions.map(p => {
                                const cls = !p.isOpen
                                    ? (p.isWin ? 'dtp__pos--win' : 'dtp__pos--loss')
                                    : 'dtp__pos--open';
                                return (
                                    <div key={p.contractId} className={`dtp__pos ${cls}`}>
                                        <div className='dtp__pos-row1'>
                                            <span className='dtp__pos-type'>{shortLabel(p.contractType)}</span>
                                            <span className='dtp__pos-sym'>{p.symbol}</span>
                                            <span className='dtp__pos-stake'>${p.stake.toFixed(2)}</span>
                                        </div>
                                        <div className='dtp__pos-row2'>
                                            {p.entrySpot && (
                                                <span className='dtp__pos-prices'>
                                                    {p.entrySpot} {(p.exitSpot || p.currentSpot) && '→ '}
                                                    {p.exitSpot ?? p.currentSpot ?? ''}
                                                </span>
                                            )}
                                            <span
                                                className='dtp__pos-pnl'
                                                style={{
                                                    color: (p.profit ?? 0) >= 0 ? '#10b981' : '#ef4444',
                                                }}
                                            >
                                                {p.profit !== null
                                                    ? `${(p.profit) >= 0 ? '+' : ''}$${p.profit.toFixed(2)}`
                                                    : '…'}
                                            </span>
                                        </div>
                                        <div className='dtp__pos-row3'>
                                            <span className='dtp__pos-time'>{p.purchaseTime}</span>
                                            <span className='dtp__pos-status'>
                                                {p.isOpen ? 'open' : (p.isWin ? '✅ won' : '❌ lost')}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className='dtp__log'>
                    <div className='dtp__section-head'><span>Activity log</span></div>
                    {logs.length === 0 ? (
                        <div className='dtp__empty'>No activity yet.</div>
                    ) : (
                        <div className='dtp__log-list'>
                            {logs.slice().reverse().map(l => (
                                <div key={l.seq} className={`dtp__log-line dtp__log-line--${l.type}`}>
                                    <span className='dtp__log-time'>{l.time}</span>
                                    <span className='dtp__log-msg'>{l.message}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

function shortLabel(t: DTContractType): string {
    switch (t) {
        case 'CALL':       return 'RISE / HIGHER';
        case 'PUT':        return 'FALL / LOWER';
        case 'ONETOUCH':   return 'TOUCH';
        case 'NOTOUCH':    return 'NO TOUCH';
        case 'DIGITMATCH': return 'MATCHES';
        case 'DIGITDIFF':  return 'DIFFERS';
        case 'DIGITOVER':  return 'OVER';
        case 'DIGITUNDER': return 'UNDER';
        case 'DIGITEVEN':  return 'EVEN';
        case 'DIGITODD':   return 'ODD';
        default:           return t;
    }
}

DTraderPage.displayName = 'DTraderPage';
export default DTraderPage;
