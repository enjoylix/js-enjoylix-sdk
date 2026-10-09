# @enjoylix/sdk

JavaScript/TypeScript SDK for Enjoylix web partners (non-Unity). Thin client over the same
backend as the Unity package `com.enjoylix.sdk`: authentication, purchases, age verification,
and attribution.

Builds to **ESM + UMD/CJS + `.d.ts`**. Browser-only (uses `window`, `localStorage`, `fetch`,
WebCrypto, `postMessage`).

## Install

```bash
npm install git+https://github.com/enjoylix/js-enjoylix-sdk.git#<tag>
```

Replace `<tag>` with any existing release tag from the repository's tags (e.g. `1.0.9`). The package is
still imported as `@enjoylix/sdk`.

## Quick start

```ts
import { EnjoylixSdk } from '@enjoylix/sdk';

const sdk = new EnjoylixSdk({
  projectName: 'mygame',   // {project} in REST paths
  platform: 'web',         // GamePlatform registered in admin (type "web")
  env: 'dev',              // or 'prod', or pass explicit baseUrl/attributionUrl
});

// Events
sdk.onLoginCompleted.add((kind, ok) => console.log('login', kind, ok));
sdk.onPopupBlocked.add((url) => console.warn('popup blocked', url));

sdk.initialize();                       // load persisted session (no network)

await sdk.loginGuest('device-id');      // guest login
// or: const session = await sdk.loginOpenId();   // opens a popup to the portal

await sdk.ensureValidToken();           // call before any token-using request

const result = await sdk.purchaseCreate({
  coin_amount: 100,
  game_name: 'mygame',
  transaction_id: 'tx-123',
  transaction_image_url: '',
  transaction_name: 'Coins',
});
// result: { success, paymentId, transactionId, raw } | null (null if popup blocked)

if (await sdk.isAgeVerificationNeeded()) {
  await sdk.startAgeVerification();
}

sdk.trackLogin();                       // attribution (fire-and-forget)
```

## Configuration (`EnjoylixConfig`)

| Field | Required | Default | Notes |
|---|---|---|---|
| `projectName` | yes | — | Substituted into `.../{project}/...` REST paths. |
| `platform` | yes | — | GamePlatform string from admin. Sent in guest_login & age check. |
| `env` | * | — | `'dev'` (stage1) \| `'prod'`. Sets baseUrl + attributionUrl + portalOrigins. |
| `baseUrl` | * | — | Override REST + portal host. |
| `attributionUrl` | * | — | Override attribution host. |
| `authMode` | no | `'auto'` | `'standalone'` \| `'iframe'` \| `'auto'`. Affects **login-on-start** only. |
| `portalOrigins` | no | by env | Accepted origins for inbound `postMessage`. Prod = `enjoylix.com` + `www.`; dev = `stage1.enjoylix.com` + `stage1.wisecite.com`. |
| `lang` | no | `navigator.language` → `'en'` | One of en/ru/de/es/fr/it. |
| `additionalAttributionContext` | no | `{}` | Extra query params + attribution `partner`. |
| `signSecret` | no | — | Key issued by the Enjoylix team. Signs `POST /purchase/create` with an `X-Signature` header; omit it and the request goes out unsigned. |

\* Provide either `env` or both `baseUrl` and `attributionUrl`.

## Auth modes

`authMode` only changes how **login-on-start** works:

- `standalone` — popup login (`window.open` → `auth_result`).
- `iframe` — the game is embedded in the portal; the SDK posts to `window.parent`.
- `auto` (default) — iframe when `window.parent !== window`, otherwise standalone.

`loginOpenId`, purchases, and age verification are **always** popup-based regardless of mode.

## Public API

**Auth:** `initialize()`, `logout()`, `loginGuest(deviceId)`, `loginOpenId(timeoutMs?)`,
`loginOnStart(timeoutMs?)`, `linkGuest(deviceId, timeoutMs?)`, `performLoginWithToken(token)`,
`ensureValidToken()`, `createGameSessionTicket()`. State: `accessToken`, `enjoylixId`,
`isEmailLogin`, `isKnownFullAccount`.

**Purchase:** `purchaseCreate(req, timeoutMs?)`.

**Age:** `isAgeVerificationNeeded()`, `startAgeVerification(timeoutMs?)`.

**Attribution:** `setPlayerId(id)`, `trackLogin()`, `trackRegistration()`,
`trackTutorialComplete()`, `trackPurchase({...})`, `updateAttributionContext(ctx)`.

A `ping` session heartbeat is the one attribution event the SDK sends by itself, but it
needs `player_id` — which only exists after the player has authenticated, so the game hands
it over:

```
Enjoylix auth  →  game resolves its profile  →  setPlayerId()  →  first ping
```

The schedule starts once the SDK holds both `auth_id` (filled automatically on any login
path, including a silent token refresh) and `player_id`, then repeats every 6 hours while
the page is open. Order does not matter — whichever arrives last starts it. Nothing is sent
before both are known, so if the game never calls `setPlayerId()` there is no ping at all.
`logout()` stops it.

**Launch query params:** the query string the page was opened with is read once from
`location.search` and sent in two places — the `query_params` of attribution events, and
the query string of the token request:

```
page url      https://enjoylix.com/mygame/?utm_source=facebook&utm_campaign=summer_sale
token request POST /api/v2/auth/mygame/token?utm_source=facebook&utm_campaign=summer_sale
```

That is what keeps an in-game registration attributed to its campaign instead of counted as
organic. Every param is forwarded as-is, no integration code required.
`updateAttributionContext({ queryParams })` replaces the set for both.

**Game session ticket:** `createGameSessionTicket()` mints a one-time `auth_ticket` the game
backend can validate against Enjoylix, the same handshake Steam uses. The game never sees the
access token — it gets a ticket, and the backend exchanges it for the player's Enjoylix id:

```
client                        game backend                  enjoylix
  │ createGameSessionTicket() ───── POST /api/v2/auth/game_session (Bearer + game_name)
  │ ◄───────────────────────────────────── { session_token, expires_in }
  │ ── auth_ticket ─────────► │
  │                           │ ── validate ──────────────► │
  │                           │ ◄───────── enjoylix user_id │
  │ ◄──── profile ─────────── │  stores user_id, sends it to analytics
```

```ts
const ticket = await sdk.createGameSessionTicket();
await fetch('/game/get_parent_profile', {
  method: 'POST',
  body: JSON.stringify({ auth_ticket: ticket }),
});
```

It calls `ensureValidToken()` first, so it is safe at any point after login. The ticket lives
~60s and the backend burns it on first validation — **never cache or reuse it**. Request one
right before the call that consumes it; if the backend rejects a ticket, mint a fresh one
instead of retrying the old value. Returns `null` if the server answers without a token.

**Events:** `onPopupBlocked`, `onLoginCompleted`, `onTokenReceived`, `onAuthError`,
`onValidationError` (each has `.add(listener)` returning an unsubscribe fn).

## Networking

Every request the SDK issues — authentication, purchase, age verification, and attribution —
carries a header identifying the client and its version, so the backend can tell which client
the traffic came from:

```
X-Caller-Identity: js-sdk/<version>
```

Nothing to configure. `<version>` is baked into the published bundle at release time and is
also exported as `SDK_VERSION`; importing the TypeScript sources directly — or building without
a version — reports `js-sdk/dev` instead. The Unity package sends `unity-sdk/<version>`.

Being a custom header, it makes every cross-origin request preflighted, attribution events
included (they used to go out as "simple" requests).

**A lost connection is not a logout.** Requests that never reach the server — offline, DNS,
a dropped socket — are retried up to 3 times (500ms then 1000ms) before the error reaches you,
and it reaches you as a network error rather than as "not authenticated": startup restore no
longer opens the login window over a player who is still logged in. `isNetworkError(e)` tells
the two apart, so you can show a retry prompt instead of a login screen:

```ts
import { isNetworkError } from '@enjoylix/sdk';

try {
  await sdk.loginOnStart();
} catch (e) {
  if (isNetworkError(e)) showConnectionLost();
  else showLoginScreen();
}
```

Tune or disable it with `new EnjoylixSdk(config, { retry: { maxAttempts: 1 } })`.

**`/users/me` is fetched once per token.** The answer is reused for 15s and never requested
twice in parallel for the same access token, so a link flow costs one profile read per token
instead of three. A new token always fetches; `logout()` drops the cache.

## Development

```bash
npm install
npm test          # Vitest (jsdom)
npm run typecheck
npm run build     # dist/index.js (ESM) + dist/index.umd.cjs (CJS) + .d.ts
```

Manual end-to-end check: `npm run build`, serve the repo (`npx serve .`), open
[`examples/standalone.html`](examples/standalone.html).

The behavioral contract every scenario is tested against lives in
[`contract/scenario-matrix.md`](contract/scenario-matrix.md).
