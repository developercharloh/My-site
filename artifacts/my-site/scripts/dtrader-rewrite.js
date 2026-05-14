/**
 * One-shot rewrite of the vendored deriv-app `dist` (now at public/dtrader/)
 * so that all absolute root paths (`/js/...`, `/css/...`, `/public/...`,
 * `/assets/...`, `/manifest.json`, `/favicon.ico`, etc.) resolve when the
 * app is served from the `/dtrader/` sub-path of Apollo's domain.
 *
 * Also injects `__webpack_public_path__ = '/dtrader/'` into index.html
 * before the main bundle loads, so dynamic chunk loading works.
 *
 * Idempotent: safe to run multiple times.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public', 'dtrader');
const PREFIX = '/dtrader';

if (!fs.existsSync(ROOT)) {
    console.error('[dtrader-rewrite] public/dtrader does not exist; nothing to do.');
    process.exit(0);
}

const PUBLIC_PATHS = [
    'js',
    'css',
    'assets',
    'public',
    'manifest.json',
    'favicon.ico',
    'service-worker.js',
    'workbox-d3667991.js',
    'asset-manifest.json',
    'apple-app-site-association',
    'assetlinks.json',
    'robots.txt',
    'sitemap.xml',
    'front-channel.html',
    'localstorage-sync.html',
    'custom404.html',
    'bot',
    'contract',
];

function rewriteAbsolutePaths(content) {
    let out = content;
    for (const p of PUBLIC_PATHS) {
        const re = new RegExp(`(["'(=\\s])/(${escapeRegex(p)})(?![a-zA-Z0-9_-])`, 'g');
        out = out.replace(re, `$1${PREFIX}/$2`);
    }
    return out;
}

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ensureWebpackPublicPathOverride(html) {
    const marker = '__webpack_public_path__';
    if (html.includes(marker)) return html;
    const inject = `<script>window.__webpack_public_path__ = '${PREFIX}/'; var __webpack_public_path__ = '${PREFIX}/';</script>`;
    if (html.includes('</head>')) {
        return html.replace('</head>', `    ${inject}\n    </head>`);
    }
    return inject + html;
}

function ensureOauthStub(html) {
    // DTrader's @deriv-com/auth-client calls
    //   fetch('https://oauth.deriv.com/oauth2/sessions/active', {credentials:'include'})
    // on boot to detect a logged-in Deriv session. From any non-deriv.com origin
    // this fails CORS, the rejection bubbles into a React Suspense boundary, and
    // the whole DTrader app crashes to a black screen after the splash.
    //
    // Apollo's iframe is on a different origin from .deriv.com, so the auth
    // cookies that endpoint depends on can't reach it anyway. Stub all
    // oauth.deriv.com cross-origin fetches with an empty session response so
    // DTrader boots into guest mode. Apollo's existing OAuth login flow still
    // works (it goes through full-page navigation, not via this fetch).
    const marker = '__APOLLO_OAUTH_STUB__';
    // Always re-inject so iterative debugging picks up new logic.
    html = html.replace(/<script>\/\* __APOLLO_OAUTH_STUB__ \*\/[\s\S]*?<\/script>\n?/g, '');
    const stub = `<script>/* ${marker} */(function(){
// Unregister any pre-existing dtrader service worker (from earlier snapshots
// that registered the un-neutralised SW). Old SWs may rewrite chunk URLs and
// strip the /dtrader/ prefix, which causes ChunkLoadError.
if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations){
  navigator.serviceWorker.getRegistrations().then(function(rs){
    rs.forEach(function(r){if(r.scope.indexOf('/dtrader')>-1){console.log('[ApolloStub] unregistering old SW:',r.scope);r.unregister();}});
  }).catch(function(){});
}
// Block future SW registrations that target /dtrader/ — the vendored SW is
// neutralised, but DTrader's main code may still try to register it on boot.
if(navigator.serviceWorker){
  var _reg=navigator.serviceWorker.register;
  navigator.serviceWorker.register=function(url,opts){
    if(typeof url==='string'&&url.indexOf('dtrader')>-1){console.log('[ApolloStub] blocked SW register:',url);return Promise.reject(new Error('SW disabled by Apollo'));}
    return _reg.apply(this,arguments);
  };
}
var _f=window.fetch;
window.fetch=function(input,init){
  try{
    var u=typeof input==='string'?input:(input&&input.url)||'';
    if(u.indexOf('oauth.deriv.com')>-1||u.indexOf('/oauth2/sessions/active')>-1){
      console.log('[ApolloStub] STUBBED OAuth call:',u);
      return Promise.resolve(new Response(JSON.stringify({active:0,tokens:[],sessions:[]}),{status:200,headers:{'Content-Type':'application/json'}}));
    }
    var p=_f.apply(this,arguments);
    p.catch(function(e){console.warn('[ApolloDebug] fetch FAILED:',u,e&&e.message);});
    return p;
  }catch(e){return _f.apply(this,arguments);}
};
window.addEventListener('error',function(e){console.error('[ApolloDebug] GlobalError:',e.message,'@',e.filename+':'+e.lineno+':'+e.colno,e.error&&e.error.stack);});
window.addEventListener('unhandledrejection',function(e){var r=e.reason;console.error('[ApolloDebug] UnhandledRejection:',r&&(r.message||r),r&&r.stack);});
})();</script>`;
    if (html.includes('</head>')) {
        return html.replace('</head>', `    ${stub}\n    </head>`);
    }
    return stub + html;
}

function neutraliseFrameBuster(html) {
    // Vendored DTrader ships an "anti-clickjack" block that escapes any
    // iframe and navigates the top window to itself. Since we deliberately
    // embed DTrader inside Apollo's Manual Trader iframe (same origin),
    // this block must be neutralised. Replace the conditional with an
    // unconditional removal of the #antiClickjack guard.
    const original =
        /if \(self === top\) \{\s*var antiClickjack[\s\S]*?\} else \{\s*top\.location = self\.location;\s*\}/;
    if (original.test(html)) {
        return html.replace(
            original,
            "var __ac = document.getElementById('antiClickjack'); if (__ac && __ac.parentNode) __ac.parentNode.removeChild(__ac); /* Apollo: frame-buster disabled for /dtrader/ iframe */"
        );
    }
    return html;
}

function removeTcfxSplash(html) {
    // The user's vendored DTrader ships a custom "Trader Charloh FX" splash
    // overlay (#tcfx-splash) that covers the viewport for ~18 s while the
    // bundle bootstraps. The user has asked for it gone — the iframe is
    // pre-mounted on app start, so by the time they click Manual Trader
    // DTrader is already booted and a splash is just dead weight. Strip
    // both the CSS rules and the HTML element. Idempotent.
    let out = html;
    // Remove CSS block: from "/* ── Trader Charloh FX Splash Screen ── */"
    // up to and including the last "#tcfx-splash...{...}" rule and any
    // related @keyframes (tcfx-*). Stop at the first non-tcfx rule or the
    // closing </style>.
    out = out.replace(
        /\s*\/\* ── Trader Charloh FX Splash Screen ── \*\/[\s\S]*?(?=\n\s*<\/style>)/,
        ''
    );
    // Remove HTML element: <!-- Trader Charloh FX Splash Screen ... -->
    // <div id="tcfx-splash"> ... </div> (matched up to the closing div that
    // comes right before <div id="wallets_modal_root").
    out = out.replace(
        /\s*<!--\s*Trader Charloh FX Splash Screen[\s\S]*?<div id="tcfx-splash">[\s\S]*?<\/div>\s*(?=<div id="wallets_modal_root")/,
        ''
    );
    return out;
}

function rewriteIndexHtml() {
    const fp = path.join(ROOT, 'index.html');
    let html = fs.readFileSync(fp, 'utf8');
    html = neutraliseFrameBuster(html);
    html = removeTcfxSplash(html);
    html = rewriteAbsolutePaths(html);
    html = ensureWebpackPublicPathOverride(html);
    html = ensureOauthStub(html);
    fs.writeFileSync(fp, html);
    console.log('[dtrader-rewrite] index.html rewritten (frame-buster + tcfx splash removed, oauth stub injected)');
}

function rewriteCssFiles() {
    const cssDir = path.join(ROOT, 'css');
    if (!fs.existsSync(cssDir)) return;
    let count = 0;
    for (const f of fs.readdirSync(cssDir)) {
        if (!f.endsWith('.css')) continue;
        const fp = path.join(cssDir, f);
        const before = fs.readFileSync(fp, 'utf8');
        const after = rewriteAbsolutePaths(before);
        if (after !== before) {
            fs.writeFileSync(fp, after);
            count++;
        }
    }
    console.log(`[dtrader-rewrite] ${count} CSS file(s) rewritten`);
}

function rewriteManifest() {
    const fp = path.join(ROOT, 'manifest.json');
    if (!fs.existsSync(fp)) return;
    const m = JSON.parse(fs.readFileSync(fp, 'utf8'));
    m.start_url = `${PREFIX}/`;
    m.scope = `${PREFIX}/`;
    m.id = `${PREFIX}/`;
    if (Array.isArray(m.icons)) {
        m.icons = m.icons.map(icon => {
            if (icon && typeof icon.src === 'string' && icon.src.startsWith('/') && !icon.src.startsWith(`${PREFIX}/`)) {
                icon.src = `${PREFIX}${icon.src}`;
            }
            return icon;
        });
    }
    fs.writeFileSync(fp, JSON.stringify(m, null, 4));
    console.log('[dtrader-rewrite] manifest.json rewritten');
}

function rewriteAssetManifest() {
    const fp = path.join(ROOT, 'asset-manifest.json');
    if (!fs.existsSync(fp)) return;
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const fix = v => (typeof v === 'string' && v.startsWith('/') && !v.startsWith(`${PREFIX}/`)) ? `${PREFIX}${v}` : v;
    // Handle CRA-style { files, entrypoints } shape
    if (data.files && typeof data.files === 'object') {
        for (const k of Object.keys(data.files)) data.files[k] = fix(data.files[k]);
    }
    if (Array.isArray(data.entrypoints)) {
        data.entrypoints = data.entrypoints.map(fix);
    }
    // Handle flat { "main.js": "/js/...", ... } shape used by deriv-app's webpack
    for (const k of Object.keys(data)) {
        if (k === 'files' || k === 'entrypoints') continue;
        data[k] = fix(data[k]);
    }
    fs.writeFileSync(fp, JSON.stringify(data, null, 2));
    console.log('[dtrader-rewrite] asset-manifest.json rewritten');
}

function deleteLicenseSidecars() {
    // rspack's CopyRspackPlugin (used by Apollo's rsbuild output.copy) refuses
    // to copy `*.LICENSE.txt` files inside the public folder when other parts
    // of the build also emit license sidecars — it sees them as conflicting
    // emit sources for the same output paths. They are pure attribution text,
    // not required at runtime; the NOTICES files in dist still cover credits.
    let count = 0;
    function walk(dir) {
        for (const name of fs.readdirSync(dir)) {
            const fp = path.join(dir, name);
            const stat = fs.statSync(fp);
            if (stat.isDirectory()) walk(fp);
            else if (name.endsWith('.LICENSE.txt')) {
                fs.unlinkSync(fp);
                count++;
            }
        }
    }
    walk(ROOT);
    console.log(`[dtrader-rewrite] removed ${count} *.LICENSE.txt sidecar(s) (rspack copy-plugin conflict)`);
}

function patchWebpackPublicPath() {
    // The vendored deriv-app build hardcodes webpack's runtime publicPath as "/".
    // That's why dynamic chunks load from /js/core.chunk.X.js instead of
    // /dtrader/js/core.chunk.X.js, so the SPA fallback returns index.html
    // and the browser fails with "Unexpected token '<'". Patch the single
    // assignment in the entry chunk so dynamic imports resolve correctly.
    const jsDir = path.join(ROOT, 'js');
    if (!fs.existsSync(jsDir)) return;
    let totalPatched = 0;
    for (const f of fs.readdirSync(jsDir)) {
        if (!f.startsWith('core.main.') || !f.endsWith('.js')) continue;
        const fp = path.join(jsDir, f);
        const before = fs.readFileSync(fp, 'utf8');
        // Match `<identifier>.p="/"` where the identifier is a single short
        // minified variable name (the webpack require function). Only replace
        // when the value is exactly "/" — never an already-rewritten path.
        const re = /([A-Za-z_$][A-Za-z0-9_$]{0,3})\.p="\/"/g;
        let count = 0;
        const after = before.replace(re, (m, id) => {
            count++;
            return `${id}.p="${PREFIX}/"`;
        });
        if (count > 0) {
            fs.writeFileSync(fp, after);
            totalPatched += count;
            console.log(`[dtrader-rewrite] patched ${count} webpack publicPath in ${f}`);
        }
    }
    if (totalPatched === 0) console.log('[dtrader-rewrite] webpack publicPath already patched (or pattern not found)');
}

function disableServiceWorker() {
    // Their service-worker.js precaches absolute root paths and would
    // collide with Apollo's SW. Replace with a no-op so registration calls
    // succeed but nothing is intercepted.
    const fp = path.join(ROOT, 'service-worker.js');
    if (!fs.existsSync(fp)) return;
    fs.writeFileSync(
        fp,
        '// Disabled by Apollo (dtrader iframe). Apollo controls its own SW.\nself.addEventListener("install", () => self.skipWaiting());\nself.addEventListener("activate", e => e.waitUntil(self.clients.claim()));\n'
    );
    console.log('[dtrader-rewrite] service-worker.js neutralised');
}

rewriteIndexHtml();
rewriteCssFiles();
rewriteManifest();
rewriteAssetManifest();
disableServiceWorker();
deleteLicenseSidecars();
patchWebpackPublicPath();
console.log('[dtrader-rewrite] done.');
