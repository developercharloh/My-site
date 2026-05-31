---
name: Deriv login flow — legacy OAuth only
description: The ONLY login approach that works for app 33bvUt0Jjt7sNGHm4kSqv on mrcharlohfx.site
---

## The rule
Use `buildLegacyAuthUrl()` from `pkce.ts` for the login button. It MUST include `redirect_uri=https://mrcharlohfx.site/callback` as an explicit query param. Do NOT use `buildNewAuthUrl()` or `requestOidcAuthentication()`.

**Why:** `oauth.deriv.com/oauth2/authorize` passes the `redirect_uri` parameter through to Deriv Hub's login page (`home.deriv.com/dashboard/login?...&redirect_uri=https://mrcharlohfx.site/callback`). After login, Deriv Hub redirects to that redirect_uri with legacy tokens in the URL (`?token1=...&acct1=...&cur1=...`). Without the explicit `redirect_uri`, Deriv Hub redirects to `home.deriv.com/dashboard` instead.

**How to apply:**
- `buildLegacyAuthUrl()` builds: `https://oauth.deriv.com/oauth2/authorize?app_id=33bvUt0Jjt7sNGHm4kSqv&l=EN&redirect_uri=${encodeURIComponent(redirectUri)}`
- `redirectUri` is derived from `window.location.hostname` (strips `www.`) + `/callback`
- After login, callback receives `?token1=...&acct1=...&cur1=...` — no token exchange step needed
- `collectLegacyTokensFromQuery()` in callback-page.tsx reads and stores these tokens
- The `logged_state='true'` cookie must be set in `storeTokens` to prevent `api_base.clearAuthData()` from wiping tokens

## What was tried and failed
- `requestOidcAuthentication()` from `@deriv-com/auth-client` → goes to `oauth.deriv.com/oauth2/auth` → redirect_uri mismatch (mrcharlohfx.site/callback not registered there)
- `buildNewAuthUrl()` (PKCE via `auth.deriv.com`) → correctly redirects to callback with `?code=` → BUT `oauth.deriv.com/oauth2/legacy/tokens` returns 401 for `auth.deriv.com` access_tokens (different OAuth backends — no token trust)
- `buildLegacyAuthUrl()` WITHOUT explicit `redirect_uri` → Deriv Hub redirects to `home.deriv.com/dashboard` (user never returns to mrcharlohfx.site)
- Setting `config.server_url='ws.derivws.com'` in localStorage → breaks auth-client by using wrong OAuth authority

## File locations
- `artifacts/my-site/src/components/layout/header/header.tsx` — login button → `buildLegacyAuthUrl()`
- `artifacts/my-site/src/utils/pkce.ts` — `buildLegacyAuthUrl()` (includes explicit redirect_uri), `collectLegacyTokensFromQuery()`
- `artifacts/my-site/src/pages/callback/callback-page.tsx` — handles both `?token1=` (legacy) and `?code=` (PKCE fallback)
