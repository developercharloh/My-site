import React, { useState } from 'react';
import Cookies from 'js-cookie';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import { buildLegacyAuthUrl } from '@/utils/pkce';
import './login-gate.scss';

const LS = {
    AUTH_TOKEN: 'authToken',
    ACTIVE_LOGINID: 'active_loginid',
    CLIENT_ACCOUNTS: 'clientAccounts',
    ACCOUNTS_LIST: 'accountsList',
} as const;

const setLoggedStateCookie = () => {
    try {
        const domain = window.location.hostname.split('.').slice(-2).join('.');
        Cookies.set('logged_state', 'true', {
            domain,
            expires: 30,
            path: '/',
            secure: window.location.protocol === 'https:',
        });
    } catch { /* ignore */ }
};

const LoginGate: React.FC<{ children: React.ReactNode }> = observer(({ children }) => {
    const { client } = useStore();
    const [showTokenPanel, setShowTokenPanel] = useState(false);
    const [token, setToken] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
    const [errorMsg, setErrorMsg] = useState('');

    if (client?.is_logged_in) return <>{children}</>;

    const handleOAuthLogin = () => {
        window.location.href = buildLegacyAuthUrl();
    };

    const handleTokenLogin = async () => {
        const trimmed = token.trim();
        if (!trimmed) {
            setErrorMsg('Please paste your API token.');
            setStatus('error');
            return;
        }
        setStatus('loading');
        setErrorMsg('');
        let api: ReturnType<typeof generateDerivApiInstance> | null = null;
        try {
            api = await generateDerivApiInstance();
            if (!api) throw new Error('Could not connect to Deriv. Please try again.');

            const result = await (api as any).authorize(trimmed);
            const { authorize, error } = result ?? {};

            if (error) {
                throw new Error(
                    error.code === 'InvalidToken'
                        ? 'Invalid API token. Please check and try again.'
                        : error.message || 'Authorization failed.'
                );
            }
            if (!authorize) throw new Error('No response from Deriv. Please try again.');

            const loginid: string = authorize.loginid ?? authorize.account_list?.[0]?.loginid ?? '';
            const currency: string = authorize.currency ?? 'USD';

            const accountsList: Record<string, string> = {};
            const clientAccounts: Record<string, { loginid: string; token: string; currency: string }> = {};

            (authorize.account_list ?? []).forEach((acc: any) => {
                accountsList[acc.loginid] = trimmed;
                clientAccounts[acc.loginid] = {
                    loginid: acc.loginid,
                    token: trimmed,
                    currency: acc.currency ?? '',
                };
            });

            if (!accountsList[loginid]) {
                accountsList[loginid] = trimmed;
                clientAccounts[loginid] = { loginid, token: trimmed, currency };
            }

            localStorage.setItem(LS.ACCOUNTS_LIST, JSON.stringify(accountsList));
            localStorage.setItem(LS.CLIENT_ACCOUNTS, JSON.stringify(clientAccounts));
            localStorage.setItem('callback_token', JSON.stringify(authorize));
            localStorage.setItem(LS.AUTH_TOKEN, trimmed);
            localStorage.setItem(LS.ACTIVE_LOGINID, loginid);
            setLoggedStateCookie();

            window.location.replace(`/?account=${currency}`);
        } catch (err: any) {
            setErrorMsg(err?.message || 'Connection failed. Please try again.');
            setStatus('error');
        } finally {
            try { (api as any)?.disconnect(); } catch { /* ignore */ }
        }
    };

    return (
        <div className='login-gate'>
            <div className='login-gate__bg'>
                <span className='login-gate__orb login-gate__orb--1' />
                <span className='login-gate__orb login-gate__orb--2' />
                <span className='login-gate__orb login-gate__orb--3' />
            </div>

            <div className='login-gate__wrapper'>
                <div className='login-gate__header'>
                    <img src='/logo.png' alt='Mr CharlohFX' className='login-gate__logo' />
                    <h1 className='login-gate__title'>Mr CharlohFX</h1>
                    <p className='login-gate__tagline'>Where Precision Meets Opportunity</p>
                </div>

                <div className='login-gate__gates login-gate__gates--single'>
                    <div className='login-gate__gate login-gate__gate--center'>
                        <div className='login-gate__gate-badge login-gate__gate-badge--live'>
                            <span className='login-gate__gate-badge-dot' />
                            Live
                        </div>
                        <div className='login-gate__gate-icon'>🔑</div>
                        <h2 className='login-gate__gate-title'>Welcome Back</h2>
                        <p className='login-gate__gate-desc'>
                            Sign in with your Deriv account to access the bot and start trading.
                        </p>

                        {!showTokenPanel ? (
                            <>
                                <button className='login-gate__btn login-gate__btn--primary' onClick={handleOAuthLogin}>
                                    Login with Deriv
                                </button>
                                <button
                                    className='login-gate__btn login-gate__btn--secondary'
                                    style={{ marginTop: '0.6rem', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(212,175,55,0.4)', color: '#d4af37', fontSize: '0.82rem', padding: '0.55rem 1.2rem', borderRadius: '6px', cursor: 'pointer', width: '100%' }}
                                    onClick={() => setShowTokenPanel(true)}
                                >
                                    Use API Token (Wallet accounts)
                                </button>
                            </>
                        ) : (
                            <div style={{ width: '100%', marginTop: '0.5rem' }}>
                                <div style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.25)', borderRadius: '8px', padding: '1rem', marginBottom: '0.75rem', textAlign: 'left' }}>
                                    <p style={{ color: '#d4af37', fontWeight: 600, fontSize: '0.82rem', margin: '0 0 0.4rem 0' }}>How to get your API token:</p>
                                    <ol style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.78rem', paddingLeft: '1.1rem', margin: 0, lineHeight: 1.7 }}>
                                        <li>Open <a href='https://app.deriv.com/account/api-token' target='_blank' rel='noreferrer' style={{ color: '#d4af37' }}>app.deriv.com/account/api-token</a></li>
                                        <li>Create a token with <strong>Read</strong> + <strong>Trade</strong> scopes</li>
                                        <li>Copy the token and paste it below</li>
                                    </ol>
                                </div>
                                <input
                                    type='text'
                                    placeholder='Paste your API token here…'
                                    value={token}
                                    onChange={e => { setToken(e.target.value); setStatus('idle'); setErrorMsg(''); }}
                                    style={{ width: '100%', boxSizing: 'border-box', padding: '0.65rem 0.9rem', borderRadius: '6px', border: '1px solid rgba(212,175,55,0.4)', background: 'rgba(0,0,0,0.35)', color: '#fff', fontSize: '0.8rem', outline: 'none', marginBottom: '0.5rem' }}
                                    onKeyDown={e => { if (e.key === 'Enter') handleTokenLogin(); }}
                                />
                                {status === 'error' && (
                                    <p style={{ color: '#e53e3e', fontSize: '0.78rem', margin: '0 0 0.5rem 0' }}>{errorMsg}</p>
                                )}
                                <button
                                    className='login-gate__btn login-gate__btn--primary'
                                    onClick={handleTokenLogin}
                                    disabled={status === 'loading'}
                                    style={{ opacity: status === 'loading' ? 0.6 : 1 }}
                                >
                                    {status === 'loading' ? 'Connecting…' : 'Connect'}
                                </button>
                                <button
                                    onClick={() => { setShowTokenPanel(false); setToken(''); setStatus('idle'); setErrorMsg(''); }}
                                    style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', cursor: 'pointer', marginTop: '0.5rem', display: 'block', width: '100%' }}
                                >
                                    ← Back to login
                                </button>
                            </div>
                        )}

                        <p className='login-gate__gate-note'>Works with all Deriv accounts</p>
                    </div>
                </div>

                <div className='login-gate__footer-row'>
                    <button
                        className='login-gate__link-btn'
                        onClick={() => window.open('https://track.deriv.com/_ZpTaWpj8mZlZl7VyVw174GNd7ZgqdRLk/1', '_blank')}
                    >
                        Don't have an account? Create one free
                    </button>
                    <p className='login-gate__footer'>Powered by Deriv — regulated &amp; trusted worldwide</p>
                </div>
            </div>
        </div>
    );
});

export default LoginGate;
