import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYARR_CAST_NAMESPACE, type PlayarrCastMessage } from "@streamarr-tv/cast-protocol";
import {
  sendPlayarrCastMessage,
  subscribeToPlayarrCastMessages,
  waitForFirstPlayarrCastMessage,
} from "./castMessages";

type Listener = (namespace: string, message: string) => void;

function fakeSession() {
  const listeners = new Set<Listener>();
  return {
    sendMessage: vi.fn(async (_namespace: string, _data: unknown): Promise<chrome.cast.ErrorCode | undefined> => undefined),
    addMessageListener: vi.fn((_namespace: string, listener: Listener) => {
      listeners.add(listener);
    }),
    removeMessageListener: vi.fn((_namespace: string, listener: Listener) => {
      listeners.delete(listener);
    }),
    emit(namespace: string, message: string) {
      for (const listener of listeners) listener(namespace, message);
    },
    listenerCount: () => listeners.size,
  };
}

const READY_MESSAGE: PlayarrCastMessage = {
  protocolVersion: 1,
  type: "ready",
  receiverVersion: "1.0.0",
  supportedProtocolVersion: 1,
  deviceCapabilities: {
    supportsH264: true,
    supportsHevc: false,
    supportsVp9: false,
    supportsAv1: false,
    supports4k: false,
    supportsHdr: false,
  },
};

describe("subscribeToPlayarrCastMessages", () => {
  it("subscribes on the Playarr namespace and delivers a parsed message from a JSON string", () => {
    const session = fakeSession();
    const onMessage = vi.fn();

    subscribeToPlayarrCastMessages(session, onMessage);

    expect(session.addMessageListener).toHaveBeenCalledWith(
      PLAYARR_CAST_NAMESPACE,
      expect.any(Function)
    );

    session.emit(PLAYARR_CAST_NAMESPACE, JSON.stringify(READY_MESSAGE));

    expect(onMessage).toHaveBeenCalledWith(READY_MESSAGE);
  });

  it("silently drops anything that fails to parse as a real Playarr Cast message", () => {
    const session = fakeSession();
    const onMessage = vi.fn();
    subscribeToPlayarrCastMessages(session, onMessage);

    session.emit(PLAYARR_CAST_NAMESPACE, "not json at all");
    session.emit(PLAYARR_CAST_NAMESPACE, JSON.stringify({ type: "not.a.real.type" }));

    expect(onMessage).not.toHaveBeenCalled();
  });

  it("returns an unsubscribe function that removes the same listener instance", () => {
    const session = fakeSession();
    const unsubscribe = subscribeToPlayarrCastMessages(session, vi.fn());

    expect(session.listenerCount()).toBe(1);
    unsubscribe();
    expect(session.listenerCount()).toBe(0);
    expect(session.removeMessageListener).toHaveBeenCalledWith(
      PLAYARR_CAST_NAMESPACE,
      expect.any(Function)
    );
  });
});

describe("sendPlayarrCastMessage", () => {
  it("sends the message as a plain object (not pre-stringified) on the Playarr namespace", async () => {
    const session = fakeSession();
    const message: PlayarrCastMessage = { protocolVersion: 1, type: "state.request" };

    await sendPlayarrCastMessage(session, message);

    expect(session.sendMessage).toHaveBeenCalledWith(PLAYARR_CAST_NAMESPACE, message);
  });

  it("throws when the SDK reports a send failure via a resolved ErrorCode", async () => {
    const session = fakeSession();
    session.sendMessage.mockResolvedValueOnce("channel_error" as chrome.cast.ErrorCode);

    await expect(
      sendPlayarrCastMessage(session, { protocolVersion: 1, type: "state.request" })
    ).rejects.toThrow(/channel_error/);
  });

  it("throws a RangeError for an oversized message and never calls sendMessage at all", async () => {
    const session = fakeSession();
    const oversized: PlayarrCastMessage = {
      protocolVersion: 1,
      type: "queue.set",
      items: Array.from({ length: 5000 }, (_, index) => ({
        mediaFileId: `media-${index}`,
        kind: "movie" as const,
        title: "x".repeat(50),
      })),
    };

    await expect(sendPlayarrCastMessage(session, oversized)).rejects.toThrow(RangeError);
    expect(session.sendMessage).not.toHaveBeenCalled();
  });
});

describe("waitForFirstPlayarrCastMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the first message matching the predicate and unsubscribes", async () => {
    const session = fakeSession();
    const promise = waitForFirstPlayarrCastMessage(session, (message) => message.type === "ready");

    session.emit(PLAYARR_CAST_NAMESPACE, JSON.stringify({ protocolVersion: 1, type: "state.request" }));
    session.emit(PLAYARR_CAST_NAMESPACE, JSON.stringify(READY_MESSAGE));

    await expect(promise).resolves.toEqual(READY_MESSAGE);
    expect(session.listenerCount()).toBe(0);
  });

  it("resolves to undefined once the timeout elapses with nothing matching", async () => {
    const session = fakeSession();
    const promise = waitForFirstPlayarrCastMessage(session, () => false, { timeoutMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBeUndefined();
    expect(session.listenerCount()).toBe(0);
  });
});
