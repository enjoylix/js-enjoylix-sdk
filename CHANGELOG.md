# CHANGELOG

## [1.0.6] — Session Ping & Caller Identity — 2026-08-17

### Added
- **Session `ping` attribution event** (AC-10621) — the SDK now reports that a player is online by itself. It is the one attribution event the game does not have to send: it starts once the SDK holds both `auth_id` and `player_id`, then repeats every 6 hours while the page is open.
  - `auth_id` is filled automatically on every login path, including a silent token refresh. `player_id` only exists after the game resolves its own profile, so the game hands it over with the new **`setPlayerId(id)`** — the integration chain is `Enjoylix auth` → `game resolves its profile` → `setPlayerId()` → first ping.
  - Order does not matter: whichever identifier arrives last starts the schedule. Nothing goes out before both are known — a ping without `player_id` is not usable on the backend — so a game that never calls `setPlayerId()` sends no pings at all.
  - Starting is idempotent per account: repeated `ensureValidToken()` calls and token refreshes do **not** reset the 6-hour interval. It restarts only when the account changes. `logout()` stops it.
  - Payload is a standard attribution event (`timestamp`, `player_id`, `auth_id`, `partner`, `platform`) with an empty `event_data: {}`.
  - Parity with `com.enjoylix.sdk` 2.0.9.
- **Caller identity header** (AC-10622) — every request the SDK issues (authentication, purchase, age verification, and attribution) now carries `X-Caller-Identity: js-sdk/<version>` — e.g. `js-sdk/1.0.6` — so the backend can tell which client and which SDK build the traffic came from. It works automatically, nothing to configure. The version is baked into the published bundle at release time and is exported as `SDK_VERSION`; importing the TypeScript sources directly reports `js-sdk/dev`. Parity with `com.enjoylix.sdk` 2.0.8, which sends `unity-sdk/<version>`.
  - **Note for integrators:** a custom header makes cross-origin requests preflighted. Attribution events used to be sent as "simple" requests specifically to avoid that, so they now cost one extra `OPTIONS` round-trip each. Attribution stays fire-and-forget — nothing surfaces to the game either way.

### Fixed
- **The npm tarball is verified before it is published** — the release pipeline now imports the built bundle and asserts it reports the tag it was built from, on top of the existing checks that `dist/` actually made it into the package. 1.0.4 shipped as a package.json-and-README with no code in it; this closes the last way that can happen quietly.

---

## [1.0.5] — 2026-07-17

### Changed
- The `dev` environment moved from the `dev-main` host to the `stage1` alias (`https://stage1.enjoylix.com`).

---

## [1.0.4] — 2026-07-14

Release-pipeline fixes only. **Do not use this version** — it shipped with an empty `dist/`, so the package contains no code.

---

## [1.0.2] — [1.0.3] — 2026-07-14

First published version — the JS/TS port of `com.enjoylix.sdk` for web partners: authentication (guest, OpenID, guest linking, PKCE, refresh), purchases, age verification, and attribution. `1.0.3` re-releases the same commit; `1.0.0`/`1.0.1` were never published.

### Fixed
- **False-dismiss on Android for deep-link-unreliable providers** (e.g. Antilopay/SBP).

### Changed
- Login, purchase, and age-verification flows open in a new tab rather than a popup window.
