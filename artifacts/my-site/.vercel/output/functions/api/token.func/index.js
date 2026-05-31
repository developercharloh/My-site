// Proxy: /api/token → auth.deriv.com/oauth2/token (server-side, avoids Cloudflare WAF)
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    try {
        const upstream = await fetch('https://auth.deriv.com/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'User-Agent': 'mrcharlohfx-proxy/1.0' },
            body,
        });
        const ct = upstream.headers.get('content-type') || '';
        if (ct.includes('json')) { res.status(upstream.status).json(await upstream.json()); }
        else { const t = await upstream.text(); res.status(502).json({ error: 'upstream_blocked', error_description: t.slice(0, 300) }); }
    } catch (err) { res.status(502).json({ error: 'proxy_error', error_description: String(err.message) }); }
}