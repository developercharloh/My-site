import React, { useEffect, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useStore } from '@/hooks/useStore';
import { observer } from 'mobx-react-lite';
import './commissions-widget.scss';

interface MonthlyComm {
    month: string;
    total: number;
    paid: number;
    pending: number;
}

function getMonthRange(offset: number): { start: number; end: number; label: string } {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const start = Math.floor(d.getTime() / 1000);
    const endD = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
    const end = Math.floor(endD.getTime() / 1000);
    const label = d.toLocaleString('default', { month: 'long', year: 'numeric' });
    return { start, end, label };
}

async function fetchMonthStats(start: number, end: number): Promise<{ total: number; paid: number; pending: number }> {
    try {
        const res: any = await (api_base.api as any)?.send({
            affiliate_account_statistics: 1,
            start_date: start,
            end_date: end,
        });
        const stats = res?.affiliate_account_statistics ?? res?.affiliate_stats ?? {};
        const total   = parseFloat(stats.commission_total   ?? stats.total_commission   ?? stats.commission   ?? '0') || 0;
        const paid    = parseFloat(stats.commission_paid    ?? stats.total_paid         ?? stats.paid         ?? '0') || 0;
        const pending = parseFloat(stats.commission_unpaid  ?? stats.total_pending      ?? stats.pending      ?? '0') || 0;
        return { total, paid, pending: pending || (total - paid) };
    } catch {
        return { total: 0, paid: 0, pending: 0 };
    }
}

type Status = 'idle' | 'loading' | 'loaded' | 'error' | 'not-affiliate';

const CommissionsWidget: React.FC = observer(() => {
    const { client } = useStore();
    const [status, setStatus]   = useState<Status>('idle');
    const [months, setMonths]   = useState<MonthlyComm[]>([]);
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        if (!client.is_logged_in) { setStatus('idle'); return; }

        let cancelled = false;
        setStatus('loading');

        (async () => {
            try {
                const [curr, prev] = [getMonthRange(0), getMonthRange(-1)];
                const [cs, ps] = await Promise.all([
                    fetchMonthStats(curr.start, curr.end),
                    fetchMonthStats(prev.start, prev.end),
                ]);
                if (cancelled) return;

                if (cs.total === 0 && ps.total === 0) {
                    setStatus('not-affiliate');
                    return;
                }

                setMonths([
                    { month: curr.label, ...cs },
                    { month: prev.label, ...ps },
                ]);
                setStatus('loaded');
            } catch {
                if (!cancelled) setStatus('error');
            }
        })();

        return () => { cancelled = true; };
    }, [client.is_logged_in]);

    if (!client.is_logged_in) return null;

    return (
        <div className='cw'>
            <button className='cw__header' onClick={() => setExpanded(p => !p)}>
                <div className='cw__header-left'>
                    <span className='cw__icon'>💰</span>
                    <div>
                        <div className='cw__title'>My Commissions</div>
                        <div className='cw__sub'>Affiliate earnings by month</div>
                    </div>
                </div>
                <span className='cw__chevron'>{expanded ? '▲' : '▼'}</span>
            </button>

            {expanded && (
                <div className='cw__body'>
                    {status === 'loading' && (
                        <div className='cw__state'>
                            <span className='cw__spinner' />
                            <span>Fetching commission data…</span>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className='cw__state cw__state--error'>
                            ⚠️ Could not load commissions. Check your connection and try again.
                        </div>
                    )}

                    {status === 'not-affiliate' && (
                        <div className='cw__state cw__state--info'>
                            <div className='cw__na-icon'>🤝</div>
                            <div className='cw__na-title'>No commission data found</div>
                            <div className='cw__na-sub'>
                                This account is not linked to a Deriv affiliate programme, or has no commissions yet.
                            </div>
                            <a
                                href='https://deriv.com/partners/'
                                target='_blank'
                                rel='noreferrer'
                                className='cw__na-btn'
                            >
                                Join Deriv Affiliate Programme →
                            </a>
                        </div>
                    )}

                    {status === 'loaded' && (
                        <div className='cw__months'>
                            {months.map(m => (
                                <div key={m.month} className='cw__month'>
                                    <div className='cw__month-label'>{m.month}</div>
                                    <div className='cw__month-stats'>
                                        <div className='cw__stat'>
                                            <span className='cw__stat-label'>Total</span>
                                            <span className='cw__stat-val cw__stat-val--total'>
                                                ${m.total.toFixed(2)}
                                            </span>
                                        </div>
                                        <div className='cw__stat'>
                                            <span className='cw__stat-label'>Paid</span>
                                            <span className='cw__stat-val cw__stat-val--paid'>
                                                ✅ ${m.paid.toFixed(2)}
                                            </span>
                                        </div>
                                        <div className='cw__stat'>
                                            <span className='cw__stat-label'>Pending</span>
                                            <span className='cw__stat-val cw__stat-val--pending'>
                                                🕐 ${m.pending.toFixed(2)}
                                            </span>
                                        </div>
                                    </div>
                                    <div className='cw__bar'>
                                        <div
                                            className='cw__bar-fill cw__bar-fill--paid'
                                            style={{ width: m.total > 0 ? `${(m.paid / m.total) * 100}%` : '0%' }}
                                        />
                                    </div>
                                    <div className='cw__bar-labels'>
                                        <span style={{ color: '#10b981' }}>Paid</span>
                                        <span style={{ color: '#f59e0b' }}>Pending</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});

export default CommissionsWidget;
