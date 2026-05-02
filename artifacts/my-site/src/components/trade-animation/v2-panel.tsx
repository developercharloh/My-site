import React from 'react';
import type { EngineLog, EngineStatus } from '@/utils/deriv-v2-engine';
import './v2-panel.scss';

interface V2Stats {
    profit: number;
    wins:   number;
    losses: number;
    stake:  number;
}

interface V2PanelProps {
    status:  EngineStatus;
    logs:    EngineLog[];
    stats:   V2Stats;
    onStop:  () => void;
    onClear: () => void;
}

function statusLabel(s: EngineStatus): string {
    switch (s) {
        case 'scanning':   return '🔍 Scanning…';
        case 'trading':    return '⚡ Trading';
        case 'stopped':    return '■ Stopped';
        case 'error':      return '✖ Error';
        case 'connecting': return '⟳ Connecting…';
        default:           return '—';
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

export const V2Panel = React.memo(({ status, logs, stats, onStop, onClear }: V2PanelProps) => {
    // Fix #8: hide the panel entirely while idle (before any run has started)
    if (status === 'idle') return null;

    const isActive  = status === 'scanning' || status === 'trading';

    const winRate = stats.wins + stats.losses > 0
        ? Math.round((stats.wins / (stats.wins + stats.losses)) * 100)
        : 0;

    const pnlSign   = stats.profit >= 0 ? '+' : '';
    const pnlStr    = `${pnlSign}$${Math.abs(stats.profit).toFixed(2)}`;
    const pnlClass  = stats.profit > 0 ? 'v2p__stat-val--pos'
                    : stats.profit < 0 ? 'v2p__stat-val--neg'
                    : '';

    // Fix #3: no scrollIntoView needed — flex-direction:column-reverse keeps
    //         newest logs naturally at the visual top without any scroll.

    return (
        <div className='v2p'>
            {/* ── Header ───────────────────────────────────────── */}
            <div className='v2p__header'>
                <span className='v2p__title'>⚡ V2 Engine</span>
                <span className={`v2p__status ${statusClass(status)}`}>
                    {statusLabel(status)}
                </span>
                <div className='v2p__header-actions'>
                    <button className='v2p__btn-clear' onClick={onClear} title='Clear log'>
                        🗑
                    </button>
                    {isActive && (
                        <button className='v2p__btn-stop' onClick={onStop}>
                            ■ Stop
                        </button>
                    )}
                </div>
            </div>

            {/* ── Stats ────────────────────────────────────────── */}
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

            {/* ── Log ──────────────────────────────────────────── */}
            {/* Fix #6: use log.seq (stable unique counter) as key, not array index */}
            <div className='v2p__log-wrap'>
                {logs.length === 0 && (
                    <div className='v2p__log-empty'>No trades yet…</div>
                )}
                {logs.map(log => (
                    <div key={log.seq} className={`v2p__log-row ${LOG_TYPE_CLASS[log.type] ?? ''}`}>
                        <span className='v2p__log-time'>{log.time}</span>
                        <span className='v2p__log-msg'>{log.message}</span>
                    </div>
                ))}
            </div>
        </div>
    );
});

V2Panel.displayName = 'V2Panel';
export default V2Panel;
