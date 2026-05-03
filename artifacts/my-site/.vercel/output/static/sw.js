const CACHE_NAME="deriv-bot-v43-2026-04-30",OFFLINE_URL="/offline.html",PRECACHE_URLS=["/offline.html","/manifest.json","/deriv-logo.svg"];async function handleRequest(e){let t=new URL(e.url),a=t.pathname;try{if(isNavigationRequest(e))return await handleNavigation(e);if(isStaticAsset(a))return await handleStaticAsset(e);if(isApiRequest(t))return await handleApiRequest(e);else return await handleGenericRequest(e)}catch(t){return console.error("[SW] Request handling failed:",t),await handleOfflineFallback(e)}}async function handleNavigation(e){try{let t=await fetch(e,{timeout:3e3});if(t.ok){let a=await caches.open(CACHE_NAME);await a.put(e,t.clone())}return t}catch(i){let t=await caches.match(e);if(t)return t;let a=await caches.match("/")||await caches.match("/index.html");if(a)return a;let n=await caches.match(OFFLINE_URL);if(n)return n;throw i}}async function handleStaticAsset(e){try{e.url;let t=await caches.match(e);if(t)return t;let a=await fetch(e);if(a.ok){let t=await caches.open(CACHE_NAME);await t.put(e,a.clone())}return a}catch(a){let t=await caches.match(e);if(t)return t;throw a}}async function handleApiRequest(e){try{return e.url,await fetch(e,{timeout:5e3})}catch(t){return new Response(JSON.stringify({error:"Offline",message:"API not available offline",offline:!0,timestamp:new Date().toISOString(),url:e.url}),{status:503,statusText:"Service Unavailable",headers:{"Content-Type":"application/json","X-Offline-Mode":"true"}})}}async function handleGenericRequest(e){try{e.url;let t=await fetch(e);if(t.ok){let a=await caches.open(CACHE_NAME);await a.put(e,t.clone())}return t}catch(a){let t=await caches.match(e);if(t)return t;throw a}}async function handleOfflineFallback(e){if(e.url,e.headers.get("accept")?.includes("text/html")){let e=await caches.match("/")||await caches.match("/index.html");if(e)return e;let t=await caches.match(OFFLINE_URL);return t||new Response(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Offline - Deriv Bot</title>
                <style>
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        background: #0e0e0e; 
                        color: #ffffff; 
                        margin: 0;
                        padding: 0;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                    }
                    .container { 
                        text-align: center; 
                        max-width: 500px; 
                        padding: 40px 20px;
                    }
                    h1 { 
                        color: #ff444f; 
                        font-size: 2.5rem;
                        margin-bottom: 1rem;
                    }
                    p { 
                        font-size: 1.1rem; 
                        line-height: 1.6;
                        margin-bottom: 2rem;
                        opacity: 0.9;
                    }
                    button { 
                        background: #ff444f; 
                        color: white; 
                        border: none; 
                        padding: 15px 30px; 
                        border-radius: 8px; 
                        cursor: pointer; 
                        font-size: 16px; 
                        font-weight: 600;
                        transition: background-color 0.2s;
                    }
                    button:hover {
                        background: #e63946;
                    }
                    .status {
                        margin-top: 2rem;
                        padding: 15px;
                        background: rgba(255, 68, 79, 0.1);
                        border-radius: 8px;
                        border-left: 4px solid #ff444f;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>You're Offline</h1>
                    <p>Deriv Bot requires an internet connection to function properly. Please check your connection and try again.</p>
                    <button onclick="window.location.reload()">Try Again</button>
                    <div class="status">
                        <strong>Connection Status:</strong> <span id="status">Offline</span>
                    </div>
                </div>
                <script>
                    function updateStatus() {
                        document.getElementById('status').textContent = navigator.onLine ? 'Online' : 'Offline';
                    }
                    
                    window.addEventListener('online', () => {
                        updateStatus();
                        setTimeout(() => window.location.reload(), 1000);
                    });
                    
                    window.addEventListener('offline', updateStatus);
                    updateStatus();
                </script>
            </body>
            </html>
        `,{status:200,headers:{"Content-Type":"text/html","Cache-Control":"no-cache"}})}return new Response(JSON.stringify({error:"Offline",message:"Content not available offline",url:e.url,timestamp:new Date().toISOString()}),{status:503,statusText:"Service Unavailable",headers:{"Content-Type":"application/json","X-Offline-Mode":"true"}})}function isNavigationRequest(e){return"navigate"===e.mode||"GET"===e.method&&e.headers.get("accept")?.includes("text/html")}function isStaticAsset(e){return/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|webp|avif)$/i.test(e)||e.startsWith("/assets/")||e.startsWith("/static/")||e.startsWith("/_assets/")}function isAuthRequest(e){function t(e,t){return e===t||e.endsWith("."+t)}return e.pathname.includes("/oauth")||e.pathname.includes("/auth")||e.pathname.includes("/login")||e.pathname.includes("/logout")||e.pathname.includes("/token")||e.pathname.includes("/authorize")||e.pathname.includes("/callback")||t(e.hostname,"oauth.deriv.com")||t(e.hostname,"auth.deriv.com")||t(e.hostname,"accounts.deriv.com")||t(e.hostname,"google.com")||t(e.hostname,"googleapis.com")||t(e.hostname,"facebook.com")||t(e.hostname,"apple.com")||t(e.hostname,"microsoft.com")||t(e.hostname,"live.com")||e.search.includes("code=")||e.search.includes("state=")||e.search.includes("token=")||e.search.includes("access_token=")||e.search.includes("id_token=")}function isApiRequest(e){function t(e,t){return e===t||e.endsWith("."+t)}return e.pathname.startsWith("/api/")||e.pathname.startsWith("/v1/")||e.pathname.startsWith("/v2/")||t(e.hostname,"deriv.com")||t(e.hostname,"deriv.me")||t(e.hostname,"binary.com")||e.hostname.startsWith("api.")||"ws:"===e.protocol||"wss:"===e.protocol||e.hostname.startsWith("ws.")||e.hostname.includes("websocket")||e.hostname.includes("analytics")||e.hostname.includes("tracking")||e.hostname.includes("metrics")}async function getCacheStatus(){try{let e=await caches.open(CACHE_NAME),t=await e.keys();return{cacheName:CACHE_NAME,cachedUrls:t.map(e=>e.url),cacheSize:t.length}}catch(e){return console.error("[SW] Failed to get cache status:",e),{error:e.message}}}async function clearCache(){try{let e=await caches.keys();await Promise.all(e.map(e=>caches.delete(e)))}catch(e){console.error("[SW] Failed to clear cache:",e)}}self.addEventListener("install",e=>{e.waitUntil((async()=>{try{let e=await caches.open(CACHE_NAME);await e.addAll(PRECACHE_URLS),await self.skipWaiting()}catch(e){console.error("[SW] Install failed:",e),await self.skipWaiting()}})())}),self.addEventListener("activate",e=>{e.waitUntil((async()=>{try{let e=await caches.keys();await Promise.all(e.map(e=>{if(e!==CACHE_NAME)return caches.delete(e)})),await self.clients.claim(),(await self.clients.matchAll()).forEach(e=>{e.postMessage({type:"SW_ACTIVATED",message:"Service worker is ready for offline functionality"})})}catch(e){console.error("[SW] Activation failed:",e)}})())}),self.addEventListener("fetch",e=>{let{request:t}=e,a=new URL(t.url);"GET"!==t.method||!t.url.startsWith("http")||"/dtrader"===a.pathname||a.pathname.startsWith("/dtrader/")||(a.pathname.includes(".js")||a.pathname.includes(".css")||a.pathname.includes("/static/js/")||a.pathname.includes("/static/css/")||a.pathname.includes("chunk")||a.pathname.includes(".mjs")||isAuthRequest(a)||isApiRequest(a)?a.pathname:"no-cache"===t.headers.get("cache-control")||t.headers.get("authorization")||t.headers.get("x-auth-token")||e.respondWith(handleRequest(t)))}),self.addEventListener("message",e=>{let{type:t,data:a}=e.data||{};switch(t){case"SKIP_WAITING":self.skipWaiting();break;case"GET_CACHE_STATUS":getCacheStatus().then(t=>{e.ports[0]?.postMessage({type:"CACHE_STATUS",data:t})});break;case"CLEAR_CACHE":clearCache().then(()=>{e.ports[0]?.postMessage({type:"CACHE_CLEARED"})})}});