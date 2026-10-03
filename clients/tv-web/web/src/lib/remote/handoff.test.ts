import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@playarr-tv/api-client";
import type { RemoteHandoff, RemotePairing } from "@playarr-tv/api-client";
import { HandoffFailure, handOffPlayback, type HandoffClient } from "./handoff";

function handoff(status: string, extra: Partial<RemoteHandoff> = {}): RemoteHandoff {
  return {
    id: "h1",
    status,
    source_device_id: "s",
    destination_device_id: "d",
    media_file_id: "m",
    work_id: "w",
    snapshot: { position_ms: 5000, paused: false },
    created_ms: 0,
    expires_ms: 0,
    ...extra,
  } as RemoteHandoff;
}

function pairing(status: string): RemotePairing {
  return { id: "p1", status, verification_code: "123456" } as RemotePairing;
}

function apiError(code: string, status = 403) {
  return new ApiError(status, "x", { error: code, message: code });
}

const baseParams = {
  sourceDeviceId: "s",
  destinationDeviceId: "d",
  mediaFileId: "m",
  snapshot: { position_ms: 5000, paused: false },
  controllerName: "Player",
  newKey: () => "key-1",
  sleep: async () => undefined,
};

describe("handOffPlayback", () => {
  it("returns once the destination commits, sending one idempotency key", async () => {
    const client: HandoffClient = {
      createRemoteHandoff: vi.fn(async () => handoff("pending")),
      getRemoteHandoff: vi
        .fn()
        .mockResolvedValueOnce(handoff("pending"))
        .mockResolvedValueOnce(handoff("committed", { acked_position_ms: 5200 })),
      requestRemotePairing: vi.fn(),
      getRemotePairing: vi.fn(),
    };
    const result = await handOffPlayback(client, baseParams);
    expect(result.status).toBe("committed");
    expect(client.createRemoteHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ request_key: "key-1", source_device_id: "s", destination_device_id: "d" })
    );
    expect(client.requestRemotePairing).not.toHaveBeenCalled();
  });

  it("pairs with the handoff scope when no pairing exists, then retries", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(apiError("pairing_required"))
      .mockResolvedValueOnce(handoff("committed"));
    const client: HandoffClient = {
      createRemoteHandoff: create,
      getRemoteHandoff: vi.fn(),
      requestRemotePairing: vi.fn(async () => pairing("pending")),
      getRemotePairing: vi
        .fn()
        .mockResolvedValueOnce(pairing("pending"))
        .mockResolvedValueOnce(pairing("active")),
    };
    const progress: string[] = [];
    await handOffPlayback(client, { ...baseParams, onProgress: (p) => progress.push(p.stage) });
    expect(client.requestRemotePairing).toHaveBeenCalledWith(
      expect.objectContaining({ targetDeviceId: "d", scopes: ["handoff"] })
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(progress).toContain("pairing");
  });

  it("fails clearly when the pairing is denied", async () => {
    const client: HandoffClient = {
      createRemoteHandoff: vi.fn().mockRejectedValue(apiError("pairing_required")),
      getRemoteHandoff: vi.fn(),
      requestRemotePairing: vi.fn(async () => pairing("pending")),
      getRemotePairing: vi.fn(async () => pairing("denied")),
    };
    await expect(handOffPlayback(client, baseParams)).rejects.toMatchObject({ reason: "denied" });
  });

  it("surfaces a destination failure so the source is left playing", async () => {
    const client: HandoffClient = {
      createRemoteHandoff: vi.fn(async () => handoff("pending")),
      getRemoteHandoff: vi.fn(async () => handoff("failed", { failure_reason: "codec unsupported" })),
      requestRemotePairing: vi.fn(),
      getRemotePairing: vi.fn(),
    };
    const error = await handOffPlayback(client, baseParams).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HandoffFailure);
    expect((error as HandoffFailure).message).toBe("codec unsupported");
  });

  it("gives up when the destination never answers", async () => {
    let now = 0;
    const client: HandoffClient = {
      createRemoteHandoff: vi.fn(async () => handoff("pending")),
      getRemoteHandoff: vi.fn(async () => handoff("pending")),
      requestRemotePairing: vi.fn(),
      getRemotePairing: vi.fn(),
    };
    await expect(
      handOffPlayback(client, {
        ...baseParams,
        now: () => now,
        sleep: async () => {
          now += 40_000;
        },
      })
    ).rejects.toMatchObject({ reason: "expired" });
  });

  it("does not pair on unrelated rejections", async () => {
    const client: HandoffClient = {
      createRemoteHandoff: vi.fn().mockRejectedValue(apiError("target_offline", 409)),
      getRemoteHandoff: vi.fn(),
      requestRemotePairing: vi.fn(),
      getRemotePairing: vi.fn(),
    };
    await expect(handOffPlayback(client, baseParams)).rejects.toMatchObject({ reason: "rejected" });
    expect(client.requestRemotePairing).not.toHaveBeenCalled();
  });
});
