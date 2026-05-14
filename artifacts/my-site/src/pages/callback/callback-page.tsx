import React, { useEffect, useMemo, useState } from 'react';
import Cookies from 'js-cookie';
import { crypto_currencies_display_order, fiat_currencies_display_order } from '@/components/shared';
import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { clearAuthData } from '@/utils/auth-utils';
import { Callback } from '@deriv-com/auth-client';
import { Button } from '@deriv-com/ui';
import '@/components/login-gate/login-gate.scss';

// ─── Constants ────────────────────────────────────────────────────────────────

const LS = {
    GATE: 'login_gate',
    AUTH_TOKEN: 'authToken',
    ACTIVE_LOGINID: 'active_loginid',
    CLIENT_ACCOUNTS: 'clientAccounts',
    ACCOUNTS_LIST: 'accountsList',
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getSelectedCurrency = (
    tokens: Record<string, string>,
    clientAccounts: Record<string, any>,
    state: any
): string => {
    const params = new URLSearchParams(window.location.search);
    const currency = (state?.account) || params.get('account') || '';
    const firstAccountCurrency = clientAccounts[tokens.acct1]?.currency;
    const valid = [...fiat_currencies_display_order, ...crypto_currencies_display_order];
    if (tokens.acct1?.startsWith('VR') || currency === 'demo') return 'demo';
    if (currency && valid.includes(currency.toUpperCase())) return currency;
    return firstAccountCurrency || 'USD';
};

const buildClientMaps = (tokens: Record<string, string>) => {
    const accountsList: Record<string, string> = {};
    const clientAccounts: Record<string, { loginid: string; token: string; currency: string }> = {};
    for (const [key, value] of Object.entries(tokens)) {
        if (key.startsWith('acct')) {
            const tokenKey = key.replace('acct', 'token');
            if (tokens[tokenKey]) {
                accountsList[value] = tokens[tokenKey];
                clientAccounts[value] = { loginid: value, token: tokens[tokenKey], currency: '' };
            }
        } else if (key.startsWith('cur')) {
            const accKey = key.replace('cur', 'acct');
            if (tokens[accKey] && clientAccounts[tokens[accKey]]) {
                clientAccounts[tokens[accKey]].currency = value;
            }
        }
    }
    return { accountsList, clientAccounts };
};

/**
 * storeTokens — verify token1 against ws.derivws.com and persist everything
 * to localStorage.  Returns the selected currency string.
 */
const storeTokens = async (
    tokens: Record<string, string>,
    rawState: unknown
): Promise<string> => {
    const state = rawState as { account?: string } | null;
    const { accountsList, clientAccounts } = buildClientMaps(tokens);
    localStorage.setItem(LS.ACCOUNTS_LIST, JSON.stringify(accountsList));
    localStorage.setItem(LS.CLIENT_ACCOUNTS, JSON.stringify(clientAccounts));

    let is_token_set = false;
    let api: ReturnType<typeof generateDerivApiInstance> | null = null;
    try {
        api = await generateDerivApiInstance();
        if (api) {
            const { authorize, error } = (await api.authorize(tokens.token1)) ?? {};
            if (error) {
                if (error.code === 'InvalidToken') {
                    is_token_set = true;
                    const is_tmb_enabled = (window as any).is_tmb_enabled === true;
                    if (Cookies.get('logged_state') === 'true' && !is_tmb_enabled) {
                        globalObserver.emit('InvalidToken', { error });
                    }
                    if (Cookies.get('logged_state') === 'false') clearAuthData();
                }
            } else if (authorize) {
                localStorage.setItem('callback_token', JSON.stringify(authorize));
                const firstId = authorize?.account_list?.[0]?.loginid;
                const filtered = Object.values(clientAccounts).filter(a => a.loginid === firstId);
                const tok = filtered[0]?.token ?? tokens.token1;
                const lid = filtered[0]?.loginid ?? tokens.acct1;
                localStorage.setItem(LS.AUTH_TOKEN, tok);
                localStorage.setItem(LS.ACTIVE_LOGINID, lid);
                is_token_set = true;
            }
        }
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('Pre-auth verify failed; using raw token:', err);
    } finally {
        try { api?.disconnect(); } catch { /* ignore */ }
    }
    if (!is_token_set) {
        localStorage.setItem(LS.AUTH_TOKEN, tokens.token1);
        localStorage.setItem(LS.ACTIVE_LOGINID, tokens.acct1);
    }
    return getSelectedCurrency(tokens, clientAccounts, state);
};

const collectLegacyTokensFromQuery = (): Record<string, string> | null => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('token1') || !params.get('acct1')) return null;
    const tokens: Record<string, string> = {};
    for (const [k, v] of params.entries()) tokens[k] = v;
    return tokens;
};

/**
 * finishSession — broadcast to any popup opener and navigate to root.
 */
const finishSession = (currency: string) => {
    const msg = { type: 'deriv-oauth-tokens', currency };
    try { const bc = new BroadcastChannel('deriv-oauth'); bc.postMessage(msg); bc.close(); } catch { /* ignore */ }
    if (window.opener && !window.opener.closed) {
        try { window.opener.postMessage(msg, window.location.origin); window.close(); return; } catch { /* ignore */ }
    }
    window.location.replace(`/?account=${currency}`);
};

// ─── Main CallbackPage ────────────────────────────────────────────────────────

const CallbackPage: React.FC = () => {
    const [legacyError, setLegacyError] = useState<string | null>(null);

    const params = useMemo(() => new URLSearchParams(window.location.search), []);
    const legacyTokens = useMemo(() => collectLegacyTokensFromQuery(), []);
    const hasCode = params.has('code');
    const hasError = params.has('error');

    // ── Error from Deriv ──────────────────────────────────────────────────────
    if (hasError) {
        const desc = params.get('error_description') || params.get('error') || 'Unknown error';
        return (
            <div style={{ textAlign: 'center', padding: '4rem 2rem', maxWidth: 500, margin: '0 auto', color: '#fff' }}>
                <h2 style={{ color: '#d4af37' }}>Login error</h2>
                <p style={{ color: 'rgba(255,255,255,0.75)', marginBottom: '2rem' }}>{desc}</p>
                <Button className='callback-return-button' onClick={() => window.location.replace('/')}>Back to login</Button>
            </div>
        );
    }

    // ── Legacy tokens: token1 + acct1 in query string ─────────────────────────
    // Handles both legacy popup gate (oauth.deriv.com → token1/acct1) and any
    // case where Deriv returns legacy tokens directly.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
        if (!legacyTokens) return;
        storeTokens(legacyTokens, params.get('account') ? { account: params.get('account') } : null)
            .then(currency => finishSession(currency))
            .catch(err => setLegacyError(err?.message || 'Unexpected error during sign-in'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Nothing useful → go home ──────────────────────────────────────────────
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
        if (legacyTokens || hasCode || hasError) return;
        window.location.replace('/');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (legacyTokens) {
        if (legacyError) {
            return (
                <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#fff' }}>
                    <h2>Sign-in failed</h2>
                    <p>{legacyError}</p>
                    <Button className='callback-return-button' onClick={() => (window.location.href = '/')}>Return to Bot</Button>
                </div>
            );
        }
        return <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#fff' }}><p>Signing you in…</p></div>;
    }

    // ── OIDC code from requestOidcAuthentication (new gate) ───────────────────
    // The @deriv-com/auth-client Callback component:
    //  1. Exchanges ?code= for an OIDC access_token via oauth.deriv.com/oauth2/token
    //  2. POSTs the access_token to oauth.deriv.com/oauth2/legacy/tokens
    //  3. Returns token1/acct1/cur1 legacy tokens to onSignInSuccess
    // This is the official Deriv third-party auth flow for both new and old accounts.
    if (hasCode) {
        const redirectCallbackUri = `${window.location.origin}/callback`;
        return (
            <Callback
                redirectCallbackUri={redirectCallbackUri}
                onSignInSuccess={async (tokens: Record<string, string>, rawState: unknown) => {
                    try {
                        const currency = await storeTokens(tokens, rawState);
                        finishSession(currency);
                    } catch {
                        try { if (tokens?.token1) localStorage.setItem(LS.AUTH_TOKEN, tokens.token1); } catch { /* ignore */ }
                        finishSession('USD');
                    }
                }}
                onSignInError={() => window.location.replace('/')}
                renderReturnButton={() => (
                    <Button className='callback-return-button' onClick={() => (window.location.href = '/')}>Return to Bot</Button>
                )}
            />
        );
    }

    return <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#fff' }}><p>Returning to Bot…</p></div>;
};

export default CallbackPage;
