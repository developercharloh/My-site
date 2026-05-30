import React, { useEffect, useMemo, useState } from 'react';
import Cookies from 'js-cookie';
import { crypto_currencies_display_order, fiat_currencies_display_order } from '@/components/shared';
import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { clearAuthData } from '@/utils/auth-utils';
import { Callback, requestOidcAuthentication } from '@deriv-com/auth-client';
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

// The Deriv app registers exactly https://mrcharlohfx.site/callback. Strip any
// leading `www.` so the apex + www origins both produce the registered URI, and
// so the URI used to START the OIDC flow matches the one used at token exchange.
const getRedirectCallbackUri = () =>
    `${window.location.protocol}//${window.location.host.replace(/^www\./, '')}/callback`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthError {
    message: string;
    step: 'token_exchange' | 'legacy_bridge' | 'new_api' | 'websocket' | 'oauth_error' | 'legacy_error' | 'unknown';
    code?: string;
    detail?: string;
}

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
        console.warn('Pre-auth verify failed; using raw token:', err); // eslint-disable-line no-console
    } finally {
        try { api?.disconnect(); } catch { /* ignore */ }
    }
    if (!is_token_set) {
        localStorage.setItem(LS.AUTH_TOKEN, tokens.token1);
        localStorage.setItem(LS.ACTIVE_LOGINID, tokens.acct1);
    }

    // Mark the session as logged-in so api_base.authorizeAndSubscribe doesn't
    // call clearAuthData() (which would wipe tokens and loop back to "Log in")
    // when it encounters a temporary InvalidToken on mrcharlohfx.site where
    // Deriv's own platform never sets this cookie.
    try {
        const cookieDomain = window.location.hostname.split('.').slice(-2).join('.');
        Cookies.set('logged_state', 'true', {
            domain: cookieDomain,
            expires: 30,
            path: '/',
            secure: window.location.protocol === 'https:',
        });
    } catch { /* ignore cookie errors */ }

    return getSelectedCurrency(tokens, clientAccounts, state);
};

const collectLegacyTokensFromQuery = (): Record<string, string> | null => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('token1') || !params.get('acct1')) return null;
    const tokens: Record<string, string> = {};
    for (const [k, v] of params.entries()) tokens[k] = v;
    return tokens;
};

const finishSession = (currency: string) => {
    const msg = { type: 'deriv-oauth-tokens', currency };
    try { const bc = new BroadcastChannel('deriv-oauth'); bc.postMessage(msg); bc.close(); } catch { /* ignore */ }
    if (window.opener && !window.opener.closed) {
        try { window.opener.postMessage(msg, window.location.origin); window.close(); return; } catch { /* ignore */ }
    }
    window.location.replace(`/?account=${currency}`);
};

// ─── Error display component ──────────────────────────────────────────────────

const ErrorDisplay: React.FC<{
    error: AuthError;
    onRetry: () => void;
}> = ({ error, onRetry }) => {
    // Show detail by default so the user can see exactly what failed
    const [showDetail, setShowDetail] = React.useState(true);

    const stepLabels: Record<AuthError['step'], string> = {
        token_exchange: 'Token exchange',
        legacy_bridge: 'Legacy token bridge',
        new_api: 'Trading API',
        websocket: 'WebSocket authorization',
        oauth_error: 'Deriv OAuth',
        legacy_error: 'Legacy sign-in',
        unknown: 'Authentication',
    };

    return (
        <div style={{
            textAlign: 'center',
            padding: '4rem 2rem',
            maxWidth: 520,
            margin: '0 auto',
            color: '#fff',
            fontFamily: 'inherit',
        }}>
            <h2 style={{ color: '#d4af37', marginBottom: '0.5rem' }}>Sign-in failed</h2>
            <p style={{ color: 'rgba(255,255,255,0.85)', marginBottom: '0.5rem', fontSize: '1rem' }}>
                {error.message}
            </p>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', marginBottom: '1rem' }}>
                Step: <strong style={{ color: 'rgba(255,255,255,0.6)' }}>{stepLabels[error.step]}</strong>
                {error.code && (
                    <> &nbsp;·&nbsp; Code: <code style={{ color: '#d4af37' }}>{error.code}</code></>
                )}
            </p>

            {error.detail && (
                <div style={{ marginBottom: '1.5rem', textAlign: 'left' }}>
                    <button
                        onClick={() => setShowDetail(v => !v)}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: 'rgba(255,255,255,0.5)',
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            padding: '0 0 6px 0',
                            display: 'block',
                        }}
                    >
                        {showDetail ? 'Hide details ▲' : 'Show details ▼'}
                    </button>
                    {showDetail && (
                        <pre style={{
                            padding: '0.75rem 1rem',
                            background: 'rgba(0,0,0,0.3)',
                            borderRadius: 6,
                            fontSize: '0.72rem',
                            color: 'rgba(255,255,255,0.75)',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            border: '1px solid rgba(255,255,255,0.12)',
                            maxHeight: 200,
                            overflow: 'auto',
                            margin: 0,
                        }}>
                            {error.detail}
                        </pre>
                    )}
                </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                <Button className='callback-return-button' onClick={onRetry}>
                    Try again
                </Button>
                <Button
                    className='callback-return-button'
                    onClick={() => window.location.replace('/')}
                >
                    Back to home
                </Button>
            </div>
        </div>
    );
};

// ─── Main CallbackPage ────────────────────────────────────────────────────────

const CallbackPage: React.FC = () => {
    const [legacyError, setLegacyError] = useState<AuthError | null>(null);
    const [pkceError, setPkceError] = useState<AuthError | null>(null);

    const params = useMemo(() => new URLSearchParams(window.location.search), []);
    const legacyTokens = useMemo(() => collectLegacyTokensFromQuery(), []);
    const hasCode = params.has('code');
    const hasError = params.has('error');

    // auth-client handles the full PKCE exchange + legacy token fetch.
    // isPkceFlow is always false — the Callback component runs for all ?code= callbacks.
    const isPkceFlow = false;

    const handleRetry = async () => {
        // Restart the OIDC flow — auth-client stores its own PKCE verifier.
        await requestOidcAuthentication({
            redirectCallbackUri: `${window.location.origin}/callback`,
            postLogoutRedirectUri: window.location.origin,
        });
    };

    // ── Legacy tokens handler ─────────────��───────────────────────────────────
    useEffect(() => {
        if (!legacyTokens) return;
        storeTokens(legacyTokens, params.get('account') ? { account: params.get('account') } : null)
            .then(currency => finishSession(currency))
            .catch(err => setLegacyError({
                message: err?.message || 'Unexpected error during sign-in',
                step: 'legacy_error',
                detail: err?.stack || String(err),
            }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Nothing useful → go home ──────────────────────────────────────────────
    useEffect(() => {
        if (legacyTokens || hasCode || hasError) return;
        window.location.replace('/');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Error from Deriv OAuth ────────────────────────────────────────────────
    if (hasError) {
        const code = params.get('error') || 'unknown';
        const desc = params.get('error_description') || params.get('error') || 'Unknown error';
        return (
            <ErrorDisplay
                error={{ message: desc, step: 'oauth_error', code, detail: window.location.search }}
                onRetry={handleRetry}
            />
        );
    }

    // ── PKCE exchange error ───────────────────────────────────────────────────
    if (pkceError) {
        return <ErrorDisplay error={pkceError} onRetry={handleRetry} />;
    }

    // ── Legacy tokens error ───��───────────────────────────────────────────────
    if (legacyError) {
        return <ErrorDisplay error={legacyError} onRetry={handleRetry} />;
    }

    // ── Legacy tokens in progress ─────────────────────────────────────────────
    if (legacyTokens) {
        return <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#fff' }}><p>Signing you in…</p></div>;
    }

    // ── PKCE flow in progress ─────────────────────────────────────────────────
    if (isPkceFlow) {
        return (
            <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#fff' }}>
                <p>Completing sign-in…</p>
            </div>
        );
    }

    // ── auth-client OIDC flow ─────────────────────────────────────────────────
    if (hasCode) {
        const redirectCallbackUri = getRedirectCallbackUri();
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
