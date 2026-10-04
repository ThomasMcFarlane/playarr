/**
 * Source-side "Play on another device" flow: pair if needed, offer the
 * handoff, then wait for the destination's acknowledgement
 * (docs/architecture/remote-control.md). The source is only stopped by the
 * server's `handoff_stop` event after the destination acknowledges.
 */
import { ApiError } from "@playarr-tv/api-client";
import type {
  RemoteCreateHandoffRequest,
  RemoteHandoff,
  RemotePairing,
} from "@playarr-tv/api-client";

export interface HandoffClient {
  createRemoteHandoff(body: RemoteCreateHandoffRequest): Promise<RemoteHandoff>;
  getRemoteHandoff(id: string, waitSeconds?: number): Promise<RemoteHandoff>;
  requestRemotePairing(body: {
    targetDeviceId: string;
    scopes?: string[];
    controllerName?: string;
  }): Promise<RemotePairing>;
  getRemotePairing(id: string): Promise<RemotePairing>;
}

export type HandoffProgress =
  | { stage: "offering" }
  | { stage: "pairing"; verificationCode?: string | null }
  | { stage: "waiting" };

export interface HandoffParams {
  sourceDeviceId: string;
  destinationDeviceId: string;
  mediaFileId: string;
  snapshot: RemoteCreateHandoffRequest["snapshot"];
  controllerName: string;
  newKey?: () => string;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (progress: HandoffProgress) => void;
  pairingTimeoutMs?: number;
  handoffTimeoutMs?: number;
  now?: () => number;
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof ApiError && error.body && typeof error.body === "object") {
    const code = (error.body as { error?: unknown }).error;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

export class HandoffFailure extends Error {
  constructor(
    readonly reason: "denied" | "pairing_timeout" | "failed" | "expired" | "rejected",
    message: string
  ) {
    super(message);
    this.name = "HandoffFailure";
  }
}

export async function handOffPlayback(
  client: HandoffClient,
  params: HandoffParams
): Promise<RemoteHandoff> {
  const sleep = params.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = params.now ?? Date.now;
  const requestKey = (params.newKey ?? (() => crypto.randomUUID()))();
  const body: RemoteCreateHandoffRequest = {
    request_key: requestKey,
    source_device_id: params.sourceDeviceId,
    destination_device_id: params.destinationDeviceId,
    media_file_id: params.mediaFileId,
    snapshot: params.snapshot,
  };

  params.onProgress?.({ stage: "offering" });
  let handoff: RemoteHandoff;
  try {
    handoff = await client.createRemoteHandoff(body);
  } catch (error) {
    if (errorCode(error) !== "pairing_required") {
      throw new HandoffFailure("rejected", error instanceof Error ? error.message : "rejected");
    }
    let pairing: RemotePairing | null = null;
    try {
      pairing = await client.requestRemotePairing({
        targetDeviceId: params.destinationDeviceId,
        scopes: ["handoff"],
        controllerName: params.controllerName,
      });
    } catch (pairError) {
      if (errorCode(pairError) !== "already_paired") {
        throw new HandoffFailure("rejected", "could not request pairing");
      }
    }
    if (pairing) {
      params.onProgress?.({ stage: "pairing", verificationCode: pairing.verification_code });
      const deadline = now() + (params.pairingTimeoutMs ?? 5 * 60_000);
      while (pairing.status === "pending") {
        if (now() > deadline) throw new HandoffFailure("pairing_timeout", "pairing timed out");
        await sleep(2_000);
        pairing = await client.getRemotePairing(pairing.id);
      }
      if (pairing.status !== "active") {
        throw new HandoffFailure("denied", "pairing was not approved");
      }
    }
    params.onProgress?.({ stage: "offering" });
    try {
      handoff = await client.createRemoteHandoff(body);
    } catch (retryError) {
      throw new HandoffFailure("rejected", retryError instanceof Error ? retryError.message : "rejected");
    }
  }

  params.onProgress?.({ stage: "waiting" });
  const deadline = now() + (params.handoffTimeoutMs ?? 70_000);
  while (handoff.status === "pending") {
    if (now() > deadline) throw new HandoffFailure("expired", "destination did not respond");
    // The server holds the request open while the handoff is pending, so the
    // outcome arrives the moment the destination acknowledges. A server that
    // ignores `wait` answers at once; then fall back to a one second poll.
    const asked = now();
    handoff = await client.getRemoteHandoff(handoff.id, 20);
    if (handoff.status === "pending" && now() - asked < 500) await sleep(1_000);
  }
  if (handoff.status === "committed") return handoff;
  if (handoff.status === "expired") throw new HandoffFailure("expired", "destination did not respond");
  throw new HandoffFailure("failed", handoff.failure_reason ?? "destination could not play it");
}
