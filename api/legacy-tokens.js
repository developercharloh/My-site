// Server-side proxy for the Deriv legacy token bridge.
// Converts a PKCE access_token into old-style Deriv tokens (token1, acct1, cur1, ...)
// that the WebSocket authorize() call accepts.
// Browser CORS blocks this call directly; running it server-side works fine.

export const config = {
    api: { bodyParser: true },
};

export default async function handler(req, res) {
    const origin = req.headers['origin'] || 'https://mrcharlohfx.site';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'method_not_allowed' });
    }

    const authHeader = req.headers['authorization'] || '';
    if (!authHeader.startsWith('Bearer ')) {
        return res.status(400).json({ error: 'missing_token', error_description: 'Authorization: Bearer <token> required' });
    }

    const accessToken = authHeader.slice(7);

    // Try both Deriv legacy token bridge endpoints
    const endpoints = [
        'https://oauth.deriv.com/oauth2/legacy/tokens',
        'https://ws.derivws.com/oauth2/legacy/tokens',
    ];

    let lastError = null;
    for (const url of endpoints) {
        try {
            const upstream = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json',
                    'Origin': 'https://mrcharlohfx.site',
                    'Referer': 'https://mrcharlohfx.site/',
                },
            });

            const text = await upstream.text();
            const ct = upstream.headers.get('content-type') || '';

            if (ct.includes('text/html')) {
                lastError = { error: 'upstream_html', url };
                continue;
            }

            let parsed;
            try {
                parsed = JSON.parse(text);
            } catch {
                lastError = { error: 'parse_error', url, body: text.slice(0, 200) };
                continue;
            }

            if (upstream.ok && parsed?.token1) {
                return res.status(200).json(parsed);
            }

            lastError = { error: parsed?.error || 'no_token1', status: upstream.status, url };
        } catch (err) {
            lastError = { error: 'fetch_failed', url, detail: String(err) };
        }
    }

    return res.status(502).json({
        error: 'legacy_bridge_unavailable',
        error_description: 'Legacy token bridge failed on all endpoints',
        detail: lastError,
    });
}
