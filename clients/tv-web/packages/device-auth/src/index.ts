/**
 * @playarr-tv/device-auth
 *
 * OAuth 2.0 Device Authorization Grant client (RFC 8628 --
 * https://datatracker.ietf.org/doc/html/rfc8628). This is how the TV apps
 * (webOS, Tizen, VIDAA fallback) authenticate: the TV displays a short
 * user code, the viewer approves it on a second device (phone/laptop).
 *
 * Wired against the real Playarr Server endpoints (`POST /api/v1/oauth/device/code`,
 * `POST /api/v1/oauth/token`) via `@playarr-tv/api-client`'s `ApiClient` --
 * both are plain JSON endpoints (not the form-urlencoded body RFC 8628's
 * examples use), and the device-code request carries a `client_platform`
 * enum rather than a generic OAuth `client_id`/`scope` pair, so callers pass
 * an already-configured `ApiClient` in rather than a bespoke endpoint config.
 *
 * Also exports the session/token-acquisition path (`./session`, `./tokenStore`,
 * `./deviceId`) clients with no pairing UI of their own (Web) use instead --
 * see `ensureAccessToken`'s doc comment. `./serverAddressBundle` is the other
 * half of the approver-UI side of the flow (`docs/architecture/peer-groups.md`
 * §6.3): decoding the `servers=` bundle a device-pairing link carries, and
 * fanning the approval call out to it in parallel.
 */
import { ApiError, DEVICE_CODE_GRANT_TYPE } from "@playarr-tv/api-client";
import type { ApiClient, ClientPlatform, OAuthErrorBody } from "@playarr-tv/api-client";
import QRCode from "qrcode";

export { DEVICE_CODE_GRANT_TYPE };
export type { ClientPlatform };

export { getOrCreateDeviceId } from "./deviceId";
export { TokenStore, type StoredSession } from "./tokenStore";
export {
  ensureAccessToken,
  toStoredSession,
  type EnsureAccessTokenIdentity,
  type EnsureAccessTokenOptions,
  type KnownServerGroupLike,
} from "./session";
export { decodeAccessTokenDeviceId, decodeAccessTokenIssuer, decodeAccessTokenUserId } from "./jwt";
export {
  authorizeDeviceAcrossServers,
  decodeServersParam,
  parseServersParam,
  type AuthorizeDeviceAcrossServersOptions,
} from "./serverAddressBundle";

/**
 * Visual tokens for Playarr device-login QR tiles.
 * Matches `.device-login-qr` in tv-web `global.css` (border-box 240, 12px
 * white edge, 18px radius, black modules on white). Every surface that
 * draws a pairing QR — SVG in the browser, PNG from `/api/link/qr`, native
 * clients — should use these values so the tile looks identical.
 */
export const PLAYARR_QR_STYLE = {
  /** Outer tile size (CSS border-box width/height of `.device-login-qr`). */
  tileSize: 240,
  /** White border width around the modules (CSS `border: 12px solid #fff`). */
  borderPx: 12,
  /** Corner radius of the white plate (CSS `border-radius: 18px`). */
  radiusPx: 18,
  /** Quiet-zone modules around the QR matrix (`qrcode` margin option). */
  marginModules: 2,
  errorCorrectionLevel: "M" as const,
  dark: "#000000",
  light: "#ffffff",
} as const;

/** Generates an offline SVG QR code without sending the pairing URL to a third party. */
export function createQrCodeSvg(
  value: string,
  width = PLAYARR_QR_STYLE.tileSize
): Promise<string> {
  return QRCode.toString(value, {
    type: "svg",
    errorCorrectionLevel: PLAYARR_QR_STYLE.errorCorrectionLevel,
    margin: PLAYARR_QR_STYLE.marginModules,
    width,
    color: {
      dark: PLAYARR_QR_STYLE.dark,
      light: PLAYARR_QR_STYLE.light,
    },
  });
}

/** RFC 8628 §3.2 device authorization response, normalized to camelCase for callers. */
export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}

export interface DeviceTokenSuccess {
  status: "success";
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresInSeconds: number;
}

/** RFC 8628 §3.5 polling error codes, modeled as a discriminated union instead of thrown exceptions. */
export interface DeviceTokenPending {
  status: "authorization_pending";
}
export interface DeviceTokenSlowDown {
  status: "slow_down";
}
export interface DeviceTokenExpired {
  status: "expired_token";
}
export interface DeviceTokenDenied {
  status: "access_denied";
}
export interface DeviceTokenError {
  status: "error";
  error: string;
}

export type DeviceTokenResult =
  | DeviceTokenSuccess
  | DeviceTokenPending
  | DeviceTokenSlowDown
  | DeviceTokenExpired
  | DeviceTokenDenied
  | DeviceTokenError;

function isOAuthErrorBody(body: unknown): body is OAuthErrorBody {
  return (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "string"
  );
}

/** RFC 8628 §3.1: request a device code + user code pair to start the flow. */
export async function requestDeviceCode(
  client: ApiClient,
  clientPlatform: ClientPlatform
): Promise<DeviceCodeResponse> {
  const raw = await client.requestDeviceCode({ client_platform: clientPlatform });
  return {
    deviceCode: raw.device_code,
    userCode: raw.user_code,
    verificationUri: raw.verification_uri,
    verificationUriComplete: raw.verification_uri_complete,
    expiresInSeconds: raw.expires_in,
    intervalSeconds: raw.interval,
  };
}

/**
 * RFC 8628 §3.4: a single poll attempt against the token endpoint. Does not
 * loop -- see `pollForToken`. Maps every one of the spec's §3.5 error codes
 * (`authorization_pending` | `slow_down` | `expired_token` | `access_denied`)
 * plus RFC 6749 §5.2's `unsupported_grant_type` (surfaced as `"error"`) to a
 * result variant instead of throwing, so callers don't need a try/catch to
 * drive the polling loop.
 */
export async function pollDeviceToken(
  client: ApiClient,
  deviceCode: string,
  signal?: AbortSignal
): Promise<DeviceTokenResult> {
  try {
    const raw = await client.requestDeviceToken(
      {
        grant_type: DEVICE_CODE_GRANT_TYPE,
        device_code: deviceCode,
      },
      { signal }
    );
    return {
      status: "success",
      accessToken: raw.access_token,
      refreshToken: raw.refresh_token,
      tokenType: raw.token_type,
      expiresInSeconds: raw.expires_in,
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 400 && isOAuthErrorBody(err.body)) {
      switch (err.body.error) {
        case "authorization_pending":
          return { status: "authorization_pending" };
        case "slow_down":
          return { status: "slow_down" };
        case "expired_token":
          return { status: "expired_token" };
        case "access_denied":
          return { status: "access_denied" };
        default:
          return { status: "error", error: err.body.error };
      }
    }
    throw err;
  }
}

export interface PollForTokenOptions {
  signal?: AbortSignal;
  /** Called on every `authorization_pending` tick, useful for driving a countdown UI. */
  onPending?: (elapsedSeconds: number) => void;
}

/**
 * RFC 8628 §3.5: repeatedly poll the token endpoint at `intervalSeconds`
 * (backing off by 5s on `slow_down`, per spec) until the flow succeeds,
 * is denied, or the device code expires.
 */
export async function pollForToken(
  client: ApiClient,
  deviceCodeResponse: DeviceCodeResponse,
  options: PollForTokenOptions = {}
): Promise<DeviceTokenSuccess> {
  let intervalSeconds = deviceCodeResponse.intervalSeconds;
  const deadline = Date.now() + deviceCodeResponse.expiresInSeconds * 1000;
  const startedAt = Date.now();

  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      throw new DOMException("Device token polling aborted", "AbortError");
    }

    await sleep(intervalSeconds * 1000, options.signal);
    if (Date.now() >= deadline) break;

    const result = await pollDeviceToken(
      client,
      deviceCodeResponse.deviceCode,
      options.signal
    );

    switch (result.status) {
      case "success":
        return result;
      case "authorization_pending":
        options.onPending?.(Math.round((Date.now() - startedAt) / 1000));
        continue;
      case "slow_down":
        intervalSeconds += 5;
        continue;
      case "expired_token":
        throw new Error("Device code expired before the user approved the request.");
      case "access_denied":
        throw new Error("The user denied the device authorization request.");
      case "error":
        throw new Error(`Device token request failed: ${result.error}`);
    }
  }

  throw new Error("Device code expired before the user approved the request.");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new DOMException("Device token polling aborted", "AbortError"));
      },
      { once: true }
    );
  });
}
