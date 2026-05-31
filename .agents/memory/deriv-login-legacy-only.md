---
name: Deriv login flow — legacy OAuth only
description: The ONLY login approach that works for app 33bvUt0Jjt7sNGHm4kSqv on mrcharlohfx.site
---

## The rule
Use `buildLegacyAuthUrl()` from `pkce.ts` for the login button. Do NOT use `buildNewAuthUrl()` or `requestOidcAuthentication()`.

**Why:** `auth.deriv.com` and `oauth.deriv.com` are separate OAuth systems. Tokens issued by `auth.deriv.com` (PKCE flow) are rejected (401 UNAUTHORIZED) by `oauth.deriv.com/oauth2/legacy/tokens`. `auth.deriv.com/oauth2/legacy/tokens` returns 404 (doesn't exist). So there is no way to convert a PKCE access_token into legacy WebSocket tokens — the legacy token exchange is completely broken for this app.

**How to apply:**
- Login button → `window.location.assign(buildLegacyAuthUrl())`
- `buildLegacyAuthUrl()` → `https://oauth.deriv.com/oauth2/authorize?app_id=33bvUt0Jjt7sNGHm4kSqv&l=EN`
- This is the LEGACY endpoint (not OIDC `/oauth2/auth`). The alphanumeric app_id works here.
- After login, Deriv redirects to the app's registered redirect URI with tokens directly in the URL: `?token1=...&acct1=...&cur1=...`
- `collectLegacyTokensFromQuery()` in callback-page.tsx reads these tokens — no exchange step needed.
- The `logged_state='true'` cookie must be set in `storeTokens` (already done) to prevent `api_base.clearAuthData()` from wiping tokens on the next WebSocket authorize.

## What was tried and failed
- `requestOidcAuthentication()` from `@deriv-com/auth-client` → goes to `oauth.deriv.com/oauth2/auth` → redirect_uri mismatch error (oauth.deriv.com doesn't have the OIDC client registered with mrcharlohfx.site/callback)
- `buildNewAuthUrl()` + `exchangePkceCode()` → auth.deriv.com PKCE succeeds, gets code and access_token → `fetchLegacyTokens()` fails: `oauth.deriv.com/oauth2/legacy/tokens` returns 401 for auth.deriv.com tokens; `auth.deriv.com/oauth2/legacy/tokens` returns 404
- Setting `config.server_url='ws.derivws.com'` in localStorage → breaks auth-client by using wrong OAuth authority

## File locations
- `artifacts/my-site/src/components/layout/header/header.tsx` — login button
- `artifacts/my-site/src/utils/pkce.ts` — `buildLegacyAuthUrl()`, `collectLegacyTokensFromQuery()`
- `artifacts/my-site/src/pages/callback/callback-page.tsx` — handles both `?token1=` (legacy) and `?code=` (PKCE fallback)
