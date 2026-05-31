// Proxy: /api/legacy-tokens → oauth.deriv.com/oauth2/legacy/tokens (server-side)
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
    const auth = req.headers.authorization || '';
    const accessToken = auth.replace(/^Bearer\s+/i, '');
    if (!accessToken) { res.status(400).json({ error: 'missing_token', error_description: 'No Bearer token' }); return; }
    try {
        const upstream = await fetch('https://oauth.deriv.com/oauth2/legacy/tokens', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        });
        const ct = upstream.headers.get('content-type') || '';
        if (ct.includes('json')) { res.status(upstream.status).json(await upstream.json()); }
        else { const t = await upstream.text(); res.status(502).json({ error: 'upstream_blocked', error_description: t.slice(0, 300) }); }
    } catch (err) { res.status(502).json({ error: 'proxy_error', error_description: String(err.message) }); }
}