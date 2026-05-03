import React from 'react';
import type { EngineLog, EngineStatus, TradeRecord } from '@/utils/deriv-v2-engine';
import './v2-panel.scss';

interface V2Stats {
    profit: number;
    wins:   number;
    losses: number;
    stake:  number;
}

interface V2Alert {
    kind:   'tp' | 'sl';
    amount: number;
    profit: number;
    seq:    number;
}

interface V2PanelProps {
    status:          EngineStatus;
    logs:            EngineLog[];
    tradeRecords:    TradeRecord[];
    stats:           V2Stats;
    alert?:          V2Alert | null;
    onStop:          () => void;
    onClear:         () => void;
    onDismissAlert?: () => void;
}

function statusLabel(s: EngineStatus): string {
    switch (s) {
        case 'scanning':   return '🔍 Scanning…';
        case 'trading':    return '⚡ Trading';
        case 'stopped':    return '■ Stopped';
        case 'error':      return '✖ Error';
        case 'connecting': return '⟳ Connecting…';
        default:           return '— Ready';
    }
}

function statusClass(s: EngineStatus): string {
    if (s === 'trading')  return 'v2p__status--trading';
    if (s === 'scanning') return 'v2p__status--scanning';
    if (s === 'error')    return 'v2p__status--error';
    if (s === 'stopped')  return 'v2p__status--stopped';
    return '';
}

const LOG_TYPE_CLASS: Record<string, string> = {
    win:    'v2p__log--win',
    loss:   'v2p__log--loss',
    error:  'v2p__log--error',
    info:   'v2p__log--info',
    scan:   'v2p__log--scan',
    system: 'v2p__log--system',
};

const D_COLORS = [
    '#6366f1','#8b5cf6','#0ea5e9','#10b981',
    '#eab308','#f97316','#ef4444','#ec4899','#14b8a6','#84cc16',
];

function DigitBadge({ digit, label }: { digit: number; label: string }) {
    const color = D_COLORS[digit] ?? '#64748b';
    return (
        <div className='v2p__digit' title={label}>
            <span className='v2p__digit-label'>{label}</span>
            <span className='v2p__digit-val' style={{ background: color }}>{digit}</span>
        </div>
    );
}

export const V2Panel = React.memo(({ status, logs, tradeRecords, stats, alert, onStop, onClear, onDismissAlert }: V2PanelProps) => {
    const [activeTab, setActiveTab] = React.useState<'log' | 'trades'>('log');

    // Auto-dismiss the TP/SL banner after 8 seconds
    React.useEffect(() => {
        if (!alert || !onDismissAlert) return;
        const id = window.setTimeout(() => onDismissAlert(), 8000);
        return () => window.clearTimeout(id);
    }, [alert?.seq, onDismissAlert]);

    const isActive = status === 'scanning' || status === 'trading';

    const winRate = stats.wins + stats.losses > 0
        ? Math.round((stats.wins / (stats.wins + stats.losses)) * 100)
        : 0;

    const pnlSign  = stats.profit >= 0 ? '+' : '';
    const pnlStr   = `${pnlSign}$${Math.abs(stats.profit).toFixed(2)}`;
    const pnlClass = stats.profit > 0 ? 'v2p__stat-val--pos'
                   : stats.profit < 0 ? 'v2p__stat-val--neg'
                   : '';

    return (
        <div className='v2p'>
            {/* ── TP / SL Alert overlay ────────────────────────── */}
            {alert && (
                <div className={`v2p__alert v2p__alert--${alert.kind}`} role='status' aria-live='polite'>
                    <div className='v2p__alert-icon'>{alert.kind === 'tp' ? '🎯' : '🛑'}</div>
                    <div className='v2p__alert-body'>
                        <div className='v2p__alert-title'>
                            {alert.kind === 'tp' ? 'Take Profit Hit!' : 'Stop Loss Hit!'}
                        </div>
                        <div className='v2p__alert-msg'>
                            {alert.kind === 'tp'
                                ? <>Target <strong>${alert.amount.toFixed(2)}</strong> reached · P&amp;L <strong>+${alert.profit.toFixed(2)}</strong> · engine stopped.</>
                                : <>Limit <strong>${alert.amount.toFixed(2)}</strong> reached · P&amp;L <strong>-${Math.abs(alert.profit).toFixed(2)}</strong> · engine stopped.</>
                            }
                        </div>
                    </div>
                    {onDismissAlert && (
                        <button className='v2p__alert-close' onClick={onDismissAlert} title='Dismiss'>✕</button>
                    )}
                </div>
            )}

            {/* ── Header ───────────────────────────────────────── */}
            <div className='v2p__header'>
                <span className='v2p__title'>⚡ V2 Engine</span>
                <span className={`v2p__status ${statusClass(status)}`}>
                    {statusLabel(status)}
                </span>
                <div className='v2p__header-actions'>
                    <button className='v2p__btn-clear' onClick={onClear} title='Clear log & trades'>🗑</button>
                    {isActive && (
                        <button className='v2p__btn-stop' onClick={onStop}>■ Stop</button>
                    )}
                </div>
            </div>

            {/* ── Stats row ────────────────────────────────────── */}
            <div className='v2p__stats'>
                <div className='v2p__stat'>
                    <span className='v2p__stat-label'>P&amp;L</span>
                    <span className={`v2p__stat-val ${pnlClass}`}>{pnlStr}</span>
                </div>
                <div className='v2p__stat'>
                    <span className='v2p__stat-label'>Wins</span>
                    <span className='v2p__stat-val v2p__stat-val--pos'>{stats.wins}</span>
                </div>
                <div className='v2p__stat'>
                    <span className='v2p__stat-label'>Losses</span>
                    <span className='v2p__stat-val v2p__stat-val--neg'>{stats.losses}</span>
                </div>
                <div className='v2p__stat'>
                    <span className='v2p__stat-label'>Win %</span>
                    <span className='v2p__stat-val'>{winRate}%</span>
                </div>
                <div className='v2p__stat'>
                    <span className='v2p__stat-label'>Stake</span>
                    <span className='v2p__stat-val'>${stats.stake.toFixed(2)}</span>
                </div>
            </div>

            {/* ── Tab bar ──────────────────────────────────────── */}
            <div className='v2p__tabs'>
                <button
                    className={`v2p__tab ${activeTab === 'log' ? 'v2p__tab--active' : ''}`}
                    onClick={() => setActiveTab('log')}
                >
                    📋 Log
                </button>
                <button
                    className={`v2p__tab ${activeTab === 'trades' ? 'v2p__tab--active' : ''}`}
                    onClick={() => setActiveTab('trades')}
                >
                    📊 Trades {tradeRecords.length > 0 && <span className='v2p__tab-count'>{tradeRecords.length}</span>}
                </button>
            </div>

            {/* ── Log view ──────────────────────────────────────── */}
            {activeTab === 'log' && (
                <div className='v2p__log-wrap'>
                    {logs.length === 0 && (
                        <div className='v2p__log-empty'>No activity yet…</div>
                    )}
                    {logs.map(log => (
                        <div key={log.seq} className={`v2p__log-row ${LOG_TYPE_CLASS[log.type] ?? ''}`}>
                            <span className='v2p__log-time'>{log.time}</span>
                            <span className='v2p__log-msg'>{log.message}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Trades / Journal view ─────────────────────────── */}
            {activeTab === 'trades' && (
                <div className='v2p__log-wrap'>
                    {tradeRecords.length === 0 && (
                        <div className='v2p__log-empty'>No trades settled yet…</div>
                    )}
                    {tradeRecords.map(r => {
                        const pnl      = r.totalPnl;
                        const pnlColor = pnl >= 0 ? '#10b981' : '#ef4444';
                        const rowClass = r.isWin ? 'v2p__trade--win' : 'v2p__trade--loss';
                        return (
                            <div key={r.seq} className={`v2p__trade-row ${rowClass}`}>
                                {/* Result badge */}
                                <div className={`v2p__trade-result ${r.isWin ? 'v2p__trade-result--win' : 'v2p__trade-result--loss'}`}>
                                    {r.isWin ? '✅' : '❌'}
                                </div>

                                {/* Main info */}
                                <div className='v2p__trade-body'>
                                    <div className='v2p__trade-row1'>
                                        <span className='v2p__trade-contract'>{r.contractLabel}</span>
                                        <span className='v2p__trade-profit'
                                            style={{ color: r.isWin ? '#10b981' : '#ef4444' }}>
                                            {r.isWin ? '+' : ''}{r.profit.toFixed(2)}
                                        </span>
                                    </div>
                                    <div className='v2p__trade-row2'>
                                        {/* Digit info */}
                                        <DigitBadge digit={r.entryPoint}  label='entry' />
                                        <span className='v2p__trade-arrow'>→</span>
                                        <DigitBadge digit={r.triggerDigit} label='trigger' />
                                        {r.exitDigit !== null && (
                                            <>
                                                <span className='v2p__trade-arrow'>→</span>
                                                <DigitBadge digit={r.exitDigit} label='exit' />
                                            </>
                                        )}
                                        <span className='v2p__trade-stake'>${ r.stake.toFixed(2)}</span>
                                    </div>
                                    {(r.triggerPrice || r.exitPrice) && (
                                        <div className='v2p__trade-row-prices'>
                                            <span className='v2p__trade-price'>{r.triggerPrice ?? '—'}</span>
                                            <span className='v2p__trade-price-arrow'>→</span>
                                            <span className='v2p__trade-price'>{r.exitPrice ?? '—'}</span>
                                        </div>
                                    )}
                                    <div className='v2p__trade-row3'>
                                        <span className='v2p__trade-time'>{r.time}</span>
                                        <span className='v2p__trade-pnl' style={{ color: pnlColor }}>
                                            P&amp;L {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
});

V2Panel.displayName = 'V2Panel';
export default V2Panel;
