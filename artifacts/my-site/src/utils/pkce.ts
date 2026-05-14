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
    REDIRECT_URI: 'https://mrcharlohfx.site/callback',
} as const;

// Servers to try for the legacy token bridge, in order
const LEGACY_TOKEN_SERVERS = ['oauth.deriv.com', 'ws.derivws.com'];

export const LS_PKCE = {
    VERIFIER: 'new_pkce_verifier',
    STATE: 'new_pkce_state',
} as const;

export const buildNewAuthUrl = async (): Promise<string> => {
    const verifier = generateVerifier();
    const challenge = await generateChallenge(verifier);
    const state = generateState();

    localStorage.setItem(LS_PKCE.VERIFIER, verifier);
    localStorage.setItem(LS_PKCE.STATE, state);

    const params = new URLSearchParams({
        client_id: NEW_AUTH.CLIENT_ID,
        redirect_uri: NEW_AUTH.REDIRECT_URI,
        response_type: 'code',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        // prompt=login is critical: forces auth.deriv.com to always complete the
        // redirect to our callback URL even when the user already has an active
        // Deriv session.  Without it, Deriv sends logged-in users to their Hub
        // dashboard instead of back to mrcharlohfx.site/callback.
        prompt: 'login',
    });
    return `${NEW_AUTH.AUTH_ENDPOINT}?${params.toString()}`;
};

export interface PkceTokenResponse {
    access_token?: string;
    id_token?: string;
    token_type?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
}

export const exchangePkceCode = async (code: string): Promise<PkceTokenResponse> => {
    const verifier = localStorage.getItem(LS_PKCE.VERIFIER);
    if (!verifier) throw new Error('PKCE verifier missing from localStorage');

    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: NEW_AUTH.REDIRECT_URI,
        client_id: NEW_AUTH.CLIENT_ID,
        code_verifier: verifier,
    });

    const res = await fetch(NEW_AUTH.TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    return res.json();
};

/**
 * fetchLegacyTokens — tries every known Deriv server in turn.
 * Returns the token1/acct1/cur1 map on success, null if all fail.
 */
export const fetchLegacyTokens = async (accessToken: string): Promise<Record<string, string> | null> => {
    for (const server of LEGACY_TOKEN_SERVERS) {
        try {
            const res = await fetch(`https://${server}/oauth2/legacy/tokens`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (!res.ok) continue;
            const data = await res.json();
            if (data?.token1) return data as Record<string, string>;
        } catch {
            // try next server
        }
    }
    return null;
};
