import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    fetchNewApiAccounts,
    getOtpWebSocketUrl,
    NEW_AUTH,
    type DerivAccount,
} from '@/utils/pkce';
import './new-api-account-panel.scss';

const fmt = (n: number, currency = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);

const NewApiAccountPanel: React.FC = () => {
    const [accounts, setAccounts] = useState<DerivAccount[]>([]);
    const [activeId, setActiveId] = useState<string>('');
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const panelRef = useRef<HTMLDivElement>(null);

    const token = localStorage.getItem('deriv_access_token');

    const loadAccounts = useCallback(async () => {
        if (!token) { setLoading(false); return; }
        try {
            const data = await fetchNewApiAccounts(token);
            if (data && data.length > 0) {
                setAccounts(data);
                const stored = localStorage.getItem('active_loginid');
                const match = data.find(a => a.account_id === stored);
                setActiveId(match ? match.account_id : data[0].account_id);
            }
        } catch { /* silent */ } finally { setLoading(false); }
    }, [token]);

    useEffect(() => { loadAccounts(); }, [loadAccounts]);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const switchAccount = async (accountId: string) => {
        const acc = accounts.find(a => a.account_id === accountId);
        if (!acc || !token) return;
        localStorage.setItem('active_loginid', accountId);
        localStorage.setItem('authToken', token);

        try {
            const wsUrl = await getOtpWebSocketUrl(token, accountId);
            if (wsUrl) localStorage.setItem('deriv_ws_url', wsUrl);
        } catch { /* ignore */ }

        setActiveId(accountId);
        setOpen(false);

        const search = new URLSearchParams(window.location.search);
        search.set('account', acc.account_type === 'demo' ? 'demo' : acc.currency);
        window.history.pushState({}, '', `${window.location.pathname}?${search.toString()}`);
    };

    if (!token || loading || accounts.length === 0) return null;

    const active = accounts.find(a => a.account_id === activeId) ?? accounts[0];

    const resetDemoBalance = async (accountId: string) => {
        if (!token) return;
        try {
            await fetch(`${NEW_AUTH.API_BASE}/trading/v1/options/accounts/${accountId}/reset-demo-balance`, {
                method: 'POST',
                headers: {
                    'Deriv-App-ID': NEW_AUTH.CLIENT_ID,
                    Authorization: `Bearer ${token}`,
                },
            });
            await loadAccounts();
        } catch { /* ignore */ }
    };

    return (
        <div className='nap' ref={panelRef}>
            <button className='nap__trigger' onClick={() => setOpen(p => !p)}>
                <span className={`nap__dot nap__dot--${active.account_type}`} />
                <span className='nap__label'>
                    {active.account_type === 'demo' ? 'Demo' : 'Real'}
                </span>
                <span className='nap__balance'>{fmt(active.balance, active.currency)}</span>
                <span className='nap__arrow'>{open ? '▲' : '▼'}</span>
            </button>

            {open && (
                <div className='nap__dropdown'>
                    <div className='nap__dropdown-header'>My Accounts</div>
                    {accounts.map(acc => (
                        <button
                            key={acc.account_id}
                            className={`nap__item ${acc.account_id === activeId ? 'nap__item--active' : ''}`}
                            onClick={() => switchAccount(acc.account_id)}
                        >
                            <span className={`nap__dot nap__dot--${acc.account_type}`} />
                            <span className='nap__item-info'>
                                <span className='nap__item-type'>
                                    {acc.account_type === 'demo' ? 'Demo' : 'Real'} — {acc.account_id}
                                </span>
                                <span className='nap__item-bal'>{fmt(acc.balance, acc.currency)}</span>
                            </span>
                            {acc.account_id === activeId && <span className='nap__check'>✓</span>}
                        </button>
                    ))}

                    {active.account_type === 'demo' && (
                        <button
                            className='nap__reset'
                            onClick={e => { e.stopPropagation(); resetDemoBalance(active.account_id); }}
                        >
                            ↺ Reset demo balance
                        </button>
                    )}

                    <button
                        className='nap__refresh'
                        onClick={e => { e.stopPropagation(); setLoading(true); loadAccounts(); }}
                    >
                        ↻ Refresh balances
                    </button>
                </div>
            )}
        </div>
    );
};

export default NewApiAccountPanel;
