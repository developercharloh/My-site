import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    dollarFlowEngine,
    DollarFlowSettings,
    DEFAULT_DF_SETTINGS,
    CONTRACT_FAMILIES,
    FAMILY_SIDES,
    needsDigitPrediction,
    overUnderBarrierRange,
    ContractFamily,
    ContractSide,
    MarketConfig,
} from './dollar-flow-engine';

const SYMBOLS = [
    { value: '1HZ10V',  label: 'Volatility 10 (1s) Index' },
    { value: '1HZ15V',  label: 'Volatility 15 (1s) Index' },
    { value: '1HZ25V',  label: 'Volatility 25 (1s) Index' },
    { value: '1HZ30V',  label: 'Volatility 30 (1s) Index' },
    { value: '1HZ50V',  label: 'Volatility 50 (1s) Index' },
    { value: '1HZ75V',  label: 'Volatility 75 (1s) Index' },
    { value: '1HZ90V',  label: 'Volatility 90 (1s) Index' },
    { value: '1HZ100V', label: 'Volatility 100 (1s) Index' },
    { value: 'R_10',    label: 'Volatility 10 Index' },
    { value: 'R_25',    label: 'Volatility 25 Index' },
    { value: 'R_50',    label: 'Volatility 50 Index' },
    { value: 'R_75',    label: 'Volatility 75 Index' },
    { value: 'R_100',   label: 'Volatility 100 Index' },
];

type Theme = 'light' | 'dark';
type JFilter = 'all' | 'info' | 'success' | 'warn' | 'error';
type TFilter = 'all' | 'm1' | 'm2' | 'wins' | 'losses';

const useEngine = () => {
    const [, bump] = useState(0);
    useEffect(() => dollarFlowEngine.subscribe(() => bump(t => t + 1)), []);
    return dollarFlowEngine;
};

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }> = ({
    checked, onChange, disabled,
}) => (
    <button
        type='button'
        className={`df-toggle ${checked ? 'df-toggle--on' : ''}`}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        aria-pressed={checked}
    >
        <span className='df-toggle__knob' />
    </button>
);

const DollarFlowBot: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const engine = useEngine();
    const [settings, setSettings] = useState<DollarFlowSettings>({
        ...DEFAULT_DF_SETTINGS,
        m1: { ...DEFAULT_DF_SETTINGS.m1 },
        m2: { ...DEFAULT_DF_SETTINGS.m2 },
    });
    const [theme, setTheme] = useState<Theme>(() =>
        (window.localStorage.getItem('df_theme') as Theme) || 'light'
    );
    const [jFilter, setJFilter] = useState<JFilter>('all');
    const [txFilter, setTxFilter] = useState<TFilter>('all');

    // Track recent digits locally
    const [recentDigits, setRecentDigits] = useState<number[]>([]);
    const prevDigit = useRef<number | null>(null);
    useEffect(() => {
        if (engine.last_digit !== null && engine.last_digit !== prevDigit.current) {
            prevDigit.current = engine.last_digit;
            setRecentDigits(prev => [...prev.slice(-49), engine.last_digit as number]);
        }
    });

    useEffect(() => { engine.updateSettings(settings); }, [settings]);
    useEffect(() => { window.localStorage.setItem('df_theme', theme); }, [theme]);

    const set = <K extends keyof DollarFlowSettings>(k: K, v: DollarFlowSettings[K]) =>
        setSettings(p => ({ ...p, [k]: v }));

    const setM1 = (patch: Partial<MarketConfig>) => setSettings(p => ({ ...p, m1: { ...p.m1, ...patch } }));
    const setM2 = (patch: Partial<MarketConfig>) => setSettings(p => ({ ...p, m2: { ...p.m2, ...patch } }));

    const running = engine.is_running;

    const filteredTx = useMemo(() => {
        const txs = engine.transactions;
        if (txFilter === 'm1')     return txs.filter(t => t.market === 'M1');
        if (txFilter === 'm2')     return txs.filter(t => t.market === 'M2');
        if (txFilter === 'wins')   return txs.filter(t => t.status === 'won');
        if (txFilter === 'losses') return txs.filter(t => t.status === 'lost');
        return txs;
    }, [engine.transactions, txFilter]);

    const filteredJ = useMemo(() => {
        if (jFilter === 'all') return engine.journal;
        return engine.journal.filter(j => j.type === jFilter);
    }, [engine.journal, jFilter]);

    const profitCls = engine.total_profit > 0 ? 'pos' : engine.total_profit < 0 ? 'neg' : '';
    const symLabel  = SYMBOLS.find(s => s.value === settings.symbol)?.label ?? settings.symbol;

    const { label: statusLabel, cls: statusCls } = (() => {
        if (!running) return { label: 'Idle', cls: 'idle' };
        if (engine.phase === 'cooldown') return { label: `Cooldown (${engine.cooldown_ticks_remaining}t)`, cls: 'cooldown' };
        if (engine.phase === 'm2')       return { label: 'Recovery (M2)', cls: 'recovery' };
        return { label: 'Running (M1)', cls: 'normal' };
    })();

    const realTxs = engine.transactions.filter(t => t.market === 'M1');
    const totalStake  = engine.transactions.reduce((s, t) => s + t.buy_price, 0);
    const totalPayout = engine.transactions.reduce((s, t) => s + t.payout, 0);

    const m1Sides    = FAMILY_SIDES[settings.m1.family];
    const m2Sides    = FAMILY_SIDES[settings.m2.family];
    const m1ShowP    = needsDigitPrediction(settings.m1.family);
    const m2ShowP    = needsDigitPrediction(settings.m2.family);
    const m1PMax     = overUnderBarrierRange(settings.m1.family) ? 8 : 9;
    const m1PMin     = overUnderBarrierRange(settings.m1.family) ? 1 : 0;
    const m2PMax     = overUnderBarrierRange(settings.m2.family) ? 8 : 9;
    const m2PMin     = overUnderBarrierRange(settings.m2.family) ? 1 : 0;
    const m1TickMin  = settings.m1.family === 'asian' ? 5 : 1;
    const m2TickMin  = settings.m2.family === 'asian' ? 5 : 1;
    const tickOpts   = (min: number) => Array.from({ length: 10 - min + 1 }, (_, i) => min + i);

    const event = engine.last_event;

    return (
        <div className={`speed-bots speed-bots--${theme}`}>
            {/* ── Event modal ─────────────────────────────────── */}
            {event && (
                <div className='sb-modal' onClick={() => engine.clearLastEvent()}>
                    <div className='sb-modal__card' onClick={e => e.stopPropagation()}>
                        {event.kind === 'tp' ? (
                            <><div className='sb-modal__emoji'>🎉</div><h2 className='sb-modal__title'>Take Profit Hit!</h2></>
                        ) : event.kind === 'sl' ? (
                            <><div className='sb-modal__emoji'>🙃</div><h2 className='sb-modal__title'>Stop Loss Hit</h2></>
                        ) : event.kind === 'max_losses' ? (
                            <><div className='sb-modal__emoji'>⛔</div><h2 className='sb-modal__title'>Max Losses Reached</h2></>
                        ) : (
                            <><div className='sb-modal__emoji'>🏆</div><h2 className='sb-modal__title'>Max Wins Reached</h2></>
                        )}
                        <p className='sb-modal__msg'>{event.message}</p>
                        <button className='sb-modal__close' onClick={() => engine.clearLastEvent()}>Close</button>
                    </div>
                </div>
            )}

            {/* ── Back button ──────────────────────────────────── */}
            <button type='button' className='sb-launcher__close' onClick={onBack}>← Back to card</button>

            {/* ── Topbar ───────────────────────────────────────── */}
            <div className='speed-bots__topbar'>
                <div className='speed-bots__topbar-stats'>
                    <div className='sb-top-stat sb-top-stat--accent'>
                        <span className='sb-top-stat__label'>Status</span>
                        <span className={`sb-top-stat__value ${statusCls}`}>{statusLabel}</span>
                    </div>
                    <div className='sb-top-stat sb-top-stat--accent'>
                        <span className='sb-top-stat__label'>Last Digit</span>
                        <span className='sb-top-stat__value sb-bigdigit'>
                            {engine.last_digit !== null ? engine.last_digit : '—'}
                        </span>
                    </div>
                    <div className='sb-top-stat sb-top-stat--accent'>
                        <span className='sb-top-stat__label'>P&amp;L</span>
                        <span className={`sb-top-stat__value ${profitCls}`}>
                            {engine.total_profit >= 0 ? '+' : ''}{engine.total_profit.toFixed(2)}
                        </span>
                    </div>
                    <div className='sb-top-stat sb-top-stat--accent'>
                        <span className='sb-top-stat__label'>Runs</span>
                        <span className='sb-top-stat__value'>{engine.total_runs}</span>
                    </div>
                </div>
                <div className='speed-bots__topbar-actions'>
                    <button
                        className='sb-icon-btn sb-icon-btn--solid'
                        title='Toggle theme'
                        onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
                    >
                        {theme === 'dark' ? '☀️' : '🌙'}
                    </button>
                    <button
                        className='sb-btn sb-btn--inline'
                        onClick={() => engine.resetStats()}
                        disabled={running}
                        title='Reset stats'
                    >
                        🗑 Reset
                    </button>
                    {running ? (
                        <button className='sb-btn sb-btn--stop' onClick={() => void engine.stop()}>■ Stop</button>
                    ) : (
                        <button className='sb-btn sb-btn--start' onClick={() => void engine.start()}>▶ Start</button>
                    )}
                </div>
            </div>

            {/* ── Mode banner ──────────────────────────────────── */}
            <section className={`sb-mode-banner sb-mode-banner--${statusCls}`}>
                <div className='sb-mode-banner__label'>
                    {statusCls === 'idle'     ? '⏸ IDLE — press Start to begin'
                    : statusCls === 'normal'  ? '🚀 RUNNING — Market 1 active'
                    : statusCls === 'recovery'? '🔄 RECOVERY — Market 2 active'
                    :                           `⏳ COOLDOWN — ${engine.cooldown_ticks_remaining} tick(s) remaining`}
                </div>
                <div className='sb-mode-banner__chips'>
                    <span className='sb-chip-stat'>M1 W/L <b><span className='pos'>{engine.m1_wins}</span>/<span className='neg'>{engine.m1_losses}</span></b></span>
                    <span className='sb-chip-stat'>M2 W/L <b><span className='pos'>{engine.m2_wins}</span>/<span className='neg'>{engine.m2_losses}</span></b></span>
                    <span className='sb-chip-stat'>Streak L <b>{engine.consec_losses}</b></span>
                    <span className='sb-chip-stat'>Streak W <b>{engine.consec_wins}</b></span>
                    <span className='sb-chip-stat'>M2 Stake <b>${engine.m2_current_stake.toFixed(2)}</b></span>
                </div>
            </section>

            {/* ── Settings strip ───────────────────────────────── */}
            <section className='sb-card sb-strip'>
                <div className='sb-strip__title'>Settings</div>
                <div className='sb-strip__scroll'>
                    {/* Symbol */}
                    <label className='sb-field'>
                        <span>Symbol</span>
                        <select value={settings.symbol}
                            onChange={e => set('symbol', e.target.value)}>
                            {SYMBOLS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                    </label>
                    {/* M1 Type */}
                    <label className='sb-field'>
                        <span>M1 Type</span>
                        <select value={settings.m1.family}
                            onChange={e => {
                                const f = e.target.value as ContractFamily;
                                setM1({ family: f, side: FAMILY_SIDES[f][0].value,
                                    duration: f === 'asian' ? Math.max(5, settings.m1.duration) : settings.m1.duration });
                            }}>
                            {CONTRACT_FAMILIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                    </label>
                    {/* M1 Direction */}
                    <label className='sb-field'>
                        <span>M1 Direction</span>
                        <select value={settings.m1.side}
                            onChange={e => setM1({ side: e.target.value as ContractSide })}>
                            {m1Sides.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                    </label>
                    {/* M1 Barrier (if applicable) */}
                    {m1ShowP && (
                        <label className='sb-field'>
                            <span>M1 {overUnderBarrierRange(settings.m1.family) ? 'Barrier' : 'Digit'}</span>
                            <input type='number' min={m1PMin} max={m1PMax} value={settings.m1.prediction}
                                onChange={e => setM1({ prediction: Number(e.target.value) })} />
                        </label>
                    )}
                    {/* M1 Stake */}
                    <label className='sb-field'>
                        <span>M1 Stake</span>
                        <input type='number' min={0.35} step={0.1} value={settings.m1.stake}
                            onChange={e => setM1({ stake: Number(e.target.value) })} />
                    </label>
                    {/* M1 Duration */}
                    <label className='sb-field'>
                        <span>M1 Duration (ticks)</span>
                        <select value={settings.m1.duration}
                            onChange={e => setM1({ duration: Number(e.target.value) })}>
                            {tickOpts(m1TickMin).map(t => <option key={t} value={t}>{t} tick{t > 1 ? 's' : ''}</option>)}
                        </select>
                    </label>
                    {/* M2 Enabled */}
                    <label className='sb-field' style={{ minWidth: 110 }}>
                        <span>M2 Recovery</span>
                        <Toggle checked={settings.m2_enabled} onChange={v => set('m2_enabled', v)} />
                    </label>
                    {/* M2 Type */}
                    <label className='sb-field'>
                        <span>M2 Type</span>
                        <select value={settings.m2.family} disabled={!settings.m2_enabled}
                            onChange={e => {
                                const f = e.target.value as ContractFamily;
                                setM2({ family: f, side: FAMILY_SIDES[f][0].value,
                                    duration: f === 'asian' ? Math.max(5, settings.m2.duration) : settings.m2.duration });
                            }}>
                            {CONTRACT_FAMILIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                    </label>
                    {/* M2 Direction */}
                    <label className='sb-field'>
                        <span>M2 Direction</span>
                        <select value={settings.m2.side} disabled={!settings.m2_enabled}
                            onChange={e => setM2({ side: e.target.value as ContractSide })}>
                            {m2Sides.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                    </label>
                    {/* M2 Barrier (if applicable) */}
                    {m2ShowP && (
                        <label className='sb-field'>
                            <span>M2 {overUnderBarrierRange(settings.m2.family) ? 'Barrier' : 'Digit'}</span>
                            <input type='number' min={m2PMin} max={m2PMax} value={settings.m2.prediction}
                                disabled={!settings.m2_enabled}
                                onChange={e => setM2({ prediction: Number(e.target.value) })} />
                        </label>
                    )}
                    {/* M2 Stake */}
                    <label className='sb-field'>
                        <span>M2 Stake</span>
                        <input type='number' min={0.35} step={0.1} value={settings.m2.stake}
                            disabled={!settings.m2_enabled}
                            onChange={e => setM2({ stake: Number(e.target.value) })} />
                    </label>
                    {/* M2 Duration */}
                    <label className='sb-field'>
                        <span>M2 Duration (ticks)</span>
                        <select value={settings.m2.duration} disabled={!settings.m2_enabled}
                            onChange={e => setM2({ duration: Number(e.target.value) })}>
                            {tickOpts(m2TickMin).map(t => <option key={t} value={t}>{t} tick{t > 1 ? 's' : ''}</option>)}
                        </select>
                    </label>
                    {/* Martingale */}
                    <label className='sb-field' style={{ minWidth: 110 }}>
                        <span>Martingale</span>
                        <Toggle checked={settings.martingale_enabled}
                            onChange={v => set('martingale_enabled', v)}
                            disabled={!settings.m2_enabled} />
                    </label>
                    <label className='sb-field'>
                        <span>Multiplier ×</span>
                        <input type='number' min={1.1} max={10} step={0.1} value={settings.martingale_multiplier}
                            disabled={!settings.m2_enabled || !settings.martingale_enabled}
                            onChange={e => set('martingale_multiplier', Number(e.target.value))} />
                    </label>
                    <label className='sb-field'>
                        <span>Max Stake Cap</span>
                        <input type='number' min={1} step={0.5} value={settings.max_stake_cap}
                            disabled={!settings.m2_enabled || !settings.martingale_enabled}
                            onChange={e => set('max_stake_cap', Number(e.target.value))} />
                    </label>
                    {/* TP / SL */}
                    <label className='sb-field'>
                        <span>Take Profit</span>
                        <input type='number' min={0} step={0.5} value={settings.take_profit}
                            onChange={e => set('take_profit', Number(e.target.value))} />
                    </label>
                    <label className='sb-field'>
                        <span>Stop Loss</span>
                        <input type='number' min={0} step={0.5} value={settings.stop_loss}
                            onChange={e => set('stop_loss', Number(e.target.value))} />
                    </label>
                    {/* Trade control */}
                    <label className='sb-field'>
                        <span>Max Consec Losses</span>
                        <input type='number' min={0} value={settings.max_consec_losses}
                            onChange={e => set('max_consec_losses', Number(e.target.value))} />
                    </label>
                    <label className='sb-field'>
                        <span>Max Consec Wins</span>
                        <input type='number' min={0} value={settings.max_consec_wins}
                            onChange={e => set('max_consec_wins', Number(e.target.value))} />
                    </label>
                    {/* Cooldown */}
                    <label className='sb-field' style={{ minWidth: 100 }}>
                        <span>Cooldown</span>
                        <Toggle checked={settings.cooldown_enabled}
                            onChange={v => set('cooldown_enabled', v)} />
                    </label>
                    <label className='sb-field'>
                        <span>Pause after losses</span>
                        <input type='number' min={1} value={settings.cooldown_after_losses}
                            disabled={!settings.cooldown_enabled}
                            onChange={e => set('cooldown_after_losses', Number(e.target.value))} />
                    </label>
                    <label className='sb-field'>
                        <span>Resume after (ticks)</span>
                        <input type='number' min={1} value={settings.cooldown_duration_ticks}
                            disabled={!settings.cooldown_enabled}
                            onChange={e => set('cooldown_duration_ticks', Number(e.target.value))} />
                    </label>
                    <button className='sb-btn sb-btn--inline'
                        onClick={() => setSettings({ ...DEFAULT_DF_SETTINGS, m1: { ...DEFAULT_DF_SETTINGS.m1 }, m2: { ...DEFAULT_DF_SETTINGS.m2 } })}>
                        Reset
                    </button>
                </div>
            </section>

            {/* ── Recent Ticks ─────────────────────────────────── */}
            <section className='sb-card sb-strip sb-strip--ticks'>
                <div className='sb-strip__title'>Recent Ticks</div>
                <div className='sb-strip__scroll sb-strip__scroll--ticks'>
                    {recentDigits.length === 0 ? (
                        <span className='sb-empty-inline'>Waiting for ticks…</span>
                    ) : (
                        recentDigits.slice(-30).map((d, i) => (
                            <span key={i} className={`sb-digit ${d % 2 === 0 ? 'even' : 'odd'}`}>{d}</span>
                        ))
                    )}
                </div>
            </section>

            {/* ── Transactions ─────────────────────────────────── */}
            <div className='sb-row sb-row--bottom'>
                <section className='sb-card sb-panel sb-tx'>
                    <div className='sb-panel__head'>
                        <h3 className='sb-card__title'>Transactions ({engine.transactions.length})</h3>
                        <div className='sb-filters'>
                            {(['all', 'm1', 'm2', 'wins', 'losses'] as TFilter[]).map(f => (
                                <button key={f}
                                    className={`sb-chip ${txFilter === f ? 'sb-chip--active' : ''}`}
                                    onClick={() => setTxFilter(f)}>
                                    {f === 'm1' ? 'M1' : f === 'm2' ? 'M2' : f[0].toUpperCase() + f.slice(1)}
                                </button>
                            ))}
                            <button className='sb-chip sb-chip--reset'
                                onClick={() => engine.resetStats()} disabled={running} title='Reset stats'>
                                ↻ Reset
                            </button>
                        </div>
                    </div>

                    <div className='sb-tx__table-wrap'>
                        {filteredTx.length === 0 ? (
                            <div className='sb-empty'>No transactions yet — start the bot to begin.</div>
                        ) : (
                            <table className='sb-tx__table'>
                                <thead>
                                    <tr>
                                        <th>Time</th>
                                        <th>Market</th>
                                        <th>Type</th>
                                        <th className='ar'>Stake</th>
                                        <th className='ar'>Entry</th>
                                        <th className='ar'>Exit</th>
                                        <th>Result</th>
                                        <th className='ar'>P&amp;L</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredTx.map(tx => (
                                        <tr key={tx.id} className={tx.status === 'pending' ? 'sb-tx__row-pending' : tx.is_win ? 'sb-tx__row-win' : 'sb-tx__row-loss'}>
                                            <td className='sb-tx__time'>
                                                {new Date(tx.time).toLocaleTimeString()}
                                            </td>
                                            <td><span className={`sb-tx__vh ${tx.market === 'M2' ? 'neg' : 'pos'}`}>{tx.market}</span></td>
                                            <td>{tx.contract_label}</td>
                                            <td className='ar'>{tx.buy_price.toFixed(2)}</td>
                                            <td className='ar mono'>{tx.entry_price ?? '—'}</td>
                                            <td className='ar mono'>{tx.exit_price ?? '—'}</td>
                                            <td>
                                                <span className={`sb-tx__result ${tx.status === 'pending' ? '' : tx.is_win ? 'pos' : 'neg'}`}>
                                                    {tx.status === 'pending' ? '⏳' : tx.is_win ? '✓ WIN' : '✕ LOSS'}
                                                </span>
                                            </td>
                                            <td className={`ar ${tx.status === 'pending' ? '' : tx.is_win ? 'pos' : 'neg'}`}>
                                                {tx.status === 'pending' ? '—' : `${tx.profit >= 0 ? '+' : ''}${tx.profit.toFixed(2)}`}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    <div className='sb-tx__summary'>
                        <div className='sb-tx__sum-row'>
                            <div className='sb-tx__sum-cell'>
                                <span className='sb-tx__sum-label'>Total Stake</span>
                                <span className='sb-tx__sum-value'>{totalStake.toFixed(2)} USD</span>
                            </div>
                            <div className='sb-tx__sum-cell'>
                                <span className='sb-tx__sum-label'>Total Payout</span>
                                <span className='sb-tx__sum-value'>{totalPayout.toFixed(2)} USD</span>
                            </div>
                            <div className='sb-tx__sum-cell'>
                                <span className='sb-tx__sum-label'>No. of Runs</span>
                                <span className='sb-tx__sum-value'>{engine.total_runs}</span>
                            </div>
                        </div>
                        <div className='sb-tx__sum-row'>
                            <div className='sb-tx__sum-cell'>
                                <span className='sb-tx__sum-label'>Contracts Lost</span>
                                <span className='sb-tx__sum-value'>{engine.m1_losses + engine.m2_losses}</span>
                            </div>
                            <div className='sb-tx__sum-cell'>
                                <span className='sb-tx__sum-label'>Contracts Won</span>
                                <span className='sb-tx__sum-value'>{engine.m1_wins + engine.m2_wins}</span>
                            </div>
                            <div className='sb-tx__sum-cell'>
                                <span className='sb-tx__sum-label'>Total Profit/Loss</span>
                                <span className={`sb-tx__sum-value ${profitCls}`}>
                                    {engine.total_profit >= 0 ? '+' : ''}{engine.total_profit.toFixed(2)} USD
                                </span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ── Journal ──────────────────────────────────── */}
                <section className='sb-card sb-panel'>
                    <div className='sb-panel__head'>
                        <h3 className='sb-card__title'>Journal ({filteredJ.length}/{engine.journal.length})</h3>
                        <div className='sb-filters'>
                            {(['all', 'success', 'warn', 'error', 'info'] as JFilter[]).map(f => (
                                <button key={f}
                                    className={`sb-chip sb-chip--j-${f} ${jFilter === f ? 'sb-chip--active' : ''}`}
                                    onClick={() => setJFilter(f)}>
                                    {f[0].toUpperCase() + f.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className='sb-journal'>
                        {filteredJ.length === 0 ? (
                            <div className='sb-empty'>Journal is empty.</div>
                        ) : (
                            filteredJ.map((j, i) => (
                                <div key={i} className={`sb-journal__entry sb-journal__entry--${j.type}`}>
                                    <span className='sb-journal__time'>{new Date(j.time).toLocaleTimeString()}</span>
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

export default DollarFlowBot;
