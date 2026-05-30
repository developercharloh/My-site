---
name: logged_state cookie + clearAuthData loop
description: Why the logged_state cookie must be set after OIDC callback on mrcharlohfx.site, and why clearAuthData must not auto-reload.
---

## The rule

After `storeTokens` finishes in `callback-page.tsx`, set `Cookies.set('logged_state', 'true', ...)` **before** calling `finishSession` / redirecting.

In `api-base.ts → authorizeAndSubscribe`, call `clearAuthData(false)` (no reload) on `InvalidToken` when `logged_state !== 'true'`.

In `main.tsx`, seed `config.server_url = 'ws.derivws.com'` for third-party domains (mrcharlohfx.site etc.) so auth-client's `getServerInfo()` uses the correct server for the `oauth2/legacy/tokens` call.

**Why:**
`api_base.authorizeAndSubscribe` checks `Cookies.get('logged_state') === 'true'`. If the cookie is absent (Deriv never sets it on third-party domains), an `InvalidToken` error causes `clearAuthData(is_reload=true)` — this wipes `authToken`/`active_loginid` from localStorage AND triggers `location.reload()`. On the second load there are no tokens, so the header shows "Log in" — making it look like the login silently failed even though the PKCE flow completed correctly.

The auto-reload (`clearAuthData(true)`) would also cause an infinite loop if the token was genuinely stale and the page kept reloading to re-authorize.

**How to apply:**
- Whenever the OIDC callback stores tokens (any domain, not just mrcharlohfx.site), set the cookie.
- Keep `clearAuthData(false)` (no reload) in `authorizeAndSubscribe` for the `InvalidToken` branch when `logged_state` is absent — the header will naturally show "Log in" once `authData$` stays null.
- The `config.server_url` seed must only be set when the key is absent in localStorage, so a user who has manually changed their server endpoint isn't overridden.
