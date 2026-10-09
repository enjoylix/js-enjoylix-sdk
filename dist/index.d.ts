/** Login flow kinds reported by {@link EnjoylixEvents.onLoginCompleted}. */
type LoginKind = 'GuestLogin' | 'OpenIdLogin' | 'GuestLink' | 'TokenLogin' | 'StartupLogin';
/** Auth transport strategy. Affects ONLY login-on-start; purchase/age are always popup. */
type AuthMode = 'standalone' | 'iframe' | 'auto';
/** Languages the portal renders. Contract §13. */
type SupportedLang = 'en' | 'ru' | 'de' | 'es' | 'fr' | 'it';
/** Public SDK configuration (contract §13). */
interface EnjoylixConfig {
    /** game_name, substituted into `.../{project}/...` REST paths. */
    projectName: string;
    /** GamePlatform value registered in admin (type "web"). Sent in guest_login & check_needed. */
    platform: string;
    /** Named environment, or omit and pass explicit baseUrl/attributionUrl. */
    env?: 'dev' | 'prod';
    /** Override REST + portal host (origin of postMessage). */
    baseUrl?: string;
    /** Override attribution service host. */
    attributionUrl?: string;
    /** Default 'auto' (= `window.parent !== window` → iframe). */
    authMode?: AuthMode;
    /** Portal origins accepted when validating inbound postMessage. Default derived from env. */
    portalOrigins?: string[];
    /** Default `navigator.language` → fallback 'en'. */
    lang?: string;
    /** Extra query params merged into guest_login / auth-page URLs and attribution context. */
    additionalAttributionContext?: Record<string, string>;
    /**
     * Shared secret the Enjoylix team issues, used to sign `POST /purchase/create`.
     * Omit it and the request goes out unsigned.
     */
    signSecret?: string;
}
/** Fully-resolved, validated configuration used internally. */
interface ResolvedConfig {
    projectName: string;
    platform: string;
    baseUrl: string;
    attributionUrl: string;
    authMode: AuthMode;
    portalOrigins: string[];
    lang: SupportedLang;
    additionalAttributionContext: Record<string, string>;
    signSecret: string;
}

type HttpMethod = 'GET' | 'POST';
interface HttpRequest {
    method: HttpMethod;
    url: string;
    /** Short label used in error messages, e.g. "guest_login". */
    context: string;
    /** Bearer access token for authenticated endpoints. */
    bearer?: string;
    /** Request body, JSON-serialized. */
    json?: unknown;
    /** Already-serialized body, sent byte for byte. Takes precedence over `json`. */
    body?: string;
    /** Extra headers merged into the request. */
    headers?: Record<string, string>;
    /**
     * Content-Type for the body (default `application/json`). Attribution sends
     * `text/plain` — the server parses the body as JSON regardless of this header.
     */
    contentType?: string;
}
interface RawResponse {
    status: number;
    text: string;
}
/**
 * Transport port. A conforming implementation resolves on any 2xx and throws
 * {@link EnjoylixApiError} for non-2xx responses and network failures (statusCode 0).
 */
interface HttpClient {
    send(req: HttpRequest): Promise<RawResponse>;
}
/** Parse a successful JSON response body into `T`. */
declare function parseJson<T>(res: RawResponse): T;
/** Default {@link HttpClient} backed by the global `fetch`. */
declare class FetchHttpClient implements HttpClient {
    private readonly fetchImpl;
    constructor(fetchImpl?: typeof fetch);
    send(req: HttpRequest): Promise<RawResponse>;
}

declare const DEFAULT_MAX_ATTEMPTS = 3;
declare const DEFAULT_BASE_DELAY_MS = 500;
interface RetryPolicy {
    /** Total attempts including the first one. `1` disables retrying. */
    maxAttempts?: number;
    /** First backoff step; each further step doubles it. */
    baseDelayMs?: number;
    /** Injected in tests to avoid real timers. */
    sleep?: (ms: number) => Promise<void>;
}
/**
 * Retries transport failures with exponential backoff (contract §5.10, AC-10356).
 *
 * Only {@link isNetworkError} failures are retried — an HTTP status means the server
 * answered and the answer is the truth. A dropped connection on `POST /token` used to
 * surface as "not logged in" and pushed the game into the login window; retrying rides
 * out the blip and, when it does not, the caller gets a network error to show as such.
 */
declare class RetryingHttpClient implements HttpClient {
    private readonly inner;
    private readonly maxAttempts;
    private readonly baseDelayMs;
    private readonly sleep;
    constructor(inner: HttpClient, policy?: RetryPolicy);
    send(req: HttpRequest): Promise<RawResponse>;
}

/** Validation error body returned by the server on HTTP 422 (FastAPI shape). */
interface ValidationErrorDetail {
    loc: (string | number)[];
    msg: string;
    type: string;
}
interface ValidationErrorResponse {
    detail: ValidationErrorDetail[];
}
/**
 * Thrown for any non-2xx REST response (and network failures, with `statusCode === 0`).
 * Mirrors C# `EnjoylixApiException`. Contract §1.1.
 */
declare class EnjoylixApiError extends Error {
    readonly statusCode: number;
    readonly responseBody: string;
    readonly validationError?: ValidationErrorResponse;
    constructor(message: string, statusCode: number, responseBody: string, validationError?: ValidationErrorResponse);
}
/** `statusCode` used for transport failures that never produced an HTTP response. */
declare const NETWORK_ERROR_STATUS = 0;
/**
 * True for a transport failure (DNS, offline, CORS, aborted socket) — the request never
 * reached a status line. Such a failure is retryable and must never be read as "the user
 * is logged out" (contract §5.10, AC-10356).
 */
declare function isNetworkError(e: unknown): boolean;
/** Raised when the browser blocks `window.open` for a login/purchase/age popup. */
declare class PopupBlockedError extends Error {
    readonly url: string;
    constructor(url: string);
}
/** Raised when a popup/iframe flow exceeds its timeout without a result. */
declare class FlowTimeoutError extends Error {
    constructor(context: string);
}
/** Raised when the user closes the popup/iframe flow without completing it. */
declare class UserDismissedError extends Error {
    constructor();
}
/** Raised when a flow is canceled programmatically (e.g. a newer purchase supersedes it). */
declare class FlowCanceledError extends Error {
    constructor(reason?: string);
}

/**
 * Minimal typed event signal — the JS equivalent of a C# `event Action<...>`.
 * `add` returns an unsubscribe fn. Listener exceptions are isolated so one bad
 * subscriber can't break the SDK's control flow.
 */
declare class Signal<Args extends unknown[]> {
    private listeners;
    add(listener: (...args: Args) => void): () => void;
    remove(listener: (...args: Args) => void): void;
    emit(...args: Args): void;
}

/**
 * Thin, fully-mockable abstraction over the browser globals the transport needs
 * (`window.open`, `message` events, posting to `window.parent`). Replaces the Unity
 * C#↔wasm bridge (`.jslib`/`.jspre`) with native JS. Contract §9, §11.
 */
/** A handle to an opened popup window. */
interface PopupHandle {
    /** Whether the popup has been closed (by user or by us). */
    readonly closed: boolean;
    /** Close the popup. */
    close(): void;
    /** The popup's window object, compared against `event.source`. */
    readonly source: unknown;
}
/** Minimal message-event shape (subset of `MessageEvent`). */
interface MessageLike {
    data: unknown;
    origin: string;
    source: unknown;
}
interface BrowserEnv {
    /** `window.open`; returns `null` when blocked. */
    open(url: string, name: string, features?: string): PopupHandle | null;
    /** Subscribe to `message` events; returns an unsubscribe fn. */
    onMessage(handler: (e: MessageLike) => void): () => void;
    /** Post a message to `window.parent` (iframe login-on-start). */
    postToParent(message: unknown, targetOrigin: string): void;
    /** The `window.parent` object, compared against `event.source` in iframe mode. */
    parentSource(): unknown;
    /** `window.parent !== window` — i.e. we are embedded in an iframe. */
    isInsideIframe(): boolean;
}
/** Real {@link BrowserEnv} backed by the global `window`. */
declare class WindowBrowserEnv implements BrowserEnv {
    private readonly win;
    constructor(win?: Window);
    open(url: string, name: string, features?: string): PopupHandle | null;
    onMessage(handler: (e: MessageLike) => void): () => void;
    postToParent(message: unknown, targetOrigin: string): void;
    parentSource(): unknown;
    isInsideIframe(): boolean;
}

/**
 * Auth storage (contract §4). Web port of C# `IAuthStorage`/`PlayerPrefsAuthStorage`
 * minus AES — `localStorage` is already origin-scoped. Tri-state `is_guest`
 * (`"1"`/`"0"`/absent→null). `clear()` keeps `device_id`.
 */
declare const StorageKeys: {
    readonly guestId: "enjoylix_guest_id";
    readonly accessToken: "enjoylix_access_token";
    readonly refreshToken: "enjoylix_refresh_token";
    readonly deviceId: "enjoylix_device_id";
    readonly isGuest: "enjoylix_is_guest";
};
/** Minimal `localStorage`-compatible backend (injectable for tests / SSR). */
interface KeyValueStore {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
interface AuthStorage {
    loadGuestId(): string | null;
    saveGuestId(guestId: string): void;
    loadAccessToken(): string | null;
    /** Falsy token removes the key (so clearing the session actually clears storage). */
    saveAccessToken(token: string | null): void;
    loadRefreshToken(): string | null;
    saveRefreshToken(token: string | null): void;
    loadDeviceId(): string | null;
    saveDeviceId(deviceId: string): void;
    /** Tri-state: `true`/`false`/`null` (key absent). */
    loadIsGuest(): boolean | null;
    saveIsGuest(isGuest: boolean): void;
    /** Removes guest_id, access_token, refresh_token, is_guest — keeps device_id. */
    clear(): void;
}
declare class LocalStorageAuthStorage implements AuthStorage {
    private readonly store;
    constructor(store?: KeyValueStore);
    loadGuestId(): string | null;
    saveGuestId(guestId: string): void;
    loadAccessToken(): string | null;
    saveAccessToken(token: string | null): void;
    loadRefreshToken(): string | null;
    saveRefreshToken(token: string | null): void;
    loadDeviceId(): string | null;
    saveDeviceId(deviceId: string): void;
    loadIsGuest(): boolean | null;
    saveIsGuest(isGuest: boolean): void;
    clear(): void;
}
/** In-memory {@link KeyValueStore} (tests, SSR fallback). */
declare class MemoryKeyValueStore implements KeyValueStore {
    private map;
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/** Auth DTOs and session shapes. Mirrors C# `Auth.Models`. Contract §1. */
/** `GET .../guest_login` response. */
interface GuestLoginResponse {
    id: string;
    is_guest: boolean;
    confirmed: boolean;
    age_verified: boolean;
    access_token: string;
    refresh_token: string;
}
/** Subset of `GET /users/me` the SDK reads (server returns more). */
interface OpenIdUserResponse {
    id: string;
    is_guest: boolean;
    age_verified: boolean;
}
/** `POST .../token` and `POST /auth/refresh` response. */
interface TokensPair {
    access_token: string;
    refresh_token: string;
    token_type: string;
}
/** `POST /api/v2/auth/game_session` response. */
interface GameSessionResponse {
    session_token: string;
    expires_in: number;
}
/** Result of a successful auth/ensure operation. */
interface AuthSession {
    accessToken: string;
    me: OpenIdUserResponse;
}

/** Purchase DTOs. Mirrors C# `Purchase.Models`. Contract §1, §6. */
/** Body of `POST /purchase/create`. */
interface PurchaseCreateRequest {
    coin_amount: number;
    game_name: string;
    transaction_id: string;
    transaction_image_url: string;
    transaction_name: string;
}
interface PurchaseCreateResponse {
    transaction_url: string;
}
interface PurchaseStatusResponse {
    id: string;
    created_on: string;
    status: string;
}
/** Response of `GET /purchase/coin_spend_status` (keyed on game_name + game_transaction_id). */
interface CoinSpendStatusResponse {
    id: string;
    status: string;
}
/** Outcome of a `CreateOpenAndWait` purchase flow (contract §6, PUR-03). */
interface PaymentResult {
    success: boolean;
    paymentId: string;
    transactionId: string;
    /** The raw postMessage payload that produced this result. */
    raw: unknown;
}

/**
 * Query params the game was launched with. One instance is shared by `UrlBuilder`
 * (token request) and `AttributionService` (`query_params`), so both always report
 * the same set.
 */
declare class SessionQueryParams {
    private params;
    constructor(initial?: Record<string, string>);
    static fromQueryString(qs: string): SessionQueryParams;
    get values(): Record<string, string>;
    set(values: Record<string, string>): void;
}

/** REST paths and portal pages. Mirrors C# `Endpoints`. */
declare const Endpoints: {
    readonly loginPage: "/login";
    readonly linkGuestPage: "/link-guest";
    readonly ageVerificationPage: "/age-verification";
    readonly guestLogin: "/api/v2/auth/{project}/guest_login";
    readonly userInfo: "/api/v1/users/me";
    readonly tokensPair: "/api/v2/auth/{project}/token";
    readonly refreshToken: "/api/v2/auth/refresh";
    readonly gameSession: "/api/v2/auth/game_session";
    readonly checkVerificationNeeded: "/api/v1/age_verification/{project}/check_needed";
    readonly purchaseCreate: "/api/v1/purchase/create";
    readonly purchaseComplete: "/api/v1/purchase/complete";
    readonly purchaseStatus: "/api/v1/purchase/status";
    readonly coinSpendStatus: "/api/v1/purchase/coin_spend_status";
    readonly attributionEvent: "/ingame/{project}/event";
};
/**
 * Builds every REST and portal URL the SDK needs. Web-only: `return_type` is always
 * `post_message` (deeplink branches are dropped — contract §11). Mirrors C# `UrlBuilder`.
 */
declare class UrlBuilder {
    private readonly config;
    private readonly sessionQueryParams?;
    constructor(config: ResolvedConfig, sessionQueryParams?: SessionQueryParams | undefined);
    private get base();
    private project;
    private get extra();
    buildGuestLoginUrl(deviceId: string): string;
    /** Portal login / link-guest page. `isLink` selects `/link-guest`. */
    buildAuthPageUrl(opts: {
        isLink: boolean;
        codeChallenge?: string;
        token?: string;
        /** Lets the portal reuse the account already tied to this device (AC-10433). */
        deviceId?: string | undefined;
        /** Portal returns straight to the game, creating a guest only if there is none (AC-10433). */
        instaReg?: boolean;
    }): string;
    buildUserInfoUrl(): string;
    /** Carries the launch query params so the backend can attribute the in-game registration. */
    buildTokensPairUrl(): string;
    buildRefreshTokenUrl(): string;
    buildGameSessionUrl(): string;
    buildCheckVerificationNeededUrl(): string;
    buildAgeVerificationPageUrl(accessToken?: string): string;
    buildPurchaseCreateUrl(): string;
    buildPurchaseCompleteUrl(): string;
    buildPurchaseStatusUrl(paymentId: string): string;
    buildCoinSpendStatusUrl(gameName: string, gameTransactionId: string): string;
    buildAttributionUrl(): string;
    /**
     * Appends `project_name`, `lang`, `return_type=post_message` to the server-issued
     * `transaction_url` (which already carries token/payment_id/etc.). Contract §6.
     */
    decoratePurchaseUrl(transactionUrl: string): string;
}

/**
 * Mutable attribution context. Web fields replace the Unity deeplink source:
 * `partner`/query params come from `location.search` instead of a deeplink URL.
 * Contract §8.
 */
interface AttributionContext {
    playerId?: string;
    authId?: string;
    countryCode?: string;
    clientIp?: string;
    platformId?: string;
    /** Overrides the query params parsed from `location.search` (source of `partner`). */
    queryParams?: Record<string, string>;
}
/** Base event envelope (contract §8). */
interface AttributionEvent {
    timestamp: number;
    player_id: string;
    auth_id: string;
    partner: string;
    platform: string;
    event: string;
    event_data: Record<string, unknown>;
}
interface AttributionServiceDeps {
    http: HttpClient;
    urlBuilder: UrlBuilder;
    /** Envelope `platform` (the configured GamePlatform string). */
    platform: string;
    /**
     * Resolves the current Enjoylix account id when an event is built. Preferred
     * over `context.authId`, which cannot follow logout (ATTR-06b).
     */
    authIdProvider?: () => string | null | undefined;
    context?: AttributionContext;
    /** Shared with `UrlBuilder` so the token request reports the same set. */
    sessionQueryParams?: SessionQueryParams;
    /** Testing/SSR seams. */
    now?: () => number;
    queryString?: () => string;
    userAgent?: () => string;
    referrer?: () => string;
    pingIntervalMs?: number;
    pingPollIntervalMs?: number;
}
/**
 * Attribution events (contract §8). Fire-and-forget: every `track*` returns a
 * promise that NEVER rejects (network errors are swallowed, ATTR-05). Mirrors
 * C# `AttributionService`.
 */
declare class AttributionService {
    private readonly http;
    private readonly urlBuilder;
    private readonly platform;
    private readonly authIdProvider;
    private readonly now;
    private readonly getUserAgent;
    private readonly getReferrer;
    private context;
    private readonly sessionQueryParams;
    private readonly pingIntervalMs;
    private readonly pingPollIntervalMs;
    private pingTimer;
    private pingAccountId;
    private pingDueAt;
    constructor(deps: AttributionServiceDeps);
    trackLogin(): Promise<void>;
    trackRegistration(): Promise<void>;
    trackTutorialComplete(): Promise<void>;
    trackPing(): Promise<void>;
    startSessionPing(): void;
    stopSessionPing(): void;
    trackPurchase(params: {
        eventType: string;
        source: string;
        checkoutId: string;
        transactionId: string;
        amount: number;
        currencyCode: string;
        isQaPurchase: boolean;
    }): Promise<void>;
    /** Merges non-empty fields into the context (mirrors C# `UpdateContext`). */
    updateContext(ctx: AttributionContext): void;
    /** Drops the game-supplied `auth_id` override (mirrors C# `ClearAuthId`). */
    clearAuthId(): void;
    /**
     * Resolved when the event is built, not pushed once: a snapshot could not be
     * cleared on logout and was empty until the first session applied.
     */
    private resolveAuthId;
    private loginRegistrationData;
    private buildEnvelope;
    private send;
}

/** Optional dependency overrides (testing / SSR / custom transports). */
interface EnjoylixSdkDeps {
    httpClient?: HttpClient;
    storage?: AuthStorage;
    browserEnv?: BrowserEnv;
    /** Transport-failure retry policy (AC-10356). `{ maxAttempts: 1 }` turns it off. */
    retry?: RetryPolicy;
}
/**
 * Public entry point — wires config (§13) and all four services, mirroring the
 * Unity `EnjoylixSdk` facade. Events (§10) are aggregated here. `purchase`/`age`
 * call `ensureValidToken` first (parity with C#).
 */
declare class EnjoylixSdk {
    readonly onPopupBlocked: Signal<[string]>;
    readonly onLoginCompleted: Signal<[LoginKind, boolean]>;
    readonly onTokenReceived: Signal<[string]>;
    readonly onAuthError: Signal<[Error]>;
    readonly onValidationError: Signal<[ValidationErrorResponse]>;
    readonly config: ResolvedConfig;
    private readonly auth;
    private readonly purchase;
    private readonly ageVerification;
    private readonly attribution;
    constructor(config: EnjoylixConfig, deps?: EnjoylixSdkDeps);
    private wireEvents;
    private handleSessionApplied;
    get isEmailLogin(): boolean;
    get isKnownFullAccount(): boolean;
    get enjoylixId(): string | null;
    get accessToken(): string | null;
    initialize(): void;
    logout(): void;
    ensureValidToken(): Promise<AuthSession>;
    loginGuest(deviceId: string): Promise<string>;
    loginOpenId(timeoutMs?: number): Promise<AuthSession | null>;
    /** Login-on-start; picks popup vs iframe by `authMode` (default 'auto'). */
    loginOnStart(timeoutMs?: number, deviceId?: string): Promise<AuthSession | null>;
    linkGuest(deviceId: string, timeoutMs?: number): Promise<AuthSession | null>;
    performLoginWithToken(token: string): Promise<AuthSession>;
    /**
     * Mints a one-time `auth_ticket` for the game backend, which validates it against
     * Enjoylix to learn who the player is. Expires in ~60s and is burned on first
     * validation — request one per call, never cache it.
     */
    createGameSessionTicket(): Promise<string | null>;
    purchaseCreate(req: PurchaseCreateRequest, timeoutMs?: number): Promise<PaymentResult | null>;
    isAgeVerificationNeeded(): Promise<boolean>;
    startAgeVerification(timeoutMs?: number): Promise<boolean>;
    /** Hands over the in-game profile id. Releases the session ping (§8, ATTR-06). */
    setPlayerId(playerId: string): void;
    trackLogin(): void;
    trackRegistration(): void;
    trackTutorialComplete(): void;
    trackPurchase(params: {
        eventType: string;
        source: string;
        checkoutId: string;
        transactionId: string;
        amount: number;
        currencyCode: string;
        isQaPurchase: boolean;
    }): void;
    updateAttributionContext(ctx: AttributionContext): void;
}

/** Built-in environments (contract §13). REST API + portal + postMessage share one host. */
declare const ENVIRONMENTS: {
    readonly dev: {
        readonly baseUrl: "https://stage1.enjoylix.com";
        readonly attributionUrl: "https://stage1.enjoylix.com";
        readonly portalOrigins: readonly ["https://stage1.enjoylix.com", "https://stage1.wisecite.com"];
    };
    readonly prod: {
        readonly baseUrl: "https://enjoylix.com";
        readonly attributionUrl: "https://enjoylix.com";
        readonly portalOrigins: readonly ["https://enjoylix.com", "https://www.enjoylix.com"];
    };
};
/** Primary subtag of a BCP-47 tag, mapped to the portal's supported set (fallback 'en'). */
declare function normalizeLang(raw: string | undefined): SupportedLang;
/** Origin (`scheme://host[:port]`) of a URL, for postMessage validation. */
declare function originOf(url: string): string;
declare function resolveConfig(config: EnjoylixConfig): ResolvedConfig;

/** Identifies the calling client and its version on every request (contract §1.2). */
declare const CALLER_IDENTITY_HEADER = "X-Caller-Identity";
/** `source` half of the header value. The Unity package sends `unity-sdk`. */
declare const CALLER_SOURCE = "js-sdk";
/** Fallback version when no real one was baked in. Mirrors C# `SdkVersion.Unknown`. */
declare const UNKNOWN_VERSION = "dev";
/** Mirrors C# `SdkVersion.IsRealVersion`: blank or dot-less falls back to `dev`. */
declare function resolveSdkVersion(raw: string | undefined): string;
/** Version of this SDK build, e.g. `1.0.6`, or `dev` when it cannot be resolved. */
declare const SDK_VERSION: string;
/** Value sent in {@link CALLER_IDENTITY_HEADER}, e.g. `js-sdk/1.0.6`. */
declare const CALLER_IDENTITY: string;

/**
 * PKCE (S256) helpers. Verified 1:1 against server `utils/auth.verify_pkce`,
 * C# `PkceUtils`, and WebCrypto. Contract §3.
 */
/** `code_verifier = base64url(32 CSPRNG bytes)`. */
declare function generateCodeVerifier(): string;
/** `code_challenge = base64url(SHA256(utf8(verifier)))`. */
declare function generateCodeChallenge(verifier: string): Promise<string>;
interface PkcePair {
    codeVerifier: string;
    codeChallenge: string;
}
declare function generatePkcePair(): Promise<PkcePair>;

/**
 * postMessage payload parsers. Contract §2. Each returns a typed result, or `null`
 * to mean "not my message, keep waiting". The portal posts plain objects, but the
 * Unity bridge stringified them — so we also accept a JSON string (defensive).
 */
/** Window names used for popups (contract §2.A). */
declare const WindowNames: {
    readonly auth: "enjoylix_auth";
    readonly pay: "enjoylix_pay";
    readonly age: "enjoylix_age_verification";
};
/** postMessage `type` discriminators. */
declare const MessageTypes: {
    readonly authResult: "auth_result";
    readonly paymentResult: "payment_result";
    readonly ageResult: "age_verification_result";
    readonly portalLoginRequest: "enjoylix_portal_login_request";
    readonly portalLoginResult: "enjoylix_portal_login_result";
};
/** §2.A Auth (v2/PKCE): `{ type:"auth_result", auth_code }`. */
declare function parseAuthResult(data: unknown): {
    authCode: string;
} | null;
interface PaymentMessage {
    success: boolean;
    paymentId: string;
    gameTransactionId: string;
}
/** §2.A Payment: `{ type:"payment_result", success, payment_id, game_transaction_id }`. Rejects empty payment_id (PUR-05). */
declare function parsePaymentResult(data: unknown): PaymentMessage | null;
/** §2.A Age: `{ type:"age_verification_result", success }`. */
declare function parseAgeResult(data: unknown): {
    success: boolean;
} | null;
/** §2.B iframe result: `{ type:"enjoylix_portal_login_result", auth_code | error }`. */
declare function parsePortalLoginResult(data: unknown): {
    authCode?: string;
    error?: string;
} | null;

interface PopupFlowOptions<T> {
    url: string;
    windowName: string;
    context: string;
    /** Returns a result, or `null` to keep waiting (e.g. foreign message). */
    parse: (data: unknown) => T | null;
    /** Accepted message origins. Empty array disables origin validation. */
    allowedOrigins: string[];
    timeoutMs?: number;
    windowFeatures?: string;
    /** Aborts the flow (rejects with {@link FlowCanceledError}) — e.g. a newer purchase. */
    signal?: AbortSignal;
}
/**
 * Opens a popup and resolves with the first matching `message` (filtered by
 * `event.source === popup` and origin). Throws {@link PopupBlockedError} if the
 * popup is blocked, {@link UserDismissedError} if closed early, {@link FlowTimeoutError}
 * on timeout. Used by LoginOpenId, Purchase, Age — all popup (contract §2.A, §9).
 */
declare function runPopupFlow<T>(env: BrowserEnv, opts: PopupFlowOptions<T>): Promise<T>;
interface IframeLoginOptions {
    codeChallenge: string;
    /** Portal origins accepted for the inbound result (TRANS-07). */
    allowedOrigins: string[];
    timeoutMs?: number;
}
/**
 * Login-on-start via the iframe portal: posts `enjoylix_portal_login_request` to
 * `window.parent` and awaits `enjoylix_portal_login_result`. Rejects on the portal's
 * `{ error }` field without waiting for timeout (TRANS-06). Contract §2.B, §9.
 */
declare function runIframeLoginFlow(env: BrowserEnv, opts: IframeLoginOptions): Promise<string>;

/** REST surface used by {@link AuthService} (interface allows mocking in tests). */
interface AuthApi {
    guestLogin(deviceId: string): Promise<GuestLoginResponse>;
    getMe(accessToken: string): Promise<OpenIdUserResponse>;
    getTokensPair(authCode: string, codeVerify: string): Promise<TokensPair>;
    refreshToken(refreshToken: string): Promise<TokensPair>;
    createGameSession(accessToken: string, gameName: string): Promise<GameSessionResponse>;
}
/** Default {@link AuthApi} over {@link HttpClient} + {@link UrlBuilder}. Mirrors C# `AuthApiClient`. */
declare class AuthApiClient implements AuthApi {
    private readonly http;
    private readonly urls;
    constructor(http: HttpClient, urls: UrlBuilder);
    guestLogin(deviceId: string): Promise<GuestLoginResponse>;
    getMe(accessToken: string): Promise<OpenIdUserResponse>;
    getTokensPair(authCode: string, codeVerify: string): Promise<TokensPair>;
    refreshToken(refreshToken: string): Promise<TokensPair>;
    createGameSession(accessToken: string, gameName: string): Promise<GameSessionResponse>;
}

/**
 * Returns an `auth_code` for an OpenID login. Abstracts the DOM transport from
 * {@link AuthService} (the state machine) — mirrors C# `WebBrowserService`/`AuthFlow`.
 */
interface AuthLoginTransport {
    /** Popup login (`window.open` → `auth_result`). Used by LoginOpenId / LinkGuest. */
    popupLogin(url: string, timeoutMs: number): Promise<string>;
    /** Iframe login-on-start (post to `window.parent` → `enjoylix_portal_login_result`). */
    iframeLogin(codeChallenge: string, timeoutMs: number): Promise<string>;
}
/** Real {@link AuthLoginTransport} over {@link BrowserEnv}. */
declare class BrowserAuthLoginTransport implements AuthLoginTransport {
    private readonly env;
    private readonly allowedOrigins;
    constructor(env: BrowserEnv, allowedOrigins: string[]);
    popupLogin(url: string, timeoutMs: number): Promise<string>;
    iframeLogin(codeChallenge: string, timeoutMs: number): Promise<string>;
}

interface AuthServiceDeps {
    urlBuilder: UrlBuilder;
    api: AuthApi;
    storage: AuthStorage;
    transport: AuthLoginTransport;
    authMode: AuthMode;
    /** `game_name` of a game session ticket — the `projectName` from the config. */
    projectName: string;
    /** `window.parent !== window` — drives 'auto' login-on-start (TRANS-02). */
    isInsideIframe: () => boolean;
    /** Override PKCE generation (deterministic tests). */
    pkce?: () => Promise<PkcePair>;
    defaultFlowTimeoutMs?: number;
    /** Reuse window for `/me` per access token (AC-9516). `0` disables the cache. */
    meCacheTtlMs?: number;
    /** Injected clock (deterministic tests). */
    now?: () => number;
}
/**
 * Auth state machine (contract §5). Port of C# `AuthService`, with the documented
 * JS fixes: refresh treats **401 AND 403** as "refresh invalid → relogin" (§1.1,
 * AUTH-REFRESH-02), and clearing the session actually removes the stored access token.
 */
declare class AuthService {
    readonly onTokenReceived: Signal<[string]>;
    readonly onSessionApplied: Signal<[]>;
    readonly onAuthError: Signal<[Error]>;
    readonly onPopupBlocked: Signal<[string]>;
    readonly onLoginCompleted: Signal<[LoginKind, boolean]>;
    readonly onValidationError: Signal<[ValidationErrorResponse]>;
    private _accessToken;
    private _guestId;
    private _deviceId;
    private _me;
    private readonly urlBuilder;
    private readonly api;
    private readonly storage;
    private readonly transport;
    private readonly authMode;
    private readonly gameName;
    private readonly isInsideIframe;
    private readonly pkce;
    private readonly defaultTimeout;
    private readonly meCacheTtl;
    private readonly now;
    /** Serializes EnsureValidToken (purchase + UI etc.) — C# `SemaphoreSlim(1,1)`. */
    private gate;
    private meCache;
    private meInFlight;
    constructor(deps: AuthServiceDeps);
    get accessToken(): string | null;
    get guestId(): string | null;
    get deviceId(): string | null;
    get me(): OpenIdUserResponse | null;
    get enjoylixId(): string | null;
    get isEmailLogin(): boolean;
    /** `storage.is_guest === false` (explicit false, not null). */
    get isKnownFullAccount(): boolean;
    /** Loads saved ids/token into memory. No network, no auto-login (AUTH-INIT-01/02). */
    initialize(): void;
    /** Clears in-memory state and storage (keeps device_id) (AUTH-LOGOUT-01). */
    logout(): void;
    /** Call before any token-using request. Re-auths if the token is missing/expired. */
    ensureValidToken(): Promise<AuthSession>;
    loginGuest(deviceId: string): Promise<string>;
    /** Popup login. Returns `null` (not throw) when the popup is blocked (AUTH-OID-02). */
    loginOpenId(timeoutMs?: number): Promise<AuthSession | null>;
    /** Iframe-portal login-on-start (AUTH-OID-05). No popup → no popup-blocked path. */
    loginOnStartWeb(timeoutMs?: number): Promise<AuthSession>;
    /**
     * Standalone login-on-start that reuses the account already tied to the device
     * (AC-10433). Restores a stored session without any popup first; only if that
     * fails does it open the portal, passing `device_id` + `insta_reg` so the portal
     * returns the existing account instead of minting a second guest.
     */
    loginOnStartNative(deviceId?: string, timeoutMs?: number): Promise<AuthSession | null>;
    /**
     * Silent session restore: current token, then refresh token. Never opens a
     * popup — unlike `ensureValidToken`, which falls through to `reLoginByPolicy`.
     *
     * Rejects instead of answering `null` when the failure was the network (AC-10356):
     * `null` means "no session to restore" and the caller acts on it by opening the login
     * portal, which is the wrong answer for a request that never reached the server.
     */
    private tryRestoreSession;
    /** Picks popup vs iframe for login-on-start by `authMode` (contract §9, TRANS-01..04). */
    loginOnStart(timeoutMs?: number, deviceId?: string): Promise<AuthSession | null>;
    private resolveUseIframe;
    linkGuest(deviceId: string, timeoutMs?: number): Promise<AuthSession | null>;
    tokenLogin(token: string): Promise<AuthSession>;
    /**
     * One-time ticket proving to the game backend that this user is authenticated here.
     * The server expires it after ~60s and burns it on first validation, so request it
     * immediately before the call that consumes it — never cache or reuse the value.
     * If the backend rejects a ticket, call this again to mint a fresh one.
     */
    createGameSessionTicket(): Promise<string | null>;
    /**
     * `/me` for one access token, at most once per {@link DEFAULT_ME_CACHE_TTL_MS} window
     * and never twice in parallel (AC-9516). Linking used to spend three round-trips on the
     * same profile: the pre-flight `ensureValidToken`, the one behind the freshly minted
     * token, and the game's own call right after.
     */
    private fetchMe;
    private invalidateMeCache;
    private processAccessToken;
    private tryRefreshOrRelogin;
    private reLoginByPolicy;
    private processAuthCode;
    private applySession;
    private clearStoredTokens;
    private emitValidationIfAny;
    private runExclusive;
}

/** REST surface for purchases (interface allows mocking). Contract §1. */
interface PurchaseApi {
    create(accessToken: string, req: PurchaseCreateRequest): Promise<PurchaseCreateResponse>;
    /** Returns the raw response text. */
    complete(accessToken: string, paymentId: string): Promise<string>;
    status(accessToken: string, paymentId: string): Promise<PurchaseStatusResponse>;
    /** Coin-spend status keyed on the identifiers the client already holds. */
    coinSpendStatus(accessToken: string, gameName: string, gameTransactionId: string): Promise<CoinSpendStatusResponse>;
}
/** Default {@link PurchaseApi} over {@link HttpClient}. Mirrors C# `PurchaseApiClient`. */
declare class PurchaseApiClient implements PurchaseApi {
    private readonly http;
    private readonly urls;
    private readonly signSecret;
    constructor(http: HttpClient, urls: UrlBuilder, signSecret?: string);
    create(accessToken: string, req: PurchaseCreateRequest): Promise<PurchaseCreateResponse>;
    complete(accessToken: string, paymentId: string): Promise<string>;
    status(accessToken: string, paymentId: string): Promise<PurchaseStatusResponse>;
    coinSpendStatus(accessToken: string, gameName: string, gameTransactionId: string): Promise<CoinSpendStatusResponse>;
}

interface PurchaseServiceDeps {
    api: PurchaseApi;
    urlBuilder: UrlBuilder;
    env: BrowserEnv;
    /** Portal origins accepted for the inbound payment_result message. */
    portalOrigins: string[];
    defaultTimeoutMs?: number;
}
/**
 * Purchase orchestration (contract §6). `create` → decorate URL → open popup →
 * await `payment_result` matching our `transaction_id`. A new purchase supersedes
 * the previous in-flight one (PUR-07). Mirrors C# `PurchaseService`/`PurchaseFlow`.
 */
declare class PurchaseService {
    readonly onPopupBlocked: Signal<[string]>;
    private readonly api;
    private readonly urlBuilder;
    private readonly env;
    private readonly portalOrigins;
    private readonly defaultTimeout;
    /** Supersedes the previously active purchase flow (PUR-07). */
    private activeController;
    constructor(deps: PurchaseServiceDeps);
    /**
     * Creates a payment, opens the checkout popup, and resolves once a matching
     * `payment_result` arrives. Returns `null` if the popup was blocked (PUR-04).
     */
    createOpenAndWait(accessToken: string, req: PurchaseCreateRequest, timeoutMs?: number): Promise<PaymentResult | null>;
    /**
     * Single safety-net query: resolves to a successful {@link PaymentResult} only if the
     * server reports the coin spend as `completed`; otherwise `null`, so the caller rethrows
     * {@link UserDismissedError}. Any other status, a 404, or a network error means "not completed".
     */
    private tryReconcile;
    create(accessToken: string, req: PurchaseCreateRequest): Promise<{
        transaction_url: string;
    }>;
    complete(accessToken: string, paymentId: string): Promise<string>;
    status(accessToken: string, paymentId: string): Promise<PurchaseStatusResponse>;
}

/** REST surface for age verification (interface allows mocking). Contract §1, §7. */
interface AgeVerificationApi {
    checkNeeded(accessToken: string): Promise<boolean>;
}
declare class AgeVerificationApiClient implements AgeVerificationApi {
    private readonly http;
    private readonly urls;
    constructor(http: HttpClient, urls: UrlBuilder);
    checkNeeded(accessToken: string): Promise<boolean>;
}
interface AgeVerificationServiceDeps {
    api: AgeVerificationApi;
    urlBuilder: UrlBuilder;
    env: BrowserEnv;
    portalOrigins: string[];
    defaultTimeoutMs?: number;
}
/**
 * Age verification (contract §7). `isVerificationNeeded` checks the server flag;
 * `startVerification` opens the portal popup and resolves with `success`.
 * Mirrors C# `AgeVerificationService`.
 */
declare class AgeVerificationService {
    readonly onPopupBlocked: Signal<[string]>;
    private readonly api;
    private readonly urlBuilder;
    private readonly env;
    private readonly portalOrigins;
    private readonly defaultTimeout;
    constructor(deps: AgeVerificationServiceDeps);
    isVerificationNeeded(accessToken: string): Promise<boolean>;
    /** Opens the age-verification popup; resolves `success`, or `false` if popup blocked (AGE-04). */
    startVerification(accessToken: string, timeoutMs?: number): Promise<boolean>;
}

export { type AgeVerificationApi, AgeVerificationApiClient, AgeVerificationService, type AgeVerificationServiceDeps, type AttributionContext, type AttributionEvent, AttributionService, type AttributionServiceDeps, type AuthApi, AuthApiClient, type AuthLoginTransport, type AuthMode, AuthService, type AuthServiceDeps, type AuthSession, type AuthStorage, BrowserAuthLoginTransport, type BrowserEnv, CALLER_IDENTITY, CALLER_IDENTITY_HEADER, CALLER_SOURCE, DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_ATTEMPTS, ENVIRONMENTS, Endpoints, EnjoylixApiError, type EnjoylixConfig, EnjoylixSdk, type EnjoylixSdkDeps, FetchHttpClient, FlowCanceledError, FlowTimeoutError, type GameSessionResponse, type GuestLoginResponse, type HttpClient, type HttpMethod, type HttpRequest, type IframeLoginOptions, type KeyValueStore, LocalStorageAuthStorage, type LoginKind, MemoryKeyValueStore, type MessageLike, MessageTypes, NETWORK_ERROR_STATUS, type OpenIdUserResponse, type PaymentMessage, type PaymentResult, type PkcePair, PopupBlockedError, type PopupFlowOptions, type PopupHandle, type PurchaseApi, PurchaseApiClient, type PurchaseCreateRequest, type PurchaseCreateResponse, PurchaseService, type PurchaseServiceDeps, type PurchaseStatusResponse, type RawResponse, type ResolvedConfig, type RetryPolicy, RetryingHttpClient, SDK_VERSION, Signal, StorageKeys, type SupportedLang, type TokensPair, UNKNOWN_VERSION, UrlBuilder, UserDismissedError, type ValidationErrorDetail, type ValidationErrorResponse, WindowBrowserEnv, WindowNames, generateCodeChallenge, generateCodeVerifier, generatePkcePair, isNetworkError, normalizeLang, originOf, parseAgeResult, parseAuthResult, parseJson, parsePaymentResult, parsePortalLoginResult, resolveConfig, resolveSdkVersion, runIframeLoginFlow, runPopupFlow };
