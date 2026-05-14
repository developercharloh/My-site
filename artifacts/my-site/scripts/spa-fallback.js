import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const dist = join(__dirname, '..', 'dist');
const indexHtml = join(dist, 'index.html');

if (!existsSync(indexHtml)) {
    console.error('[spa-fallback] dist/index.html not found, skipping');
    process.exit(0);
}

const baseHtml = readFileSync(indexHtml, 'utf8');

const callbackBootstrap = `<script>
(function(){
    try {
        var qs = window.location.search;
        if (!qs || qs.indexOf('token1=') === -1 || qs.indexOf('acct1=') === -1) return;

        var params = new URLSearchParams(qs);
        var accountsList = {};
        var clientAccounts = {};

        params.forEach(function(value, key){
            if (/^acct\\d+$/.test(key)) {
                var n = key.replace('acct', '');
                var token = params.get('token' + n);
                var currency = params.get('cur' + n) || '';
                if (token) {
                    accountsList[value] = token;
                    clientAccounts[value] = { loginid: value, token: token, currency: currency };
                }
            }
        });

        var firstAcct = params.get('acct1');
        var firstToken = params.get('token1');
        if (!firstAcct || !firstToken) return;

        localStorage.setItem('accountsList', JSON.stringify(accountsList));
        localStorage.setItem('clientAccounts', JSON.stringify(clientAccounts));
        localStorage.setItem('authToken', firstToken);
        localStorage.setItem('active_loginid', firstAcct);

        var account = params.get('account') || (firstAcct.indexOf('VR') === 0 ? 'demo' : (clientAccounts[firstAcct] && clientAccounts[firstAcct].currency) || 'USD');
        window.location.replace(window.location.origin + '/?account=' + encodeURIComponent(account));
    } catch (e) {
        console.error('[callback-bootstrap] failed:', e);
    }
})();
</script>`;

const routes = ['callback', 'bot', 'endpoint', 'redirect'];

for (const route of routes) {
    const dir = join(dist, route);
    mkdirSync(dir, { recursive: true });
    let html = baseHtml;
    if (route === 'callback') {
        html = baseHtml.replace('<head>', '<head>\n        ' + callbackBootstrap);
    }
    writeFileSync(join(dir, 'index.html'), html);
    console.log(`[spa-fallback] wrote dist/${route}/index.html${route === 'callback' ? ' (with bootstrap)' : ''}`);
}

const diagDir = join(dist, 'diag');
if (existsSync(diagDir)) {
    rmSync(diagDir, { recursive: true, force: true });
    console.log('[spa-fallback] removed stale dist/diag/');
}
