import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ouEngine,
    OUSettings,
    DEFAULT_OU_SETTINGS,
    OULookback,
    ALL_SYMBOLS,
    OUScanResult,
} from './ou-engine';

type Theme = 'light' | 'dark';
type JFilter = 'all' | 'info' | 'success' | 'warn' | 'error';
type TFilter = 'all' | 'wins' | 'losses';

const useEngine = () => {
    const [, bump] = useState(0);
    useEffect(() => ouEngine.subscribe(() => bump(t => t + 1)), []);
    return ouEngine;
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

// ── Volatility scanner modal ──────────────────────────────────────────────────

const ScanModal: React.FC<{
    scanning: boolean;
    progress: number;
    results: OUScanResult[];
    currentSymbol: string;
    onUse: (sym: string) => void;
    onClose: () => void;
    onStart: () => void;
}> = ({ scanning, progress, results, currentSymbol, onUse, onClose, onStart }) => {
    const maxRate = results.length > 0 ? results[0].hit_rate : 100;

    return (
        <div className='ou-scan-overlay' onClick={onClose}>
            <div className='ou-scan-modal' onClick={e => e.stopPropagation()}>
                <div className='ou-scan-modal__head'>
                    <span>🔍 Volatility Scanner</span>
                    <button className='ou-scan-modal__close' onClick={onClose}>✕</button>
                </div>
                <p className='ou-scan-modal__sub'>
                    Analyzes last 500 ticks across all 10 volatilities and ranks by O2U7 pattern hit rate.
                </p>
                {scanning ? (
                    <div className='ou-scan-modal__scanning'>
                        <div className='ou-scan-progress-bar'>
                            <div className='ou-scan-progress-bar__fill' style={{ width: `${progress}%` }} />
                        </div>
                        <span className='ou-scan-progress-label'>Scanning… {progress}%</span>
                    </div>
                ) : results.length === 0 ? (
                    <button className='ou-scan-start-btn' onClick={onStart}>
                        ▶ Start Scan
                    </button>
                ) : (
                    <>
                        <div className='ou-scan-results'>
                            {results.map((r, i) => (
                                <div key={r.symbol}
                                     className={`ou-scan-row ${r.symbol === currentSymbol ? 'ou-scan-row--active' : ''} ${i === 0 ? 'ou-scan-row--best' : ''}`}>
                                    <div className='ou-scan-row__rank'>
                                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                                    </div>
                                    <div className='ou-scan-row__info'>
                                        <div className='ou-scan-row__label'>{r.label}</div>
                                        <div className='ou-scan-row__bar-wrap'>
                                            <div className='ou-scan-row__bar'
                                                 style={{ width: `${(r.hit_rate / Math.max(maxRate, 1)) * 100}%` }} />
                                        </div>
                                        <div className='ou-scan-row__stats'>
                                            <span className='pos'>▲{r.over_count}</span>
                                            <span className='neg'>▼{r.under_count}</span>
                                            <span>{r.total_ticks} ticks</span>
                                        </div>
                                    </div>
                                    <div className='ou-scan-row__rate'>{r.hit_rate}%</div>
                                    <button
                                        className={`ou-scan-row__use ${r.symbol === currentSymbol ? 'ou-scan-row__use--active' : ''}`}
                                        onClick={() => { onUse(r.symbol); onClose(); }}
                                    >
                                        {r.symbol === currentSymbol ? '✓ Active' : 'Use'}
                                    </button>
                                </div>
                            ))}
                        </div>
                        <div className='ou-scan-modal__footer'>
                            <button className='ou-scan-start-btn ou-scan-start-btn--rescan' onClick={onStart}>
                                ↺ Re-scan
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

// ── Main component ────────────────────────────────────────────────────────────

const OUBot: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const engine = useEngine();
    const [settings, setSettings] = useState<OUSettings>({ ...DEFAULT_OU_SETTINGS });
    const [theme, setTheme] = useState<Theme>(() =>
        (window.localStorage.getItem('ou_theme') as Theme) || 'light'
    );
    const [jFilter, setJFilter] = useState<JFilter>('all');
    const [txFilter, setTxFilter] = useState<TFilter>('all');
    const [showScanner, setShowScanner] = useState(false);

    const [recentDigits, setRecentDigits] = useState<number[]>([]);
    const prevDigit = useRef<number | null>(null);
    useEffect(() => {
        if (engine.last_digit !== null && engine.last_digit !== prevDigit.current) {
            prevDigit.current = engine.last_digit;
            setRecentDigits(prev => [...prev.slice(-49), engine.last_digit as number]);
        }
    });

    useEffect(() => { engine.updateSettings(settings); }, [settings]);
    useEffect(() => { window.localStorage.setItem('ou_theme', theme); }, [theme]);

    const set = <K extends keyof OUSettings>(k: K, v: OUSettings[K]) =>
        setSettings(p => ({ ...p, [k]: v }));

    const running = engine.is_running;

    const filteredTx = useMemo(() => {
        const txs = engine.trades;
        if (txFilter === 'wins')   return txs.filter(t => t.status === 'won');
        if (txFilter === 'losses') return txs.filter(t => t.status === 'lost');
        return txs;
    }, [engine.trades, txFilter]);

    const filteredJ = useMemo(() => {
        if (jFilter === 'all') return engine.journal;
        return engine.journal.filter(j => j.type === jFilter);
    }, [engine.journal, jFilter]);

    const profitCls  = engine.total_profit > 0 ? 'pos' : engine.total_profit < 0 ? 'neg' : '';
    const event      = engine.last_event;
    const signal     = engine.current_signal;

    const signalLabel = signal === 'over'
        ? `▲ Over ${settings.over_threshold} signal`
        : signal === 'under'
        ? `▼ Under ${settings.under_threshold} signal`
        : '— Watching for pattern…';

    const signalCls = signal === 'over' ? 'ou-signal--over'
        : signal === 'under' ? 'ou-signal--under'
        : 'ou-signal--none';

    const digitCls = (d: number) => {
        if (d <= settings.over_threshold)  return 'ou-digit--over';
        if (d >= settings.under_threshold) return 'ou-digit--under';
        return 'ou-digit--mid';
    };

    const statusLabel = !running ? 'Idle'
        : signal !== 'none' ? `Trading (${signal === 'over' ? 'Over' : 'Under'})`
        : 'Running — watching';

    const statusCls = !running ? 'idle'
        : signal !== 'none' ? 'normal'
        : 'recovery';

    // ── Scanner handlers
    const handleStartScan = () => { void engine.scanBestVolatility(); };
    const handleUseSym    = (sym: string) => {
        set('symbol', sym);
    };

    // ── Digit strip — last N highlighted as lookback window
    const displayDigits  = recentDigits.slice(-30);
    const lookbackStart  = displayDigits.length - settings.lookback;

    // ── Price display
    const priceDisplay = engine.last_quote !== null ? engine.last_quote.toFixed(engine.pip_size) : '—';
    const priceWhole   = priceDisplay !== '—' ? priceDisplay.slice(0, -1) : '—';
    const priceLastDig = priceDisplay !== '—' ? priceDisplay.slice(-1) : '';

    return (
        <div className={`speed-bots speed-bots--${theme} ou-root`}>

            {/* Scanner modal */}
            {showScanner && (
                <ScanModal
                    scanning={engine.scan_status === 'scanning'}
                    progress={engine.scan_progress}
                    results={engine.scan_results}
                    currentSymbol={settings.symbol}
                    onUse={handleUseSym}
                    onClose={() => { setShowScanner(false); engine.dismissScanResults(); }}
                    onStart={handleStartScan}
                />
            )}

            {/* ── Event modal ─────────────────────────────────── */}
            {event && (
                <div className='sb-modal' onClick={() => engine.clearLastEvent()}>
                    <div className='sb-modal__card' onClick={e => e.stopPropagation()}>
                        {event.kind === 'tp' ? (
                            <><div className='sb-modal__emoji'>🎉</div><h2 className='sb-modal__title'>Take Profit Hit!</h2></>
                        ) : event.kind === 'sl' ? (
                            <><div className='sb-modal__emoji'>🙃</div><h2 className='sb-modal__title'>Stop Loss Hit</h2></>
                        ) : (
                            <><div className='sb-modal__emoji'>🏆</div><h2 className='sb-modal__title'>Consecutive Wins Target!</h2></>
                        )}
                        <p className='sb-modal__msg'>{event.message}</p>
                        <button className='sb-modal__close' onClick={() => engine.clearLastEvent()}>Close</button>
                    </div>
                </div>
            )}

            {/* ── Back ─────────────────────────────────────────── */}
            <button type='button' className='sb-launcher__close' onClick={onBack}>← Back to card</button>

            {/* ── Price action bar ─────────────────────────────── */}
            <div className='ou-price-bar'>
                <div className='ou-price-bar__symbol'>
                    <span className='ou-price-bar__sym-label'>
                        {ALL_SYMBOLS.find(s => s.value === settings.symbol)?.label ?? settings.symbol}
                    </span>
                    <span className={`ou-price-bar__live-dot ${engine.has_live_tick ? 'ou-price-bar__live-dot--on' : ''}`} />
                </div>
                <div className='ou-price-bar__price'>
                    <span className='ou-price-bar__whole'>{priceWhole}</span>
                    <span className={`ou-price-bar__last-dig ${engine.last_digit !== null ? digitCls(engine.last_digit) : ''}`}>
                        {priceLastDig || '—'}
                    </span>
                </div>
                <div className='ou-price-bar__digit-badge'>
                    <span className='ou-price-bar__digit-label'>Last Digit</span>
                    <span className={`ou-price-bar__digit-val ${engine.last_digit !== null ? digitCls(engine.last_digit) : ''}`}>
                        {engine.last_digit !== null ? engine.last_digit : '—'}
                    </span>
                </div>
            </div>

            {/* ── Topbar ───────────────────────────────────────── */}
            <div className='speed-bots__topbar'>
                <div className='speed-bots__topbar-stats'>
                    <div className='sb-top-stat sb-top-stat--accent'>
                        <span className='sb-top-stat__label'>Status</span>
                        <span className={`sb-top-stat__value ${statusCls}`}>{statusLabel}</span>
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

            {/* ── Signal banner ─────────────────────────────────── */}
            <section className={`sb-mode-banner ou-signal-banner ${signalCls}`}>
                <div className='sb-mode-banner__label'>{signalLabel}</div>
                <div className='sb-mode-banner__chips'>
                    <span className='sb-chip-stat'>W/L <b><span className='pos'>{engine.wins}</span>/<span className='neg'>{engine.losses}</span></b></span>
                    <span className='sb-chip-stat'>Consec W <b>{engine.consec_wins}</b></span>
                    <span className='sb-chip-stat'>Consec L <b>{engine.consec_losses}</b></span>
                    <span className='sb-chip-stat'>Next Stake <b>${engine.current_stake.toFixed(2)}</b></span>
                </div>

                {/* Pattern condition checker */}
                <div className='ou-condition-checker'>
                    {(() => {
                        const lbWindow = engine.tick_history.slice(-settings.lookback);
                        const hasDigits = lbWindow.length > 0;

                        const overMet   = lbWindow.map(d => d <= settings.over_threshold);
                        const underMet  = lbWindow.map(d => d >= settings.under_threshold);
                        const allOver   = hasDigits && lbWindow.length === settings.lookback && overMet.every(Boolean);
                        const allUnder  = hasDigits && lbWindow.length === settings.lookback && underMet.every(Boolean);

                        return (
                            <>
                                {/* Over row */}
                                <div className='ou-cond-row'>
                                    <span className='ou-cond-row__label ou-cond-row__label--over'>
                                        ≤{settings.over_threshold} Over
                                    </span>
                                    <div className='ou-cond-row__digits'>
                                        {!hasDigits ? (
                                            <span className='ou-cond-empty'>Waiting…</span>
                                        ) : (
                                            Array.from({ length: settings.lookback }).map((_, i) => {
                                                const d = lbWindow[i];
                                                const met = d !== undefined && d <= settings.over_threshold;
                                                const filled = d !== undefined;
                                                return (
                                                    <span key={i} className={`ou-cond-cell ${filled ? (met ? 'ou-cond-cell--ok' : 'ou-cond-cell--fail') : 'ou-cond-cell--empty'}`}>
                                                        {filled ? d : '?'}
                                                        <span className='ou-cond-mark'>{filled ? (met ? '✅' : '❌') : ''}</span>
                                                    </span>
                                                );
                                            })
                                        )}
                                    </div>
                                    <span className={`ou-cond-signal ${allOver ? 'ou-cond-signal--fire' : ''}`}>
                                        {allOver ? '🔴 Signal!' : 'No signal'}
                                    </span>
                                </div>

                                {/* Under row */}
                                <div className='ou-cond-row'>
                                    <span className='ou-cond-row__label ou-cond-row__label--under'>
                                        ≥{settings.under_threshold} Under
                                    </span>
                                    <div className='ou-cond-row__digits'>
                                        {!hasDigits ? (
                                            <span className='ou-cond-empty'>Waiting…</span>
                                        ) : (
                                            Array.from({ length: settings.lookback }).map((_, i) => {
                                                const d = lbWindow[i];
                                                const met = d !== undefined && d >= settings.under_threshold;
                                                const filled = d !== undefined;
                                                return (
                                                    <span key={i} className={`ou-cond-cell ${filled ? (met ? 'ou-cond-cell--ok' : 'ou-cond-cell--fail') : 'ou-cond-cell--empty'}`}>
                                                        {filled ? d : '?'}
                                                        <span className='ou-cond-mark'>{filled ? (met ? '✅' : '❌') : ''}</span>
                                                    </span>
                                                );
                                            })
                                        )}
                                    </div>
                                    <span className={`ou-cond-signal ${allUnder ? 'ou-cond-signal--fire' : ''}`}>
                                        {allUnder ? '🔴 Signal!' : 'No signal'}
                                    </span>
                                </div>
                            </>
                        );
                    })()}
                </div>
            </section>

            {/* ── Settings ─────────────────────────────────────── */}
            <section className='sb-card sb-strip'>
                <div className='sb-strip__title'>Settings</div>
                <div className='sb-strip__scroll'>
                    <div className='ou-symbol-row'>
                        <label className='sb-field'>
                            <span>Symbol</span>
                            <select value={settings.symbol}
                                onChange={e => set('symbol', e.target.value)}>
                                {ALL_SYMBOLS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                        </label>
                        <button
                            className='ou-scan-btn'
                            disabled={engine.scan_status === 'scanning'}
                            onClick={() => setShowScanner(true)}
                            title='Scan all volatilities for best hit rate'
                        >
                            🔍 Scan
                        </button>
                    </div>
                    <label className='sb-field'>
                        <span>Lookback (digits)</span>
                        <select value={settings.lookback}
                            onChange={e => set('lookback', Number(e.target.value) as OULookback)}>
                            {([1, 2, 3, 4] as OULookback[]).map(n => (
                                <option key={n} value={n}>Last {n} digit{n > 1 ? 's' : ''}</option>
                            ))}
                        </select>
                    </label>
                    <label className='sb-field'>
                        <span>Over barrier (≤)</span>
                        <input type='number' min={0} max={4} value={settings.over_threshold}
                            onChange={e => set('over_threshold', Number(e.target.value))} />
                    </label>
                    <label className='sb-field'>
                        <span>Under barrier (≥)</span>
                        <input type='number' min={5} max={9} value={settings.under_threshold}
                            onChange={e => set('under_threshold', Number(e.target.value))} />
                    </label>
                    <label className='sb-field'>
                        <span>Stake ($)</span>
                        <input type='number' min={0.35} step={0.1} value={settings.stake}
                            onChange={e => set('stake', Number(e.target.value))} />
                    </label>
                    <label className='sb-field' style={{ minWidth: 110 }}>
                        <span>Martingale</span>
                        <Toggle checked={settings.martingale_enabled}
                            onChange={v => set('martingale_enabled', v)} />
                    </label>
                    <label className='sb-field'>
                        <span>Multiplier ×</span>
                        <input type='number' min={1.1} max={10} step={0.1}
                            value={settings.martingale_multiplier}
                            disabled={!settings.martingale_enabled}
                            onChange={e => set('martingale_multiplier', Number(e.target.value))} />
                    </label>
                    <label className='sb-field'>
                        <span>Max Stake Cap</span>
                        <input type='number' min={1} step={0.5} value={settings.max_stake_cap}
                            disabled={!settings.martingale_enabled}
                            onChange={e => set('max_stake_cap', Number(e.target.value))} />
                    </label>
                    <label className='sb-field'>
                        <span>Take Profit ($)</span>
                        <input type='number' min={0} step={0.5} value={settings.take_profit}
                            onChange={e => set('take_profit', Number(e.target.value))} />
                    </label>
                    <label className='sb-field'>
                        <span>Stop Loss ($)</span>
                        <input type='number' min={0} step={0.5} value={settings.stop_loss}
                            onChange={e => set('stop_loss', Number(e.target.value))} />
                    </label>
                    <label className='sb-field'>
                        <span>Consec Wins Target</span>
                        <input type='number' min={0} value={settings.consec_wins_target}
                            onChange={e => set('consec_wins_target', Number(e.target.value))} />
                    </label>
                    <label className='sb-field' style={{ minWidth: 100 }}>
                        <span>Sound</span>
                        <Toggle checked={settings.sound_enabled}
                            onChange={v => set('sound_enabled', v)} />
                    </label>
                    <button className='sb-btn sb-btn--inline'
                        onClick={() => setSettings({ ...DEFAULT_OU_SETTINGS })}>
                        Reset
                    </button>
                </div>
            </section>

            {/* ── Recent Ticks ─────────────────────────────────── */}
            <section className='sb-card sb-strip sb-strip--ticks'>
                <div className='sb-strip__title'>
                    Recent Digits
                    <span className='ou-legend'>
                        <span className='ou-legend__item ou-digit--over'>≤{settings.over_threshold} Over</span>
                        <span className='ou-legend__item ou-digit--under'>≥{settings.under_threshold} Under</span>
                    </span>
                    <span className='ou-lookback-label'>Lookback window: last {settings.lookback}</span>
                </div>
                <div className='sb-strip__scroll sb-strip__scroll--ticks'>
                    {displayDigits.length === 0 ? (
                        <span className='sb-empty-inline'>Waiting for ticks…</span>
                    ) : (
                        displayDigits.map((d, i) => {
                            const isWindow = i >= lookbackStart;
                            return (
                                <span
                                    key={i}
                                    className={`sb-digit ${digitCls(d)} ${isWindow ? 'ou-digit--window' : ''}`}
                                >
                                    {d}
                                </span>
                            );
                        })
                    )}
                </div>
            </section>

            {/* ── Bottom panels ─────────────────────────────────── */}
            <div className='sb-row sb-row--bottom'>
                {/* Transactions */}
                <section className='sb-card sb-panel sb-tx'>
                    <div className='sb-panel__head'>
                        <h3 className='sb-card__title'>Trades ({engine.trades.length})</h3>
                        <div className='sb-filters'>
                            {(['all', 'wins', 'losses'] as TFilter[]).map(f => (
                                <button key={f}
                                    className={`sb-chip ${txFilter === f ? 'sb-chip--active' : ''}`}
                                    onClick={() => setTxFilter(f)}>
                                    {f[0].toUpperCase() + f.slice(1)}
                                </button>
                            ))}
                            <button className='sb-chip sb-chip--reset'
                                onClick={() => engine.resetStats()} disabled={running}>
                                ↻ Reset
                            </button>
                        </div>
                    </div>
                    <div className='sb-tx__table-wrap'>
                        {filteredTx.length === 0 ? (
                            <div className='sb-empty'>No trades yet — start the bot to begin.</div>
                        ) : (
                            <table className='sb-tx__table'>
                                <thead>
                                    <tr>
                                        <th>Time</th>
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
                                        <tr key={tx.id} className={tx.status === 'pending' ? 'pending-row' : tx.is_win ? 'win-row' : 'loss-row'}>
                                            <td>{new Date(tx.time).toLocaleTimeString()}</td>
                                            <td>{tx.label}</td>
                                            <td className='ar'>${tx.buy_price.toFixed(2)}</td>
                                            <td className='ar ou-price-cell'>{tx.entry_price ?? '—'}</td>
                                            <td className='ar ou-price-cell'>{tx.exit_price ?? '—'}</td>
                                            <td className={tx.status === 'pending' ? '' : tx.is_win ? 'pos' : 'neg'}>
                                                {tx.status === 'pending' ? '⏳' : tx.is_win ? 'WIN' : 'LOSS'}
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
                    {engine.trades.length > 0 && (
                        <div className='df-tx-sum'>
                            <span className='df-tx-sum-cell'>Trades <strong>{engine.total_runs}</strong></span>
                            <span className='df-tx-sum-cell'>W <strong className='pos'>{engine.wins}</strong></span>
                            <span className='df-tx-sum-cell'>L <strong className='neg'>{engine.losses}</strong></span>
                            <span className='df-tx-sum-cell'>P&amp;L <strong className={profitCls}>
                                {engine.total_profit >= 0 ? '+' : ''}{engine.total_profit.toFixed(2)}
                            </strong></span>
                        </div>
                    )}
                </section>

                {/* Journal */}
                <section className='sb-card sb-panel sb-journal'>
                    <div className='sb-panel__head'>
                        <h3 className='sb-card__title'>Journal</h3>
                        <div className='sb-filters'>
                            {(['all', 'info', 'success', 'warn', 'error'] as JFilter[]).map(f => (
                                <button key={f}
                                    className={`sb-chip ${jFilter === f ? 'sb-chip--active' : ''}`}
                                    onClick={() => setJFilter(f)}>
                                    {f[0].toUpperCase() + f.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className='sb-journal__list'>
                        {filteredJ.length === 0 ? (
                            <div className='sb-empty'>No log entries yet.</div>
                        ) : (
                            filteredJ.map(j => (
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

export default OUBot;
