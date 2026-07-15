/**
 * @streamarr-tv/device-auth
 *
 * OAuth 2.0 Device Authorization Grant client (RFC 8628 --
 * https://datatracker.ietf.org/doc/html/rfc8628). This is how the TV apps
 * (webOS, Tizen, VIDAA fallback) authenticate: the TV displays a short
 * user code, the viewer approves it on a second device (phone/laptop) --
 * the Web app's approver UI reuses `requestDeviceCode`/`pollDeviceToken`
 * against the same endpoints for that side of the flow.
 */

export interface DeviceAuthorizationConfig {
  /** RFC 8628 §3.1 device authorization endpoint. */
  deviceAuthorizationEndpoint: string;
  /** RFC 8628 §3.4 / RFC 6749 §3.2 token endpoint. */
  tokenEndpoint: string;
  clientId: string;
  scope?: string;
  fetchImpl?: typeof fetch;
}

/** RFC 8628 §3.2 device authorization response. */
export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** RFC 8628 §3.3.1: verification URI with the user code pre-filled, if the server supports it. */
  verificationUriComplete?: string;
  expiresInSeconds: number;
  /** Minimum seconds the client must wait between polling requests. Defaults to 5 if the server omits it. */
  intervalSeconds: number;
}

export interface DeviceTokenSuccess {
  status: "success";
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresInSeconds: number;
  scope?: string;
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
  description?: string;
}

export type DeviceTokenResult =
  | DeviceTokenSuccess
  | DeviceTokenPending
  | DeviceTokenSlowDown
  | DeviceTokenExpired
  | DeviceTokenDenied
  | DeviceTokenError;

interface RawDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** RFC 8628 §3.1: request a device code + user code pair to start the flow. */
export async function requestDeviceCode(
  config: DeviceAuthorizationConfig
): Promise<DeviceCodeResponse> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const body = new URLSearchParams({ client_id: config.clientId });
  if (config.scope) body.set("scope", config.scope);

  const response = await fetchImpl(config.deviceAuthorizationEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(
      `Device authorization request failed: ${response.status} ${response.statusText}`
    );
  }

  const raw = (await response.json()) as RawDeviceCodeResponse;
  return {
    deviceCode: raw.device_code,
    userCode: raw.user_code,
    verificationUri: raw.verification_uri,
    verificationUriComplete: raw.verification_uri_complete,
    expiresInSeconds: raw.expires_in,
    intervalSeconds: raw.interval ?? 5,
  };
}

/** RFC 8628 §3.4: a single poll attempt against the token endpoint. Does not loop -- see `pollForToken`. */
export async function pollDeviceToken(
  config: DeviceAuthorizationConfig,
  deviceCode: string
): Promise<DeviceTokenResult> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code: deviceCode,
    client_id: config.clientId,
  });

  const response = await fetchImpl(config.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  const raw = (await response.json().catch(() => ({}))) as RawTokenResponse;

  if (response.ok && raw.access_token) {
    return {
      status: "success",
      accessToken: raw.access_token,
      refreshToken: raw.refresh_token,
      tokenType: raw.token_type ?? "Bearer",
      expiresInSeconds: raw.expires_in ?? 0,
      scope: raw.scope,
    };
  }

  switch (raw.error) {
    case "authorization_pending":
      return { status: "authorization_pending" };
    case "slow_down":
      return { status: "slow_down" };
    case "expired_token":
      return { status: "expired_token" };
    case "access_denied":
      return { status: "access_denied" };
    default:
      return {
        status: "error",
        error: raw.error ?? "unknown_error",
        description: raw.error_description,
      };
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
  config: DeviceAuthorizationConfig,
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

    const result = await pollDeviceToken(config, deviceCodeResponse.deviceCode);

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
        throw new Error(result.description ?? result.error);
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
