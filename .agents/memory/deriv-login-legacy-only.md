---
name: Deriv login flow — legacy OAuth only
description: The ONLY login approach that works for mrcharlohfx.site — app ID 128695
---

## The rule
Use `buildLegacyAuthUrl()` from `pkce.ts` for the login button. App ID is `128695` (numeric, legacy API).
Do NOT use `buildNewAuthUrl()` or `requestOidcAuthentication()`.

**Why:** App `128695` is registered at `developers.deriv.com` (Legacy API) ONLY.
- It does NOT exist in Deriv's new `auth.deriv.com` system → PKCE returns `invalid_client` error
- Attempting PKCE lands user at `home.deriv.com/dashboard/error?error=invalid_client`
- OAuth Redirect URL registered: `https://mrcharlohfx.site/callback` ✅
- Scopes: Read, Trade, Trading Information

## Wallet account limitation (CRITICAL)
App `128695` legacy OAuth does NOT redirect wallet accounts back to our callback.
- Wallet accounts (USD Wallet, eUSDT Wallet on hub.deriv.com) end up at `hub.deriv.com/traders` after login instead of `mrcharlohfx.site/callback`
- The legacy `oauth.deriv.com` system was not designed for Deriv's new wallet accounts
- **To support wallet accounts**: a NEW app must be registered at Deriv's new developer portal that supports `auth.deriv.com` PKCE — this requires user action at developers.deriv.com

## What works
Legacy OAuth flow: `oauth.deriv.com/oauth2/authorize?app_id=128695` → delivers `?token1=...&acct1=...&cur1=...` directly in callback URL for NON-WALLET (old-style) Deriv accounts.

**How to apply:**
- `buildLegacyAuthUrl()` → `https://oauth.deriv.com/oauth2/authorize?app_id=128695&brand=deriv&l=EN&redirect_uri=https://mrcharlohfx.site/callback&state=RANDOM`
- `collectLegacyTokensFromQuery()` in callback-page.tsx reads and stores the returned tokens
- The `logged_state='true'` cookie must be set in `storeTokens` to prevent `api_base.clearAuthData()` from wiping tokens

## What was tried and failed
- `buildNewAuthUrl()` (PKCE via `auth.deriv.com`) → `invalid_client` error — app 128695 NOT registered in auth.deriv.com
- Legacy OAuth for wallet accounts → user ends up at `hub.deriv.com/traders`, callback never reached
- Adding `brand=deriv` to legacy URL → still sends wallet users to hub.deriv.com
- Old app `33bvUt0Jjt7sNGHm4kSqv` — had wrong redirect URL, all flows failed

## File locations
- `artifacts/my-site/src/components/layout/header/header.tsx` — login button → `buildLegacyAuthUrl()`
- `artifacts/my-site/src/components/login-gate/login-gate.tsx` — login gate → `buildLegacyAuthUrl()`
- `artifacts/my-site/src/utils/pkce.ts` — `buildLegacyAuthUrl()`, `collectLegacyTokensFromQuery()`
- `artifacts/my-site/src/pages/callback/callback-page.tsx` — handles `?token1=` tokens
- `artifacts/my-site/src/components/shared/utils/config/config.ts` — `APP_IDS.MY_SITE = 128695`
