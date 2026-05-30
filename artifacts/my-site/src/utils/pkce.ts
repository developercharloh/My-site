/** PKCE helpers for the new Deriv auth.deriv.com OAuth 2.0 flow */

function base64url(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

export const generateVerifier = (): string => {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return base64url(arr);
};

export const generateChallenge = async (verifier: string): Promise<string> => {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return base64url(new Uint8Array(digest));
};

export const generateState = (): string => {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return 'dbot-' + base64url(arr);
};

export const NEW_AUTH = {
    CLIENT_ID: '33bvUt0Jjt7sNGHm4kSqv',
    AUTH_ENDPOINT: 'https://auth.deriv.com/oauth2/auth',
    TOKEN_ENDPOINT: 'https://auth.deriv.com/oauth2/token',
    TOKEN_PROXY: '/api/token',
    API_BASE: 'https://api.derivws.com',
    get REDIRECT_URI(): string {
        const host = typeof window !== 'undefined' ? window.location.hostname : 'mrcharlohfx.site';
        if (host === 'mrcharlohfx.site' || host === 'www.mrcharlohfx.site') {
            return 'https://mrcharlohfx.site/callback';
        }
        if (typeof window !== 'undefined') {
            return `${window.location.origin}/callback`;
        }
        return 'https://mrcharlohfx.site/callback';
    },
} as const;

export const LS_PKCE = {
    VERIFIER: 'new_pkce_verifier',
    STATE: 'new_pkce_state',
} as const;

const safeSession = {
    set(key: string, value: string) {
        try { sessionStorage.setItem(key, value); } catch { /* ignore */ }
        try { localStorage.setItem(key, value); } catch { /* ignore */ }
    },
    get(key: string): string | null {
        // Check sessionStorage first (same-tab navigation preserves it)
        try { const v = sessionStorage.getItem(key); if (v) return v; } catch { /* ignore */ }
        // Fallback to localStorage (cross-tab, survives navigation)
        try { return localStorage.getItem(key); } catch { /* ignore */ }
        return null;
    },
    remove(key: string) {
        try { sessionStorage.removeItem(key); } catch { /* ignore */ }
        try { localStorage.removeItem(key); } catch { /* ignore */ }
    },
};

export const buildNewAuthUrl = async (): Promise<string> => {
    const verifier = generateVerifier();
    const challenge = await generateChallenge(verifier);
    const state = generateState();

    safeSession.set(LS_PKCE.VERIFIER, verifier);
    safeSession.set(LS_PKCE.STATE, state);

    const params = new URLSearchParams({
        client_id: NEW_AUTH.CLIENT_ID,
        redirect_uri: NEW_AUTH.REDIRECT_URI,
        response_type: 'code',
        scope: 'trade account_manage',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
    });
    return `${NEW_AUTH.AUTH_ENDPOINT}?${params.toString()}`;
};

/**
 * Build the LEGACY Deriv OAuth URL (oauth.deriv.com).
 *
 * Unlike the new auth.deriv.com PKCE flow, the legacy flow returns account
 * tokens DIRECTLY in the redirect URL (?acct1=&token1=&cur1=...) — there is no
 * server-side token-exchange step, so it completely bypasses the Cloudflare WAF
 * that blocks https://auth.deriv.com/oauth2/token. This is the only flow that
 * works reliably on mobile browsers.
 *
 * Requirements: the app's registered redirect URL must be
 * https://mrcharlohfx.site/callback. The alphanumeric app_id works here too —
 * oauth.deriv.com accepts it and redirects to the Deriv Hub login.
 *
 * callback-page.tsx reads the returned tokens via collectLegacyTokensFromQuery().
 */
export const buildLegacyAuthUrl = (): string => {
    return `https://oauth.deriv.com/oauth2/authorize?app_id=${NEW_AUTH.CLIENT_ID}&l=EN`;
};

export interface PkceTokenResponse {
    access_token?: string;
    id_token?: string;
    token_type?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
}

/**
 * Exchange the authorization code for tokens.
 *
 * @param code - The authorization code from the callback URL
 * @param passedVerifier - The PKCE verifier captured BEFORE storage was cleared.
 *   Pass this explicitly from callback-page.tsx to avoid the race where
 *   localStorage is cleared before this function reads it.
 *
 * Strategy:
 *  1. Call auth.deriv.com directly with credentials:'include' — confirmed CORS:
 *     access-control-allow-origin: https://mrcharlohfx.site
 *     access-control-allow-credentials: true
 *  2. If the direct call returns HTML (Cloudflare challenge without cookie),
 *     fall back to the same-origin /api/token serverless proxy.
 */
export const exchangePkceCode = async (
    code: string,
    passedVerifier?: string
): Promise<PkceTokenResponse> => {
    // Use the explicitly passed verifier first (avoids storage-clearing race on mobile),
    // then fall back to reading from storage.
    const verifier = passedVerifier || safeSession.get(LS_PKCE.VERIFIER);
    if (!verifier) {
        throw new Error(
            'PKCE verifier missing — your session may have expired. Please try logging in again.'
        );
    }

    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: NEW_AUTH.REDIRECT_URI,
        client_id: NEW_AUTH.CLIENT_ID,
        code_verifier: verifier,
    });

    const bodyStr = body.toString();
    const baseHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };

    // ── Attempt 1: Direct browser call with credentials (sends __cf_bm cookie) ──
    try {
        const res = await fetch(NEW_AUTH.TOKEN_ENDPOINT, {
            method: 'POST',
            headers: baseHeaders,
            body: bodyStr,
            credentials: 'include',
        });

        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('text/html')) {
            return res.json() as Promise<PkceTokenResponse>;
        }
        // Cloudflare returned a challenge page — fall through to proxy
        console.warn('[pkce] Direct token call returned HTML, falling back to proxy'); // eslint-disable-line no-console
    } catch (directErr) {
        // Network/CORS error on direct call — fall through to proxy
        console.warn('[pkce] Direct token call failed:', directErr); // eslint-disable-line no-console
    }

    // ── Attempt 2: Same-origin proxy (avoids CORS, uses server-side HTTP) ──
    const proxyRes = await fetch(NEW_AUTH.TOKEN_PROXY, {
        method: 'POST',
        headers: baseHeaders,
        body: bodyStr,
    });

    const proxyCt = proxyRes.headers.get('content-type') || '';
    if (proxyCt.includes('text/html')) {
        throw new Error(
            'Sign-in server is temporarily unavailable. Please try again in a moment.'
        );
    }

    const proxyData = (await proxyRes.json()) as PkceTokenResponse;

    if (!proxyRes.ok && !proxyData.access_token && proxyData.error) {
        if (proxyData.error === 'upstream_blocked' || proxyData.error === 'proxy_error') {
            throw new Error(
                proxyData.error_description ||
                'Token exchange blocked — please try logging in again'
            );
        }
    }

    return proxyData;
};

/**
 * Convert a PKCE access_token into legacy Deriv tokens (token1, acct1, cur1, ...).
 * These legacy tokens are what the WebSocket authorize() call accepts.
 *
 * Strategy:
 *  1. Same-origin /api/legacy-tokens proxy (server-side, no CORS issue) — preferred.
 *  2. Direct browser call to oauth.deriv.com / ws.derivws.com — fallback if proxy down.
 */
export const fetchLegacyTokens = async (accessToken: string): Promise<Record<string, string> | null> => {
    // ── Attempt 1: server-side proxy (avoids CORS) ──────────────────────────
    try {
        const proxyRes = await fetch('/api/legacy-tokens', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
        if (proxyRes.ok) {
            const data = await proxyRes.json();
            if (data?.token1) return data as Record<string, string>;
        }
    } catch {
        // proxy unavailable — fall through to direct calls
    }

    // ── Attempt 2: direct browser calls (may be CORS-blocked) ───────────────
    const servers = ['oauth.deriv.com', 'ws.derivws.com'];
    for (const server of servers) {
        try {
            const res = await fetch(`https://${server}/oauth2/legacy/tokens`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (!res.ok) continue;
            const data = await res.json();
            if (data?.token1) return data as Record<string, string>;
        } catch {
            // try next
        }
    }
    return null;
};

export interface DerivAccount {
    account_id: string;
    balance: number;
    currency: string;
    group: string;
    status: string;
    account_type: 'demo' | 'real';
}

export const fetchNewApiAccounts = async (accessToken: string): Promise<DerivAccount[] | null> => {
    try {
        const res = await fetch(`${NEW_AUTH.API_BASE}/trading/v1/options/accounts`, {
            method: 'GET',
            headers: {
                'Deriv-App-ID': NEW_AUTH.CLIENT_ID,
                'Authorization': `Bearer ${accessToken}`,
            },
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (Array.isArray(data?.data) && data.data.length > 0) return data.data as DerivAccount[];
        return null;
    } catch {
        return null;
    }
};

export const ensureNewApiAccount = async (
    accessToken: string,
    account_type: 'demo' | 'real' = 'demo'
): Promise<DerivAccount | null> => {
    try {
        const res = await fetch(`${NEW_AUTH.API_BASE}/trading/v1/options/accounts`, {
            method: 'POST',
            headers: {
                'Deriv-App-ID': NEW_AUTH.CLIENT_ID,
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ currency: 'USD', group: 'row', account_type }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data?.data?.account_id) return data.data as DerivAccount;
        if (Array.isArray(data?.data) && data.data[0]?.account_id) return data.data[0] as DerivAccount;
        return null;
    } catch {
        return null;
    }
};

export const clearPkceState = () => {
    safeSession.remove(LS_PKCE.VERIFIER);
    safeSession.remove(LS_PKCE.STATE);
};

/**
 * Get a WebSocket endpoint URL for the given account.
 * Called after account switching so the trading layer can connect to the
 * right server. Returns null if the API doesn't provide one (caller
 * falls back to the default ws.derivws.com endpoint).
 */
export const getOtpWebSocketUrl = async (
    accessToken: string,
    accountId: string
): Promise<string | null> => {
    try {
        const res = await fetch(`${NEW_AUTH.API_BASE}/trading/v1/options/accounts/${accountId}`, {
            headers: {
                'Deriv-App-ID': NEW_AUTH.CLIENT_ID,
                'Authorization': `Bearer ${accessToken}`,
            },
        });
        if (!res.ok) return null;
        const data = await res.json();
        return (data?.data?.ws_url as string) || null;
    } catch {
        return null;
    }
};
