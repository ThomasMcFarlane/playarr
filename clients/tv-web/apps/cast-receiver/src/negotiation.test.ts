import { describe, expect, it, vi } from "vitest";
import type { PlaybackEventKind, PlaybackInfo } from "@streamarr-tv/api-client";
import type { PlayarrCastPlaybackIntent } from "@streamarr-tv/cast-protocol";
import {
  PlaybackNegotiator,
  isOnDemandSessionUrl,
  overridesToParams,
  type PlaybackNegotiatorClient,
} from "./negotiation";

function makeIntent(overrides: Partial<PlayarrCastPlaybackIntent> = {}): PlayarrCastPlaybackIntent {
  return {
    startPositionMs: 0,
    autoplay: true,
    preferredAudioTrackId: null,
    preferredSubtitleTrackId: null,
    preferredAudioLanguage: null,
    preferredSubtitleLanguage: null,
    qualityId: null,
    maxBitrateBps: null,
    ...overrides,
  };
}

function makeInfo(overrides: Partial<PlaybackInfo> = {}): PlaybackInfo {
  return {
    audio_tracks: [],
    duration_ms: 60_000,
    mime_type: "video/mp4",
    mode: "direct",
    quality_options: [],
    selected_quality_id: "original",
    session_id: "session-1",
    source_offset_ms: 0,
    subtitle_tracks: [],
    url: "/api/v1/media/file-1/stream?playback_session_id=session-1",
    ...overrides,
  };
}

function makeFakeClient(overrides: Partial<PlaybackNegotiatorClient> = {}): {
  client: PlaybackNegotiatorClient;
  getPlaybackInfo: ReturnType<typeof vi.fn>;
  recordPlaybackEvent: ReturnType<typeof vi.fn>;
} {
  const getPlaybackInfo = vi.fn(overrides.getPlaybackInfo ?? (async () => makeInfo()));
  const recordPlaybackEvent = vi.fn(overrides.recordPlaybackEvent ?? (async () => undefined));
  return {
    client: { getPlaybackInfo, recordPlaybackEvent } as unknown as PlaybackNegotiatorClient,
    getPlaybackInfo,
    recordPlaybackEvent,
  };
}

describe("isOnDemandSessionUrl", () => {
  it("is true only for the on-demand session playlist path", () => {
    expect(isOnDemandSessionUrl("/api/v1/media/sessions/abc-123/playlist.m3u8")).toBe(true);
    expect(isOnDemandSessionUrl("https://server/api/v1/media/sessions/abc/playlist.m3u8")).toBe(true);
  });

  it("is false for direct play and pre-rendered renditions", () => {
    expect(isOnDemandSessionUrl("/api/v1/media/file-1/stream?playback_session_id=x")).toBe(false);
    expect(isOnDemandSessionUrl("/api/v1/media/file-1/renditions/h264-720p/playlist.m3u8")).toBe(false);
  });
});

describe("overridesToParams", () => {
  it("maps a named quality id to profile + forceTranscode", () => {
    expect(overridesToParams({ qualityId: "h264-720p-4mbps" })).toEqual({
      profile: "h264-720p-4mbps",
      forceTranscode: true,
    });
  });

  it("treats qualityId 'original' as no profile override at all", () => {
    expect(overridesToParams({ qualityId: "original" })).toEqual({});
  });

  it("an explicit profile takes precedence over qualityId", () => {
    expect(overridesToParams({ qualityId: "original", profile: "h264-1080p-8mbps" })).toEqual({
      profile: "h264-1080p-8mbps",
      forceTranscode: true,
    });
  });

  it("respects an explicit forceTranscode: false alongside a profile", () => {
    expect(overridesToParams({ profile: "h264-720p-4mbps", forceTranscode: false })).toEqual({
      profile: "h264-720p-4mbps",
      forceTranscode: false,
    });
  });

  it("passes audioStreamIndex, ignoreSavedPreferences and maxBitrateBps straight through", () => {
    expect(
      overridesToParams({ audioStreamIndex: 3, ignoreSavedPreferences: true, maxBitrateBps: 8_000_000 })
    ).toEqual({
      audioStreamIndex: 3,
      ignoreSavedPreferences: true,
      maxBitrateBps: 8_000_000,
    });
  });

  it("omits maxBitrateBps when null and returns an empty object for no overrides", () => {
    expect(overridesToParams({ maxBitrateBps: null })).toEqual({});
    expect(overridesToParams({})).toEqual({});
  });
});

describe("PlaybackNegotiator", () => {
  it("negotiate() sends the fixed negotiation capability profile plus startPositionMs", async () => {
    const { client, getPlaybackInfo } = makeFakeClient();
    const negotiator = new PlaybackNegotiator(client);

    await negotiator.negotiate("file-1", makeIntent({ startPositionMs: 12_345 }));

    expect(getPlaybackInfo).toHaveBeenCalledWith("file-1", {
      containers: "mp4",
      videoCodecs: "h264",
      audioCodecs: "aac",
      startPositionMs: 12_345,
    });
  });

  it("negotiate() maps a non-original qualityId to profile/forceTranscode", async () => {
    const { client, getPlaybackInfo } = makeFakeClient();
    const negotiator = new PlaybackNegotiator(client);

    await negotiator.negotiate("file-1", makeIntent({ qualityId: "h264-720p-4mbps" }));

    expect(getPlaybackInfo).toHaveBeenCalledWith(
      "file-1",
      expect.objectContaining({ profile: "h264-720p-4mbps", forceTranscode: true })
    );
  });

  it("exposes sessionId/mode/sourceOffsetMs/url/current from the negotiated response", async () => {
    const info = makeInfo({ session_id: "s-42", mode: "hls", source_offset_ms: 5_000, url: "u" });
    const { client } = makeFakeClient({ getPlaybackInfo: async () => info });
    const negotiator = new PlaybackNegotiator(client);

    expect(negotiator.sessionId).toBeNull();
    expect(negotiator.current).toBeNull();

    await negotiator.negotiate("file-1", makeIntent());

    expect(negotiator.sessionId).toBe("s-42");
    expect(negotiator.mode).toBe("hls");
    expect(negotiator.sourceOffsetMs).toBe(5_000);
    expect(negotiator.url).toBe("u");
    expect(negotiator.current).toBe(info);
  });

  it("isOnDemandSession is true only for mode 'hls' with an on-demand session URL", async () => {
    const negotiator = new PlaybackNegotiator(makeFakeClient().client);
    expect(negotiator.isOnDemandSession).toBe(false);

    const direct = makeFakeClient({
      getPlaybackInfo: async () => makeInfo({ mode: "direct", url: "/api/v1/media/file-1/stream" }),
    });
    const directNegotiator = new PlaybackNegotiator(direct.client);
    await directNegotiator.negotiate("file-1", makeIntent());
    expect(directNegotiator.isOnDemandSession).toBe(false);

    const rendition = makeFakeClient({
      getPlaybackInfo: async () =>
        makeInfo({ mode: "hls", url: "/api/v1/media/file-1/renditions/h264-720p/playlist.m3u8" }),
    });
    const renditionNegotiator = new PlaybackNegotiator(rendition.client);
    await renditionNegotiator.negotiate("file-1", makeIntent());
    expect(renditionNegotiator.isOnDemandSession).toBe(false);

    const onDemand = makeFakeClient({
      getPlaybackInfo: async () =>
        makeInfo({ mode: "hls", url: "/api/v1/media/sessions/abc/playlist.m3u8" }),
    });
    const onDemandNegotiator = new PlaybackNegotiator(onDemand.client);
    await onDemandNegotiator.negotiate("file-1", makeIntent());
    expect(onDemandNegotiator.isOnDemandSession).toBe(true);
  });

  it("negotiate() closes a previously active session (best-effort) before opening the new one", async () => {
    const first = makeInfo({ session_id: "s-1" });
    const second = makeInfo({ session_id: "s-2" });
    let call = 0;
    const { client, recordPlaybackEvent } = makeFakeClient({
      getPlaybackInfo: async () => (call++ === 0 ? first : second),
    });
    const negotiator = new PlaybackNegotiator(client);

    await negotiator.negotiate("file-1", makeIntent());
    expect(negotiator.sessionId).toBe("s-1");

    await negotiator.negotiate("file-2", makeIntent(), 30_000);

    expect(recordPlaybackEvent).toHaveBeenCalledWith("s-1", {
      kind: "stop",
      reason: "user_stopped",
      position_ms: 30_000,
    } satisfies PlaybackEventKind);
    expect(negotiator.sessionId).toBe("s-2");
  });

  it("negotiate() still succeeds even if closing the previous session fails", async () => {
    const first = makeInfo({ session_id: "s-1" });
    const second = makeInfo({ session_id: "s-2" });
    let call = 0;
    const { client } = makeFakeClient({
      getPlaybackInfo: async () => (call++ === 0 ? first : second),
      recordPlaybackEvent: async () => {
        throw new Error("server unreachable");
      },
    });
    const negotiator = new PlaybackNegotiator(client);

    await negotiator.negotiate("file-1", makeIntent());
    await expect(negotiator.negotiate("file-2", makeIntent())).resolves.toEqual(second);
    expect(negotiator.sessionId).toBe("s-2");
  });

  it("renegotiateAt() throws before any initial negotiate()", async () => {
    const negotiator = new PlaybackNegotiator(makeFakeClient().client);
    await expect(negotiator.renegotiateAt(1_000)).rejects.toThrow(
      "renegotiateAt called before an initial negotiate()"
    );
  });

  it("renegotiateAt() closes the superseded session and negotiates fresh with overrides", async () => {
    const first = makeInfo({ session_id: "s-1", source_offset_ms: 0 });
    const second = makeInfo({ session_id: "s-2", source_offset_ms: 42_000 });
    let call = 0;
    const { client, getPlaybackInfo, recordPlaybackEvent } = makeFakeClient({
      getPlaybackInfo: async () => (call++ === 0 ? first : second),
    });
    const negotiator = new PlaybackNegotiator(client);
    await negotiator.negotiate("file-1", makeIntent());

    const result = await negotiator.renegotiateAt(42_000, { audioStreamIndex: 2 });

    expect(recordPlaybackEvent).toHaveBeenCalledWith("s-1", {
      kind: "stop",
      reason: "user_stopped",
      position_ms: 42_000,
    });
    expect(getPlaybackInfo).toHaveBeenLastCalledWith(
      "file-1",
      expect.objectContaining({ startPositionMs: 42_000, audioStreamIndex: 2 })
    );
    expect(result).toBe(second);
    expect(negotiator.sessionId).toBe("s-2");
    expect(negotiator.sourceOffsetMs).toBe(42_000);
  });

  it("endSession() reports the given reason and clears state, and no-ops with nothing active", async () => {
    const { client, recordPlaybackEvent } = makeFakeClient();
    const negotiator = new PlaybackNegotiator(client);

    await negotiator.endSession(1_000, "completed");
    expect(recordPlaybackEvent).not.toHaveBeenCalled();

    await negotiator.negotiate("file-1", makeIntent());
    await negotiator.endSession(9_999, "device_disconnected");

    expect(recordPlaybackEvent).toHaveBeenCalledWith("session-1", {
      kind: "stop",
      reason: "device_disconnected",
      position_ms: 9_999,
    });
    expect(negotiator.sessionId).toBeNull();
    expect(negotiator.current).toBeNull();
  });

  it("clamps negative/fractional positions to a non-negative integer ms", async () => {
    const { client, getPlaybackInfo } = makeFakeClient();
    const negotiator = new PlaybackNegotiator(client);

    await negotiator.negotiate("file-1", makeIntent({ startPositionMs: -5.6 }));

    expect(getPlaybackInfo).toHaveBeenCalledWith("file-1", expect.objectContaining({ startPositionMs: 0 }));
  });

  it("clearSession() drops the tracked session without reporting a stop event", async () => {
    const { client, recordPlaybackEvent } = makeFakeClient();
    const negotiator = new PlaybackNegotiator(client);
    await negotiator.negotiate("file-1", makeIntent());

    negotiator.clearSession();

    expect(recordPlaybackEvent).not.toHaveBeenCalled();
    expect(negotiator.sessionId).toBeNull();
    expect(negotiator.current).toBeNull();
  });
});
