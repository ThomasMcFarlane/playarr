import type { ApiClient } from "@playarr-tv/api-client";
import {
  parseServersParam,
  requestDeviceCode,
  type DeviceCodeResponse,
  type ClientPlatform,
} from "@playarr-tv/device-auth";

const HOSTED_LINK_ORIGIN = "https://playarr.app";
export const HOSTED_LINK_CLAIM_REDEMPTION_GRACE_MS = 30 * 1000;

interface HostedLinkSession {
  client_platform: ClientPlatform;
  expires_at: number;
  linked: boolean;
}

export interface HostedLinkClaim {
  user_code: string;
  server_url: string;
  server_device_code: string;
  server_urls: string[];
}

interface HostedLinkCodeWire {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface HostedLinkCode extends DeviceCodeResponse {
  expiresAt: number;
}

export interface HostedLinkRequestOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface HostedLinkPollOptions extends HostedLinkRequestOptions {
  signal?: AbortSignal;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export type HostedLinkClientPlatform = Extract<
  ClientPlatform,
  | "web"
  | "android-mobile"
  | "android-tv"
  | "tv-webos"
  | "tv-tizen"
  | "tv-vidaa"
  | "tv-fire"
  | "xbox"
>;

export function shouldUseHostedDeviceLink(
  isPackagedTv: boolean,
  configuredApiBaseUrl?: string,
  clientPlatform?: ClientPlatform
): boolean {
  return (
    (isPackagedTv || clientPlatform === "tv-vidaa" || clientPlatform === "xbox") &&
    !configuredApiBaseUrl?.trim()
  );
}

function hostedLinkFetch(fetchImpl?: typeof fetch): typeof fetch {
  return fetchImpl ?? globalThis.fetch.bind(globalThis);
}

function waitForHostedLink(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

/** Starts brokered linking against playarr.app before this client knows a Playarr Server URL. */
export async function requestHostedDeviceLink(
  clientPlatform: HostedLinkClientPlatform,
  options: HostedLinkRequestOptions = {}
): Promise<HostedLinkCode> {
  const response = await hostedLinkFetch(options.fetchImpl)(`${HOSTED_LINK_ORIGIN}/api/link/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_platform: clientPlatform }),
  });
  if (!response.ok) {
    throw new Error(`Playarr linking is unavailable (HTTP ${response.status}).`);
  }
  const wire = (await response.json()) as HostedLinkCodeWire;
  const now = options.now?.() ?? Date.now();
  return {
    deviceCode: wire.device_code,
    userCode: wire.user_code,
    verificationUri: wire.verification_uri,
    verificationUriComplete: wire.verification_uri_complete,
    expiresInSeconds: wire.expires_in,
    intervalSeconds: wire.interval,
    expiresAt: now + wire.expires_in * 1000,
  };
}

/** Waits for the phone-side Playarr profile choice and returns its server-scoped device claim. */
export async function pollHostedDeviceLink(
  code: HostedLinkCode,
  options: HostedLinkPollOptions = {}
): Promise<HostedLinkClaim> {
  const fetchImpl = hostedLinkFetch(options.fetchImpl);
  const now = options.now ?? Date.now;
  const wait = options.wait ?? waitForHostedLink;
  let skipWait = false;
  let postExpiryRequestMade = false;
  while (now() < code.expiresAt || !postExpiryRequestMade) {
    if (!skipWait) {
      await wait(code.intervalSeconds * 1000, options.signal);
    }
    skipWait = false;
    if (now() >= code.expiresAt) {
      postExpiryRequestMade = true;
    }
    const response = await fetchImpl(
      `${HOSTED_LINK_ORIGIN}/api/link/code/${encodeURIComponent(code.deviceCode)}`,
      { headers: { Accept: "application/json" }, signal: options.signal }
    );
    if (response.status === 202) {
      // A request may have started just before expiry and returned pending
      // just after approval was written. Make exactly one immediate request
      // that starts inside the Worker's claimed-session redemption grace.
      if (now() >= code.expiresAt && !postExpiryRequestMade) {
        skipWait = true;
      }
      continue;
    }
    if (response.status === 404) throw new Error("That Playarr link code expired. Try again.");
    if (!response.ok) {
      throw new Error(`Playarr linking is unavailable (HTTP ${response.status}).`);
    }
    const claim = (await response.json()) as HostedLinkClaim;
    if (
      typeof claim.server_url !== "string" ||
      typeof claim.server_device_code !== "string" ||
      !Array.isArray(claim.server_urls)
    ) {
      throw new Error("Playarr returned an invalid TV link response.");
    }
    return claim;
  }
  throw new Error("That Playarr link code expired. Try again.");
}

export async function inspectHostedLink(userCode: string): Promise<HostedLinkSession | null> {
  const response = await fetch(`/api/link/session?user_code=${encodeURIComponent(userCode)}`, {
    headers: { Accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Playarr linking is unavailable (HTTP ${response.status}).`);
  return response.json() as Promise<HostedLinkSession>;
}

export async function authoriseHostedLink(options: {
  userCode: string;
  session: HostedLinkSession;
  serverUrl: string;
  client: ApiClient;
}): Promise<void> {
  const serverCode = await requestDeviceCode(options.client, options.session.client_platform);
  await options.client.authorizeDevice({ user_code: serverCode.userCode });
  const bundledServers = parseServersParam(new URL(serverCode.verificationUriComplete).search);
  const claim: HostedLinkClaim = {
    user_code: options.userCode,
    server_url: options.serverUrl,
    server_device_code: serverCode.deviceCode,
    server_urls: bundledServers?.length ? bundledServers : [options.serverUrl],
  };
  const response = await fetch("/api/link/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(claim),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "That Playarr link code has expired. Generate a new code on the TV."
        : `Couldn’t complete Playarr linking (HTTP ${response.status}).`
    );
  }
}
