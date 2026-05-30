// Node.js serverless proxy — avoids browser CORS on auth.deriv.com token endpoint
// Using nodejs runtime (not edge) to use different infrastructure than blocked edge IPs

export const config = {
    api: { bodyParser: false },
};

export default async function handler(req, res) {
    const origin = req.headers['origin'] || 'https://mrcharlohfx.site';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'method_not_allowed' });
    }

    // Read raw body from stream
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString('utf-8');

    const ua = req.headers['user-agent'] || 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

    try {
        const upstream = await fetch('https://auth.deriv.com/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Origin': 'https://mrcharlohfx.site',
                'Referer': 'https://mrcharlohfx.site/',
                'User-Agent': ua,
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
            },
            body,
        });

        const responseText = await upstream.text();
        const ct = upstream.headers.get('content-type') || '';

        if (ct.includes('text/html')) {
            return res.status(502).json({
                error: 'upstream_blocked',
                error_description: 'Auth server WAF block — HTML returned instead of JSON',
            });
        }

        let parsed;
        try {
            parsed = JSON.parse(responseText);
        } catch {
            return res.status(502).json({
                error: 'parse_error',
                error_description: 'Cannot parse auth server response: ' + responseText.slice(0, 200),
            });
        }

        return res.status(upstream.status).json(parsed);
    } catch (err) {
        return res.status(502).json({
            error: 'proxy_error',
            error_description: String(err),
        });
    }
}
