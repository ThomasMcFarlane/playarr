import { describe, expect, it } from "vitest";
import {
  PLAYARR_CAST_NAMESPACE,
  PLAYARR_CAST_PROTOCOL_VERSION,
  encodePlayarrCastMessage,
  isPlayarrCastLoadRequest,
  isPlayarrCastReceiverMessage,
  isPlayarrCastSenderMessage,
  parsePlayarrCastMessage,
  type PlayarrCastLoadRequest,
  type PlayarrCastReceiverMessage,
  type PlayarrCastSelectTracksMessage,
  type PlayarrCastSenderMessage,
  type PlayarrCastStateMessage,
} from "./index";

function makeSelectTracksMessage(
  overrides: Partial<PlayarrCastSelectTracksMessage> = {},
): PlayarrCastSelectTracksMessage {
  return {
    protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
    type: "tracks.select",
    requestId: "req-1",
    audioTrackId: "audio-1",
    subtitleTrackId: null,
    ...overrides,
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
    positionMs: 1000,
    durationMs: 60000,
    audioTracks: [],
    subtitleTracks: [],
    qualityOptions: [],
    selectedAudioTrackId: null,
    selectedSubtitleTrackId: null,
    selectedQualityId: "auto",
    queue: [],
    ...overrides,
  };
}

function makeLoadRequest(overrides: Partial<PlayarrCastLoadRequest> = {}): PlayarrCastLoadRequest {
  return {
    protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
    server: { baseUrl: "https://example.playarr.local" },
    credentials: {
      deviceId: "device-1",
      accessToken: "access-token",
      accessTokenExpiresAt: Date.now() + 60_000,
      refreshToken: "refresh-token",
    },
    item: {
      mediaFileId: "file-1",
      kind: "movie",
      title: "Some Movie",
    },
    playback: {
      startPositionMs: 0,
      autoplay: true,
    },
    sender: {
      platform: "web",
      appVersion: "1.0.0",
      deviceName: "Chrome on Linux",
      language: "en-US",
    },
    ...overrides,
  };
}

describe("PLAYARR_CAST_NAMESPACE / PLAYARR_CAST_PROTOCOL_VERSION", () => {
  it("exposes the expected constants", () => {
    expect(PLAYARR_CAST_NAMESPACE).toBe("urn:x-cast:app.playarr.cast.v1");
    expect(PLAYARR_CAST_PROTOCOL_VERSION).toBe(1);
  });
});

describe("isPlayarrCastLoadRequest", () => {
  it("accepts a well-formed load request", () => {
    expect(isPlayarrCastLoadRequest(makeLoadRequest())).toBe(true);
  });

  it("accepts a load request with peers and a queue", () => {
    const request = makeLoadRequest({
      server: {
        baseUrl: "https://example.playarr.local",
        peers: [{ peerNodeId: "node-1", url: "https://node-1.playarr.local" }],
      },
      queue: [{ mediaFileId: "file-2", kind: "episode", title: "Next Up" }],
    });
    expect(isPlayarrCastLoadRequest(request)).toBe(true);
  });

  it("rejects a missing required field", () => {
    const request: Record<string, unknown> = makeLoadRequest();
    delete request["credentials"];
    expect(isPlayarrCastLoadRequest(request)).toBe(false);
  });

  it("rejects a wrong protocol version", () => {
    const request = { ...makeLoadRequest(), protocolVersion: 2 };
    expect(isPlayarrCastLoadRequest(request)).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(isPlayarrCastLoadRequest(null)).toBe(false);
    expect(isPlayarrCastLoadRequest(undefined)).toBe(false);
    expect(isPlayarrCastLoadRequest("not an object")).toBe(false);
    expect(isPlayarrCastLoadRequest(42)).toBe(false);
    expect(isPlayarrCastLoadRequest([])).toBe(false);
  });
});

describe("isPlayarrCastSenderMessage / isPlayarrCastReceiverMessage", () => {
  it("accepts every sender message type", () => {
    const messages: PlayarrCastSenderMessage[] = [
      makeSelectTracksMessage(),
      {
        protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
        type: "auth.update",
        credentials: {
          deviceId: "device-1",
          accessToken: "a",
          accessTokenExpiresAt: 1,
          refreshToken: "r",
        },
      },
      { protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION, type: "quality.select", qualityId: "1080p" },
      { protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION, type: "queue.set", items: [] },
      { protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION, type: "queue.playNext" },
      { protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION, type: "state.request" },
      { protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION, type: "session.end", reason: "user_stopped" },
    ];
    for (const message of messages) {
      expect(isPlayarrCastSenderMessage(message)).toBe(true);
      expect(isPlayarrCastReceiverMessage(message)).toBe(false);
    }
  });

  it("accepts every receiver message type", () => {
    const messages: PlayarrCastReceiverMessage[] = [
      {
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
      },
      makeStateMessage(),
      {
        protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
        type: "auth.rotated",
        credentials: {
          deviceId: "device-1",
          accessToken: "a",
          accessTokenExpiresAt: 1,
          refreshToken: "r",
        },
      },
      {
        protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
        type: "error",
        code: "playback_failed",
        message: "boom",
        retryable: true,
      },
      { protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION, type: "ack", requestId: "req-1", ok: true },
    ];
    for (const message of messages) {
      expect(isPlayarrCastReceiverMessage(message)).toBe(true);
      expect(isPlayarrCastSenderMessage(message)).toBe(false);
    }
  });

  it("rejects an unknown type", () => {
    const message = { protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION, type: "not.a.real.type" };
    expect(isPlayarrCastSenderMessage(message)).toBe(false);
    expect(isPlayarrCastReceiverMessage(message)).toBe(false);
  });
});

describe("parsePlayarrCastMessage", () => {
  it("parses a JSON string and an already-parsed object to an equivalent result", () => {
    const message = makeSelectTracksMessage();
    const fromObject = parsePlayarrCastMessage(message);
    const fromString = parsePlayarrCastMessage(JSON.stringify(message));

    expect(fromObject).toEqual(message);
    expect(fromString).toEqual(message);
    expect(fromObject).toEqual(fromString);
  });

  it("returns undefined for an unknown type", () => {
    const message = { protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION, type: "bogus" };
    expect(parsePlayarrCastMessage(message)).toBeUndefined();
    expect(parsePlayarrCastMessage(JSON.stringify(message))).toBeUndefined();
  });

  it("returns undefined for a protocolVersion mismatch", () => {
    const message = { ...makeSelectTracksMessage(), protocolVersion: 999 };
    expect(parsePlayarrCastMessage(message)).toBeUndefined();
    expect(parsePlayarrCastMessage(JSON.stringify(message))).toBeUndefined();
  });

  it("never throws on unparseable input", () => {
    expect(() => parsePlayarrCastMessage("{not valid json")).not.toThrow();
    expect(parsePlayarrCastMessage("{not valid json")).toBeUndefined();

    expect(() => parsePlayarrCastMessage(undefined)).not.toThrow();
    expect(parsePlayarrCastMessage(undefined)).toBeUndefined();

    expect(() => parsePlayarrCastMessage(42)).not.toThrow();
    expect(parsePlayarrCastMessage(42)).toBeUndefined();

    expect(() => parsePlayarrCastMessage(null)).not.toThrow();
    expect(parsePlayarrCastMessage(null)).toBeUndefined();

    expect(() => parsePlayarrCastMessage("null")).not.toThrow();
    expect(parsePlayarrCastMessage("null")).toBeUndefined();
  });

  it("distinguishes subtitleTrackId: null from an absent key across a JSON round-trip", () => {
    const explicitNull = makeSelectTracksMessage({ subtitleTrackId: null });
    const absent = makeSelectTracksMessage();
    delete (absent as Partial<PlayarrCastSelectTracksMessage>).subtitleTrackId;

    const parsedExplicitNull = parsePlayarrCastMessage(
      JSON.parse(JSON.stringify(explicitNull)),
    ) as PlayarrCastSelectTracksMessage | undefined;
    const parsedAbsent = parsePlayarrCastMessage(
      JSON.parse(JSON.stringify(absent)),
    ) as PlayarrCastSelectTracksMessage | undefined;

    expect(parsedExplicitNull).toBeDefined();
    expect(parsedAbsent).toBeDefined();

    expect(parsedExplicitNull).toHaveProperty("subtitleTrackId");
    expect(parsedExplicitNull?.subtitleTrackId).toBeNull();

    expect(parsedAbsent).not.toHaveProperty("subtitleTrackId");
    expect(parsedAbsent?.subtitleTrackId).toBeUndefined();

    // Same round-trip behavior through the JSON-string entry point.
    const parsedExplicitNullFromString = parsePlayarrCastMessage(
      JSON.stringify(explicitNull),
    ) as PlayarrCastSelectTracksMessage | undefined;
    const parsedAbsentFromString = parsePlayarrCastMessage(
      JSON.stringify(absent),
    ) as PlayarrCastSelectTracksMessage | undefined;

    expect(parsedExplicitNullFromString).toHaveProperty("subtitleTrackId");
    expect(parsedExplicitNullFromString?.subtitleTrackId).toBeNull();
    expect(parsedAbsentFromString).not.toHaveProperty("subtitleTrackId");
  });
});

describe("encodePlayarrCastMessage", () => {
  it("encodes a message to JSON", () => {
    const message = makeSelectTracksMessage();
    const encoded = encodePlayarrCastMessage(message);
    expect(typeof encoded).toBe("string");
    expect(JSON.parse(encoded)).toEqual(message);
  });

  it("does not throw for a payload just under the 64KB boundary", () => {
    // Build a state message whose queue padding brings the encoded
    // size to just under 64 * 1024 bytes.
    const base = makeStateMessage();
    const baseSize = new TextEncoder().encode(JSON.stringify(base)).length;
    const budget = 64 * 1024 - baseSize - 64; // leave headroom for JSON quoting/overhead
    const padded = makeStateMessage({
      // @ts-expect-error -- deliberately smuggling a padding field for size testing
      _pad: "x".repeat(Math.max(budget, 0)),
    });

    const encodedSize = new TextEncoder().encode(JSON.stringify(padded)).length;
    expect(encodedSize).toBeLessThan(64 * 1024);
    expect(() => encodePlayarrCastMessage(padded)).not.toThrow();
  });

  it("throws a RangeError once the encoded UTF-8 size exceeds 64KB", () => {
    const oversized = makeStateMessage({
      // @ts-expect-error -- deliberately smuggling a padding field for size testing
      _pad: "x".repeat(64 * 1024),
    });
    expect(() => encodePlayarrCastMessage(oversized)).toThrow(RangeError);
  });

  it("measures UTF-8 byte length, not JS string length, for multi-byte characters", () => {
    // Each "𝄞" is a 4-byte UTF-8 (surrogate pair, 2 UTF-16 code units) character.
    const multiByteChar = "𝄞";
    const repeatCount = 20_000; // ~80,000 bytes, well past the 64KB cap
    const oversized = makeStateMessage({
      // @ts-expect-error -- deliberately smuggling a padding field for size testing
      _pad: multiByteChar.repeat(repeatCount),
    });

    const jsStringLength = JSON.stringify(oversized).length;
    const byteLength = new TextEncoder().encode(JSON.stringify(oversized)).length;
    expect(byteLength).toBeGreaterThan(jsStringLength);
    expect(() => encodePlayarrCastMessage(oversized)).toThrow(RangeError);
  });
});
