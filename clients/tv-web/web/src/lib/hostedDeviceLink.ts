import type { ApiClient } from "@streamarr-tv/api-client";
import {
  parseServersParam,
  requestDeviceCode,
  type ClientPlatform,
} from "@streamarr-tv/device-auth";

interface HostedLinkSession {
  client_platform: ClientPlatform;
  expires_at: number;
  linked: boolean;
}

interface HostedLinkClaim {
  user_code: string;
  server_url: string;
  server_device_code: string;
  server_urls: string[];
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
        ? "That Playarr link code has expired. Generate a new code on the Android app."
        : `Couldn’t complete Playarr linking (HTTP ${response.status}).`
    );
  }
}
