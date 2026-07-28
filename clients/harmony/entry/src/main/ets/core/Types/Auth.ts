/**
 * Wire DTOs for the RFC 8628 device-authorisation flow, the credentials
 * login flow, and refresh-token rotation.
 *
 * This file lives under `core/` and is deliberately plain TypeScript: no
 * ArkUI, no `@kit.*` / `@ohos.*` imports, no decorators.
 *
 * Field names match the JSON wire contract verbatim (snake_case) -- this
 * layer only decodes server responses, it does not remap field casing.
 * See the implementation brief section 4.3 ("Device authorisation"),
 * section 4.5 ("Token refresh") and section 4.6 ("Login").
 */

/** `POST /api/v1/oauth/device/code` response body. Unauthenticated. */
export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

/**
 * `POST /api/v1/oauth/token` success (200) response body for the device
 * flow. Does NOT carry `user_id` or `peer_addresses` -- those only appear
 * on `LoginResponse` / `RefreshResponse`.
 */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
}

/**
 * `POST /api/v1/oauth/token` failure body. Always HTTP 400. Exactly ONE
 * field -- no `message` -- unlike every other error envelope in this API.
 * Known `error` codes: "authorization_pending", "slow_down",
 * "expired_token", "access_denied", "unsupported_grant_type".
 */
export interface OAuthError {
  error: string;
}

/** `POST /api/v1/auth/login` request body. Unauthenticated. */
export interface LoginRequest {
  username: string | null;
  password: string | null;
  profile_user_id: string | null;
  pin: string | null;
  device_id: string;
  device_name: string;
  client_platform: string;
  client_version: string;
}

/** `POST /api/v1/auth/login` success (200) response body. */
export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user_id: string;
  peer_addresses: PeerAddressBundle | null;
}

/**
 * `POST /api/v1/auth/refresh` request body. Unauthenticated -- the refresh
 * token itself is the credential. `device_id` is REQUIRED: the store is
 * keyed by device, not by token value.
 */
export interface RefreshRequest {
  device_id: string;
  refresh_token: string;
}

/**
 * `POST /api/v1/auth/refresh` success (200) response body. `refresh_token`
 * is ROTATED -- callers must discard the old value and persist this one.
 */
export interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user_id: string;
  peer_addresses: PeerAddressBundle | null;
}

/**
 * Unverified claims decoded from an access token's JWT payload segment
 * (see `Jwt.ts`). `iss` is `"playarr"` for a standalone node, or the
 * issuing peer's `peer_id` once grouped. `impersonated_by` is present only
 * for an admin-impersonated session. See brief section 4.4.
 */
export interface AccessTokenClaims {
  sub: string;
  device_id: string;
  session_id: string;
  iss: string;
  iat: number;
  exp: number;
  impersonated_by?: string;
}

/**
 * One reachable address for a peer node in a Playarr Server group. Refresh
 * tokens are node-scoped: a `PeerAddress` is only a valid failover target
 * for a token whose issuing `peer_node_id` matches this one's.
 */
export interface PeerAddress {
  peer_node_id: string;
  url: string;
}

/**
 * Priority-ordered failover address book returned alongside login/refresh
 * responses. `group_id` and `group_name` are `null` for a standalone node.
 */
export interface PeerAddressBundle {
  group_id: string | null;
  group_name: string | null;
  addresses: PeerAddress[];
}
