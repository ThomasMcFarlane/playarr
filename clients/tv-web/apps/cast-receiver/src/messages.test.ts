import { describe, expect, it, vi } from "vitest";
import {
  PLAYARR_CAST_PROTOCOL_VERSION,
  type PlayarrCastReadyMessage,
  type PlayarrCastReceiverMessage,
  type PlayarrCastStateMessage,
} from "@playarr-tv/cast-protocol";
import { CastMessageBus, type CastMessageChannel, type CastMessageHandlers } from "./messages";

function makeFakeChannel(): {
  channel: CastMessageChannel;
  emit: (senderId: string, raw: unknown) => void;
  sent: Array<{ senderId: string | undefined; message: PlayarrCastReceiverMessage }>;
} {
  let listener: ((senderId: string, raw: unknown) => void) | null = null;
  const sent: Array<{ senderId: string | undefined; message: PlayarrCastReceiverMessage }> = [];
  return {
    channel: {
      addListener(handler) {
        listener = handler;
      },
      send(senderId, message) {
        sent.push({ senderId, message });
      },
    },
    emit(senderId, raw) {
      listener?.(senderId, raw);
    },
    sent,
  };
}

function makeFakeTimer() {
  let nextHandle = 1;
  const scheduled = new Map<number, { handler: () => void; delayMs: number }>();
  let currentTime = 0;
  return {
    now: () => currentTime,
    advanceTo(time: number): void {
      currentTime = time;
    },
    setTimeoutFn: vi.fn((handler: () => void, delayMs: number) => {
      const handle = nextHandle++;
      scheduled.set(handle, { handler, delayMs });
      return handle as unknown as ReturnType<typeof setTimeout>;
    }),
    clearTimeoutFn: vi.fn((handle: ReturnType<typeof setTimeout>) => {
      scheduled.delete(handle as unknown as number);
    }),
    fireLatest(): void {
      const lastHandle = Math.max(...scheduled.keys());
      const entry = scheduled.get(lastHandle);
      scheduled.delete(lastHandle);
      entry?.handler();
    },
    pendingDelays(): number[] {
      return [...scheduled.values()].map((entry) => entry.delayMs);
    },
  };
}

function makeStateMessage(overrides: Partial<PlayarrCastStateMessage> = {}): PlayarrCastStateMessage {
  return {
    protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
    type: "state",
    mediaFileId: "file-1",
    sessionId: "session-1",
    negotiating: false,
    mode: "direct",
    sourceOffsetMs: 0,
    positionMs: 0,
    durationMs: 60_000,
    audioTracks: [],
    subtitleTracks: [],
    qualityOptions: [],
    selectedAudioTrackId: null,
    selectedSubtitleTrackId: null,
    selectedQualityId: "original",
    queue: [],
    ...overrides,
  };
}

describe("CastMessageBus dispatch", () => {
  it("routes each recognized sender message type to its handler with the sender id", () => {
    const { channel, emit } = makeFakeChannel();
    const bus = new CastMessageBus(channel);
    const handlers: Required<CastMessageHandlers> = {
      onAuthUpdate: vi.fn(),
      onSelectTracks: vi.fn(),
      onSelectQuality: vi.fn(),
      onSetQueue: vi.fn(),
      onPlayNext: vi.fn(),
      onStateRequest: vi.fn(),
      onEndSession: vi.fn(),
      onUnrecognized: vi.fn(),
    };
    bus.setHandlers(handlers);

    const authUpdate = {
      protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
      type: "auth.update",
      credentials: {
        deviceId: "d1",
        accessToken: "a1",
        accessTokenExpiresAt: 1,
        refreshToken: "r1",
      },
    };
    emit("sender-1", authUpdate);
    expect(handlers.onAuthUpdate).toHaveBeenCalledWith(authUpdate, "sender-1");

    const selectTracks = {
      protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
      type: "tracks.select",
      audioTrackId: "audio-1",
    };
    emit("sender-1", selectTracks);
    expect(handlers.onSelectTracks).toHaveBeenCalledWith(selectTracks, "sender-1");

    const selectQuality = {
      protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
      type: "quality.select",
      qualityId: "h264-720p-4mbps",
    };
    emit("sender-1", selectQuality);
    expect(handlers.onSelectQuality).toHaveBeenCalledWith(selectQuality, "sender-1");

    const setQueue = {
      protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
      type: "queue.set",
      items: [],
    };
    emit("sender-1", setQueue);
    expect(handlers.onSetQueue).toHaveBeenCalledWith(setQueue, "sender-1");

    const playNext = { protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION, type: "queue.playNext" };
    emit("sender-1", playNext);
    expect(handlers.onPlayNext).toHaveBeenCalledWith(playNext, "sender-1");

    const stateRequest = { protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION, type: "state.request" };
    emit("sender-1", stateRequest);
    expect(handlers.onStateRequest).toHaveBeenCalledWith(stateRequest, "sender-1");

    const endSession = {
      protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
      type: "session.end",
      reason: "user_stopped",
    };
    emit("sender-1", endSession);
    expect(handlers.onEndSession).toHaveBeenCalledWith(endSession, "sender-1");

    expect(handlers.onUnrecognized).not.toHaveBeenCalled();
  });

  it("also accepts a JSON string payload (parsePlayarrCastMessage handles both shapes)", () => {
    const { channel, emit } = makeFakeChannel();
    const bus = new CastMessageBus(channel);
    const onStateRequest = vi.fn();
    bus.setHandlers({ onStateRequest });

    emit(
      "sender-1",
      JSON.stringify({ protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION, type: "state.request" })
    );

    expect(onStateRequest).toHaveBeenCalledTimes(1);
  });

  it("routes malformed/unparseable payloads to onUnrecognized", () => {
    const { channel, emit } = makeFakeChannel();
    const bus = new CastMessageBus(channel);
    const onUnrecognized = vi.fn();
    bus.setHandlers({ onUnrecognized });

    emit("sender-1", "{not json");
    emit("sender-1", { type: "state.request" }); // missing protocolVersion
    emit("sender-1", 42);

    expect(onUnrecognized).toHaveBeenCalledTimes(3);
  });

  it("routes a valid but receiver-only message type to onUnrecognized, not any sender handler", () => {
    const { channel, emit } = makeFakeChannel();
    const bus = new CastMessageBus(channel);
    const handlers: Required<Pick<CastMessageHandlers, "onStateRequest" | "onUnrecognized">> = {
      onStateRequest: vi.fn(),
      onUnrecognized: vi.fn(),
    };
    bus.setHandlers(handlers);

    const readyMessage: PlayarrCastReadyMessage = {
      protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
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
    emit("sender-1", readyMessage);

    expect(handlers.onStateRequest).not.toHaveBeenCalled();
    expect(handlers.onUnrecognized).toHaveBeenCalledWith(readyMessage, "sender-1");
  });

  it("does nothing (and does not throw) when no handler is registered for a message type", () => {
    const { channel, emit } = makeFakeChannel();
    const bus = new CastMessageBus(channel);
    expect(() => emit("sender-1", { protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION, type: "queue.playNext" })).not.toThrow();
  });
});

describe("CastMessageBus.broadcastState throttling", () => {
  it("sends immediately the first time (no prior broadcast to throttle against)", () => {
    const { channel, sent } = makeFakeChannel();
    const timer = makeFakeTimer();
    const bus = new CastMessageBus(channel, timer);

    const state = makeStateMessage();
    bus.broadcastState(state);

    expect(sent).toEqual([{ senderId: undefined, message: state }]);
    expect(timer.setTimeoutFn).not.toHaveBeenCalled();
  });

  it("coalesces rapid calls within the 1s window into a single trailing send of the latest state", () => {
    const { channel, sent } = makeFakeChannel();
    const timer = makeFakeTimer();
    const bus = new CastMessageBus(channel, timer);

    bus.broadcastState(makeStateMessage({ positionMs: 1_000 }));
    expect(sent).toHaveLength(1);

    timer.advanceTo(300);
    bus.broadcastState(makeStateMessage({ positionMs: 1_300 }));
    timer.advanceTo(600);
    bus.broadcastState(makeStateMessage({ positionMs: 1_600 }));

    // Still only the first, immediate send -- the other two are coalesced and pending.
    expect(sent).toHaveLength(1);
    expect(timer.setTimeoutFn).toHaveBeenCalledTimes(1);
    expect(timer.pendingDelays()).toEqual([700]); // 1000ms window - 300ms elapsed at the first coalesced call

    timer.advanceTo(1_000);
    timer.fireLatest();

    expect(sent).toHaveLength(2);
    expect(sent[1]?.message).toMatchObject({ positionMs: 1_600 });
  });

  it("sends immediately again once the window has fully elapsed", () => {
    const { channel, sent } = makeFakeChannel();
    const timer = makeFakeTimer();
    const bus = new CastMessageBus(channel, timer);

    bus.broadcastState(makeStateMessage({ positionMs: 1 }));
    timer.advanceTo(1_500);
    bus.broadcastState(makeStateMessage({ positionMs: 2 }));

    expect(sent).toHaveLength(2);
    expect(timer.setTimeoutFn).not.toHaveBeenCalled();
  });
});

describe("CastMessageBus.sendAck / sendError", () => {
  it("sendAck builds a minimal ack when ok with no code/message", () => {
    const { channel, sent } = makeFakeChannel();
    const bus = new CastMessageBus(channel);

    bus.sendAck("sender-1", "req-1", true);

    expect(sent).toEqual([
      {
        senderId: "sender-1",
        message: { protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION, type: "ack", requestId: "req-1", ok: true },
      },
    ]);
  });

  it("sendAck includes code/message when provided", () => {
    const { channel, sent } = makeFakeChannel();
    const bus = new CastMessageBus(channel);

    bus.sendAck("sender-1", "req-1", false, "invalid_load_request", "bad request");

    expect(sent[0]?.message).toEqual({
      protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
      type: "ack",
      requestId: "req-1",
      ok: false,
      code: "invalid_load_request",
      message: "bad request",
    });
  });

  it("sendError defaults retryable to false and supports broadcast (no senderId)", () => {
    const { channel, sent } = makeFakeChannel();
    const bus = new CastMessageBus(channel);

    bus.sendError(undefined, "insecure_server", "refusing to load http:// server");

    expect(sent).toEqual([
      {
        senderId: undefined,
        message: {
          protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
          type: "error",
          code: "insecure_server",
          message: "refusing to load http:// server",
          retryable: false,
        },
      },
    ]);
  });

  it("sendError includes requestId/apiStatus/retryable when provided", () => {
    const { channel, sent } = makeFakeChannel();
    const bus = new CastMessageBus(channel);

    bus.sendError("sender-1", "auth_failed", "token expired", {
      requestId: "req-2",
      apiStatus: 401,
      retryable: true,
    });

    expect(sent[0]?.message).toEqual({
      protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
      type: "error",
      code: "auth_failed",
      message: "token expired",
      retryable: true,
      requestId: "req-2",
      apiStatus: 401,
    });
  });
});

describe("CastMessageBus.dispose", () => {
  it("cancels a pending throttled broadcast without sending it", () => {
    const { channel, sent } = makeFakeChannel();
    const timer = makeFakeTimer();
    const bus = new CastMessageBus(channel, timer);

    bus.broadcastState(makeStateMessage());
    timer.advanceTo(200);
    bus.broadcastState(makeStateMessage({ positionMs: 500 }));
    expect(timer.setTimeoutFn).toHaveBeenCalledTimes(1);

    bus.dispose();

    expect(timer.clearTimeoutFn).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
  });
});
