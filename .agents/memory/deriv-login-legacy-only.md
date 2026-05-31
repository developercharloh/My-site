---
name: Deriv login flow — legacy OAuth only
description: The ONLY login approach that works for mrcharlohfx.site — app ID 128695
---

## The rule
Use `buildLegacyAuthUrl()` from `pkce.ts` for the login button. App ID is `128695` (numeric, legacy API).
Do NOT use `buildNewAuthUrl()` or `requestOidcAuthentication()`.

**Why:** App `128695` is registered at `developers.deriv.com` (Legacy API) with:
- OAuth Redirect URL: `https://mrcharlohfx.site/callback` ✅ (correctly registered in portal)
- Scopes: Read, Trade, Trading Information

The legacy OAuth flow at `oauth.deriv.com/oauth2/authorize?app_id=128695` redirects to the Deriv login
page, then after login sends the user to `https://mrcharlohfx.site/callback?token1=...&acct1=...&cur1=...`
— legacy tokens delivered directly in the URL, no server-side token exchange needed.

**How to apply:**
- `buildLegacyAuthUrl()` → `https://oauth.deriv.com/oauth2/authorize?app_id=128695&l=EN&redirect_uri=https://mrcharlohfx.site/callback`
- `collectLegacyTokensFromQuery()` in callback-page.tsx reads and stores the returned tokens
- The `logged_state='true'` cookie must be set in `storeTokens` to prevent `api_base.clearAuthData()` from wiping tokens
- WebSocket connection also uses `128695` directly (numeric, no fallback needed)

## App ID locations
- `config.ts` → `APP_IDS.MY_SITE: 128695`
- `pkce.ts` → `NEW_AUTH.CLIENT_ID: '128695'`
- `main.tsx` → seeds `config.app_id` in localStorage from `APP_IDS.MY_SITE`
- `appId.js` → `getNumericAppId()` uses `128695` directly for WebSocket URL

## What was tried and failed (old app 33bvUt0Jjt7sNGHm4kSqv)
- `requestOidcAuthentication()` → `oauth.deriv.com/oauth2/auth` → redirect_uri mismatch
- `buildNewAuthUrl()` (PKCE via `auth.deriv.com`) → code returned to callback BUT `oauth.deriv.com/oauth2/legacy/tokens` returns 401 for `auth.deriv.com` tokens (different OAuth backends)
- `buildLegacyAuthUrl()` without explicit `redirect_uri` → Deriv redirects to `home.deriv.com/dashboard`
- `buildLegacyAuthUrl()` WITH explicit `redirect_uri` → Deriv validates against registered list, ignores unregistered URIs, still sends to Deriv dashboard
- Root cause of all failures: old app `33bvUt0Jjt7sNGHm4kSqv` had wrong redirect URL registered in the legacy OAuth portal

## File locations
- `artifacts/my-site/src/components/layout/header/header.tsx` — login button → `buildLegacyAuthUrl()`
- `artifacts/my-site/src/utils/pkce.ts` — `buildLegacyAuthUrl()`, `collectLegacyTokensFromQuery()`
- `artifacts/my-site/src/pages/callback/callback-page.tsx` — handles `?token1=` tokens
- `artifacts/my-site/src/components/shared/utils/config/config.ts` — `APP_IDS.MY_SITE = 128695`
