---
name: Deriv auth-client login flow
description: Why the login button must use requestOidcAuthentication (not custom buildNewAuthUrl), and why the Callback component must not be bypassed.
---

## The rule

Login button → `requestOidcAuthentication({ redirectCallbackUri: origin/callback })` from `@deriv-com/auth-client`.

Callback page → let auth-client `<Callback>` component run (do NOT intercept with a custom isPkceFlow handler).

**Why:** The auth-client `Callback` component does the complete flow:
1. PKCE code → `auth.deriv.com/oauth2/token` → `access_token`
2. `POST oauth.deriv.com/oauth2/legacy/tokens Authorization: Bearer {access_token}` → `{token1, acct1, cur1, ...}`
3. Calls `onSignInSuccess(tokens, state)` with WebSocket-compatible legacy tokens

Using a custom `buildNewAuthUrl()` + custom PKCE exchange bypasses step 2, resulting in an `access_token` stored as `authToken`. The WebSocket `authorize(access_token)` fails with `InvalidToken`, so `authData$` never emits, `activeLoginid` stays empty, and the header shows "Log in" instead of the account balance.

**The app_id** `33bvUt0Jjt7sNGHm4kSqv` is an alphanumeric OIDC client_id registered at `developers.deriv.com`. It only works with `auth.deriv.com` (PKCE). Passing it to `oauth.deriv.com` as a legacy app_id fails — Deriv redirects to `home.deriv.com/dashboard` instead of `mrcharlohfx.site/callback`.

**How to apply:** Whenever the login button or retry logic needs to trigger auth, always call `requestOidcAuthentication`. Whenever a `?code=` arrives at `/callback`, always let the auth-client `Callback` component handle it — never intercept with a custom exchange.
