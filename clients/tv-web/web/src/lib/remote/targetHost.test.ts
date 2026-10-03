import { describe, expect, it, vi } from "vitest";
import type { RemoteInboxEvent } from "@playarr-tv/api-client";
import {
  parseHandoffOffer,
  RemoteTargetHost,
  type RemoteTargetClient,
  type TargetHandlers,
} from "./targetHost";

function event(kind: string, payload: unknown, id = "e1"): RemoteInboxEvent {
  return { id, seq: 1, kind, payload: payload as RemoteInboxEvent["payload"], created_ms: 0, expires_ms: 0 };
}

function setup(handlers: Partial<TargetHandlers> = {}) {
  const acks: Array<[string, string, string | undefined]> = [];
  const handoffAcks: Array<[string, unknown]> = [];
  const client: RemoteTargetClient = {
    registerRemoteTarget: vi.fn(async () => ({})),
    pollRemoteInbox: vi.fn(async () => ({ events: [], next: 0 })),
    ackRemoteEvent: vi.fn(async (id, status, detail) => {
      acks.push([id, status, detail]);
    }),
    ackRemoteHandoff: vi.fn(async (id, body) => {
      handoffAcks.push([id, body]);
    }),
    reportRemoteState: vi.fn(async () => undefined),
  };
  const full: TargetHandlers = {
    onPairingRequest: vi.fn(),
    onPairingRevoked: vi.fn(),
    execute: vi.fn(() => ({ status: "ok" as const })),
    onHandoffOffer: vi.fn(async () => ({ status: "playing" as const, positionMs: 1234.4 })),
    onHandoffStop: vi.fn(),
    currentState: () => ({ media_file_id: "m", position_ms: 1 }),
    ...handlers,
  };
  const host = new RemoteTargetHost(client, full, {
    name: "TV",
    platform: "web",
    capabilities: ["navigate"],
    sleep: async () => undefined,
  });
  return { host, client, handlers: full, acks, handoffAcks };
}

describe("RemoteTargetHost.handle", () => {
  it("surfaces pairing requests to the UI and acknowledges them", async () => {
    const { host, handlers, acks } = setup();
    await host.handle(
      event("pairing_request", {
        pairing_id: "p1",
        controller_name: "Phone",
        verification_code: "123456",
        scopes: ["navigate"],
      })
    );
    expect(handlers.onPairingRequest).toHaveBeenCalledWith({
      pairingId: "p1",
      controllerName: "Phone",
      verificationCode: "123456",
      scopes: ["navigate"],
    });
    expect(acks).toEqual([["e1", "ok", undefined]]);
  });

  it("executes commands and acknowledges the outcome without leaking arguments", async () => {
    const execute = vi.fn(() => ({ status: "failed" as const, detail: "no text field is focused" }));
    const { host, acks } = setup({ execute });
    await host.handle(event("command", { kind: "text", args: { value: "hunter2" } }));
    expect(execute).toHaveBeenCalledWith("text", { value: "hunter2" });
    expect(acks).toEqual([["e1", "failed", "no text field is focused"]]);
    expect(JSON.stringify(acks)).not.toContain("hunter2");
  });

  it("acknowledges a throwing handler as failed instead of dropping the event", async () => {
    const { host, acks } = setup({
      execute: () => {
        throw new Error("boom");
      },
    });
    await host.handle(event("command", { kind: "navigate", args: { key: "up" } }));
    expect(acks[0]?.[1]).toBe("failed");
  });

  it("acknowledges the destination handoff with the position it actually started at", async () => {
    const { host, handoffAcks, handlers } = setup();
    await host.handle(
      event("handoff_offer", {
        handoff_id: "h1",
        media_file_id: "m1",
        snapshot: { position_ms: 1000, paused: false },
      })
    );
    await vi.waitFor(() => expect(handoffAcks.length).toBe(1));
    expect(handlers.onHandoffOffer).toHaveBeenCalledWith(
      expect.objectContaining({ handoffId: "h1", mediaFileId: "m1", positionMs: 1000 })
    );
    expect(handoffAcks[0]).toEqual(["h1", { status: "playing", position_ms: 1234 }]);
  });

  it("reports a failed destination so the source keeps playing", async () => {
    const { host, handoffAcks } = setup({
      onHandoffOffer: async () => ({ status: "failed", reason: "playback did not start in time" }),
    });
    await host.handle(event("handoff_offer", { handoff_id: "h2", media_file_id: "m1" }));
    await vi.waitFor(() => expect(handoffAcks.length).toBe(1));
    expect(handoffAcks[0]).toEqual(["h2", { status: "failed", reason: "playback did not start in time" }]);
  });

  it("stops local playback only on handoff_stop", async () => {
    const { host, handlers } = setup();
    await host.handle(event("handoff_stop", { handoff_id: "h1" }));
    expect(handlers.onHandoffStop).toHaveBeenCalledWith("h1");
  });

  it("rejects malformed offers and unknown events", async () => {
    const { host, acks } = setup();
    await host.handle(event("handoff_offer", {}, "bad"));
    await host.handle(event("mystery", {}, "odd"));
    expect(acks).toEqual([
      ["bad", "failed", "malformed offer"],
      ["odd", "unsupported", "unknown event"],
    ]);
  });
});

describe("RemoteTargetHost loop", () => {
  it("registers, polls from the last cursor and stops cleanly", async () => {
    const { host, client, handlers } = setup();
    let polls = 0;
    (client.pollRemoteInbox as ReturnType<typeof vi.fn>).mockImplementation(
      async (after: number) => {
        polls += 1;
        if (polls === 1) {
          return { events: [event("handoff_stop", { handoff_id: "h" }, "a")], next: 7 };
        }
        if (polls === 2) {
          expect(after).toBe(7);
          host.stop();
        }
        return { events: [], next: after };
      }
    );
    host.start();
    await vi.waitFor(() => expect(polls).toBeGreaterThanOrEqual(2));
    expect(client.registerRemoteTarget).toHaveBeenCalledTimes(1);
    expect(handlers.onHandoffStop).toHaveBeenCalledTimes(1);
    host.stop();
  });

  it("re-registers when the server forgets the target (404) and backs off on errors", async () => {
    const { host, client } = setup();
    let polls = 0;
    (client.pollRemoteInbox as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      polls += 1;
      if (polls === 1) throw Object.assign(new Error("gone"), { status: 404 });
      if (polls === 2) {
        host.stop();
      }
      return { events: [], next: 0 };
    });
    host.start();
    await vi.waitFor(() => expect(polls).toBeGreaterThanOrEqual(2));
    expect(client.registerRemoteTarget).toHaveBeenCalledTimes(2);
  });

  it("reports state, skipping unchanged repeats", async () => {
    const { host, client } = setup();
    host.start();
    await host.reportState();
    await host.reportState();
    expect(client.reportRemoteState).toHaveBeenCalledTimes(1);
    host.stop();
  });
});

describe("parseHandoffOffer", () => {
  it("reads the snapshot and tolerates missing optional fields", () => {
    expect(
      parseHandoffOffer({
        handoff_id: "h",
        media_file_id: "m",
        work_id: "w",
        expires_ms: 5,
        snapshot: { position_ms: 9, paused: true, audio_language: "en" },
      })
    ).toEqual({
      handoffId: "h",
      mediaFileId: "m",
      workId: "w",
      positionMs: 9,
      paused: true,
      audioLanguage: "en",
      subtitleLanguage: undefined,
      expiresMs: 5,
    });
    expect(parseHandoffOffer({ handoff_id: "h" })).toBeNull();
  });
});
