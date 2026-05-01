import { useEffect, useMemo, useState } from 'react';
import Cookies from 'js-cookie';
import { crypto_currencies_display_order, fiat_currencies_display_order } from '@/components/shared';
import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import { observer as globalObserver } from '@/external/bot-skeleton/utils/observer';
import { clearAuthData } from '@/utils/auth-utils';
import { Callback } from '@deriv-com/auth-client';
import { Button } from '@deriv-com/ui';

const getSelectedCurrency = (
    tokens: Record<string, string>,
    clientAccounts: Record<string, any>,
    state: any
): string => {
    const getQueryParams = new URLSearchParams(window.location.search);
    const currency =
        (state && state?.account) ||
        getQueryParams.get('account') ||
        sessionStorage.getItem('query_param_currency') ||
        '';
    const firstAccountKey = tokens.acct1;
    const firstAccountCurrency = clientAccounts[firstAccountKey]?.currency;

    const validCurrencies = [...fiat_currencies_display_order, ...crypto_currencies_display_order];
    if (tokens.acct1?.startsWith('VR') || currency === 'demo') return 'demo';
    if (currency && validCurrencies.includes(currency.toUpperCase())) return currency;
    return firstAccountCurrency || 'USD';
};

const handleSignInSuccess = async (tokens: Record<string, string>, rawState: unknown) => {
    const state = rawState as { account?: string } | null;
    const accountsList: Record<string, string> = {};
    const clientAccounts: Record<string, { loginid: string; token: string; currency: string }> = {};

    for (const [key, value] of Object.entries(tokens)) {
        if (key.startsWith('acct')) {
            const tokenKey = key.replace('acct', 'token');
            if (tokens[tokenKey]) {
                accountsList[value] = tokens[tokenKey];
                clientAccounts[value] = {
                    loginid: value,
                    token: tokens[tokenKey],
                    currency: '',
                };
            }
        } else if (key.startsWith('cur')) {
            const accKey = key.replace('cur', 'acct');
            if (tokens[accKey] && clientAccounts[tokens[accKey]]) {
                clientAccounts[tokens[accKey]].currency = value;
            }
        }
    }

    localStorage.setItem('accountsList', JSON.stringify(accountsList));
    localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));

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
                    if (Cookies.get('logged_state') === 'false') {
                        clearAuthData();
                    }
                }
            } else if (authorize) {
                localStorage.setItem('callback_token', JSON.stringify(authorize));
                const clientAccountsArray = Object.values(clientAccounts);
                const firstId = authorize?.account_list?.[0]?.loginid;
                const filteredTokens = clientAccountsArray.filter(account => account.loginid === firstId);
                if (filteredTokens.length) {
                    localStorage.setItem('authToken', filteredTokens[0].token);
                    localStorage.setItem('active_loginid', filteredTokens[0].loginid);
                    is_token_set = true;
                }
            }
        }
    } catch (verify_err) {
        // Verification is a nice-to-have; on any failure (network, socket,
        // unexpected response) fall through to the raw-token fallback below.
        // eslint-disable-next-line no-console
        console.warn('Pre-auth verification failed; proceeding with raw token:', verify_err);
    } finally {
        if (api) {
            try {
                api.disconnect();
            } catch {
                /* socket may already be closed */
            }
        }
    }
    if (!is_token_set) {
        localStorage.setItem('authToken', tokens.token1);
        localStorage.setItem('active_loginid', tokens.acct1);
    }

    const selected_currency = getSelectedCurrency(tokens, clientAccounts, state);
    window.location.replace(`${window.location.origin}/?account=${selected_currency}`);
};

const collectLegacyTokensFromQuery = (): Record<string, string> | null => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('token1') || !params.get('acct1')) return null;
    const tokens: Record<string, string> = {};
    for (const [k, v] of params.entries()) tokens[k] = v;
    return tokens;
};

const CallbackPage = () => {
    const [legacyError, setLegacyError] = useState<string | null>(null);
    const legacyTokens = useMemo(() => collectLegacyTokensFromQuery(), []);
    const hasOidcCode = useMemo(() => Boolean(new URLSearchParams(window.location.search).get('code')), []);

    useEffect(() => {
        if (!legacyTokens) return;
        const account = new URLSearchParams(window.location.search).get('account');
        handleSignInSuccess(legacyTokens, account ? { account } : null).catch(err => {
            // eslint-disable-next-line no-console
            console.error('Callback (legacy) failed:', err);
            setLegacyError(err?.message || 'Unexpected error during sign-in');
        });
    }, [legacyTokens]);

    // No tokens (legacy) and no OIDC `code` param means the user landed on
    // /callback without a real auth response — typically a cancelled login,
    // misconfigured Deriv redirect URL, or a refresh after params were
    // stripped. The auth-client would otherwise render its generic
    // "Unexpected error occured" page; instead, just bounce back home.
    useEffect(() => {
        if (legacyTokens || hasOidcCode) return;
        window.location.replace('/');
    }, [legacyTokens, hasOidcCode]);

    if (!legacyTokens && !hasOidcCode) {
        return (
            <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
                <p>Returning to Bot…</p>
            </div>
        );
    }

    if (legacyTokens) {
        if (legacyError) {
            return (
                <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
                    <h2>Sign-in failed</h2>
                    <p>{legacyError}</p>
                    <Button className='callback-return-button' onClick={() => (window.location.href = '/')}>
                        Return to Bot
                    </Button>
                </div>
            );
        }
        return (
            <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
                <p>Signing you in…</p>
            </div>
        );
    }

    return (
        <Callback
            onSignInSuccess={async (tokens: Record<string, string>, rawState: unknown) => {
                // Catching here prevents @deriv-com/auth-client from rendering
                // its generic "Unexpected error occured" page on a rejected
                // promise. Persist what we have and bounce home so the user
                // lands logged in via the same localStorage path used on any
                // normal page load.
                try {
                    await handleSignInSuccess(tokens, rawState);
                } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error('OAuth callback failed; falling back to home:', err);
                    try {
                        if (tokens?.token1) localStorage.setItem('authToken', tokens.token1);
                        if (tokens?.acct1) localStorage.setItem('active_loginid', tokens.acct1);
                    } catch {
                        /* localStorage may be unavailable in private mode */
                    }
                    window.location.replace('/');
                }
            }}
            renderReturnButton={() => (
                <Button className='callback-return-button' onClick={() => (window.location.href = '/')}>
                    {'Return to Bot'}
                </Button>
            )}
        />
    );
};

export default CallbackPage;
