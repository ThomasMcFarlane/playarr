import { beforeAll, describe, expect, it } from "vitest";
import type { PlayarrCastLoadRequest } from "@playarr-tv/cast-protocol";
import type { PlayerPlaylistItem } from "../../components/player/PlayerSurface";
import { DOWNLOADED_QUALITY_ID } from "../qualityIds";
import { buildPlayarrCastLoadRequest, requestPlayarrCastLoad } from "./castLoad";

// `chrome.cast.media.*` only exist at runtime once the real CAF sender
// script has loaded in a browser -- under vitest's node environment there
// is no such global at all, so `requestPlayarrCastLoad`'s tests below stub
// just enough of the shape it actually touches.
class FakeMediaInfo {
  streamType?: string;
  duration?: number | null;
  metadata?: unknown;
  customData?: unknown;
  constructor(
    public contentId: string,
    public contentType: string
  ) {}
}
class FakeGenericMediaMetadata {
  title?: string;
  subtitle?: string;
}
class FakeLoadRequest {
  autoplay = false;
  currentTime = 0;
  constructor(public media: FakeMediaInfo) {}
}

beforeAll(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    cast: {
      media: {
        MediaInfo: FakeMediaInfo,
        GenericMediaMetadata: FakeGenericMediaMetadata,
        LoadRequest: FakeLoadRequest,
        StreamType: { BUFFERED: "BUFFERED" },
      },
    },
  };
});

const MOVIE_ITEM: PlayerPlaylistItem = {
  mediaFileId: "media-1",
  title: "A Movie",
};

const EPISODE_ITEM: PlayerPlaylistItem = {
  mediaFileId: "media-2",
  title: "The Pilot",
  subtitle: "Some Show",
  episodeId: "episode-2",
  seasonNumber: 1,
  episodeNumber: 1,
};

const TRACK_ITEM: PlayerPlaylistItem = {
  mediaFileId: "media-3",
  title: "A Song",
  music: {
    artistName: "An Artist",
    albumTitle: "An Album",
    artworkWork: { id: "work-artist-1", images: [] },
  },
};

function baseInput(overrides: Partial<Parameters<typeof buildPlayarrCastLoadRequest>[0]> = {}) {
  return {
    serverBaseUrl: "http://localhost:8484/",
    credentials: {
      deviceId: "cast-device-1",
      accessToken: "at-1",
      accessTokenExpiresAt: Date.now() + 900_000,
      refreshToken: "rt-1",
    },
    item: MOVIE_ITEM,
    startPositionSeconds: 12.4,
    durationSeconds: 3600,
    autoplay: true,
    selectedAudioTrackId: null,
    selectedSubtitleTrackId: null,
    audioTracks: [],
    subtitleTracks: [],
    activeQualityId: "original",
    qualityOptions: [],
    queue: [],
    senderLanguage: "en-US",
    ...overrides,
  };
}

describe("buildPlayarrCastLoadRequest", () => {
  it("builds the full PlayarrCastLoadRequest shape for a movie", () => {
    const request = buildPlayarrCastLoadRequest(baseInput());

    expect(request).toEqual<PlayarrCastLoadRequest>({
      protocolVersion: 1,
      server: { baseUrl: "http://localhost:8484/", peers: undefined },
      credentials: {
        deviceId: "cast-device-1",
        accessToken: "at-1",
        accessTokenExpiresAt: expect.any(Number),
        refreshToken: "rt-1",
      },
      item: {
        mediaFileId: "media-1",
        workId: undefined,
        kind: "movie",
        title: "A Movie",
        subtitle: undefined,
        seasonNumber: undefined,
        episodeNumber: undefined,
        durationMs: 3_600_000,
      },
      playback: {
        startPositionMs: 12_400,
        autoplay: true,
        preferredAudioTrackId: null,
        preferredSubtitleTrackId: null,
        preferredAudioLanguage: null,
        preferredSubtitleLanguage: null,
        qualityId: "original",
        maxBitrateBps: null,
      },
      sender: {
        platform: "web",
        appVersion: expect.any(String),
        deviceName: "Playarr Web",
        language: "en-US",
      },
      queue: undefined,
    });
  });

  it("classifies an episode item and carries season/episode numbers", () => {
    const request = buildPlayarrCastLoadRequest(baseInput({ item: EPISODE_ITEM }));

    expect(request.item).toMatchObject({
      mediaFileId: "media-2",
      kind: "episode",
      title: "The Pilot",
      subtitle: "Some Show",
      seasonNumber: 1,
      episodeNumber: 1,
    });
  });

  it("classifies a music item as a track and carries its artist work id", () => {
    const request = buildPlayarrCastLoadRequest(baseInput({ item: TRACK_ITEM }));

    expect(request.item).toMatchObject({
      mediaFileId: "media-3",
      kind: "track",
      workId: "work-artist-1",
    });
  });

  it("maps the selected audio/subtitle track ids to their languages", () => {
    const request = buildPlayarrCastLoadRequest(
      baseInput({
        selectedAudioTrackId: "audio-2",
        selectedSubtitleTrackId: "sub-1",
        audioTracks: [
          { id: "audio-1", label: "English", language: "en", roles: [], selected: false },
          { id: "audio-2", label: "Japanese", language: "ja", roles: [], selected: true },
        ],
        subtitleTracks: [
          { id: "sub-1", label: "English", language: "en", roles: [], forced: false, selected: true },
        ],
      })
    );

    expect(request.playback.preferredAudioTrackId).toBe("audio-2");
    expect(request.playback.preferredAudioLanguage).toBe("ja");
    expect(request.playback.preferredSubtitleTrackId).toBe("sub-1");
    expect(request.playback.preferredSubtitleLanguage).toBe("en");
  });

  it("never forwards the local-only Downloaded quality id or bitrate hint", () => {
    const request = buildPlayarrCastLoadRequest(
      baseInput({
        activeQualityId: DOWNLOADED_QUALITY_ID,
        qualityOptions: [
          {
            id: DOWNLOADED_QUALITY_ID,
            label: "Downloaded",
            profile: null,
            height: null,
            video_bitrate_bps: null,
          },
        ],
      })
    );

    expect(request.playback.qualityId).toBeNull();
    expect(request.playback.maxBitrateBps).toBeNull();
  });

  it("forwards a real quality id and its bitrate hint", () => {
    const request = buildPlayarrCastLoadRequest(
      baseInput({
        activeQualityId: "1080p",
        qualityOptions: [
          { id: "1080p", label: "1080p", profile: "1080p", height: 1080, video_bitrate_bps: 8_000_000 },
        ],
      })
    );

    expect(request.playback.qualityId).toBe("1080p");
    expect(request.playback.maxBitrateBps).toBe(8_000_000);
  });

  it("maps the remaining playlist items to a queue, omitting the currently-loading item", () => {
    const request = buildPlayarrCastLoadRequest(
      baseInput({
        item: EPISODE_ITEM,
        queue: [
          { mediaFileId: "media-next", title: "Next Episode", seasonNumber: 1, episodeNumber: 2 },
        ],
      })
    );

    expect(request.queue).toEqual([
      {
        mediaFileId: "media-next",
        workId: undefined,
        kind: "episode",
        title: "Next Episode",
        subtitle: undefined,
        seasonNumber: 1,
        episodeNumber: 2,
      },
    ]);
  });

  it("omits `queue` entirely rather than sending an empty array", () => {
    const request = buildPlayarrCastLoadRequest(baseInput({ queue: [] }));
    expect(request.queue).toBeUndefined();
  });

  it("passes server peers through untouched", () => {
    const peers = [{ peerNodeId: "peer-1", url: "http://peer-1.local:8484/" }];
    const request = buildPlayarrCastLoadRequest(baseInput({ serverPeers: peers }));
    expect(request.server.peers).toEqual(peers);
  });
});

describe("requestPlayarrCastLoad", () => {
  const sampleRequest: PlayarrCastLoadRequest = buildPlayarrCastLoadRequest(baseInput());

  it("sets mediaInfo.customData to the full load request, per the Playarr Cast protocol", async () => {
    let loadedMedia: FakeMediaInfo | undefined;
    const session = {
      loadMedia: async (request: FakeLoadRequest) => {
        loadedMedia = request.media;
        return undefined;
      },
    };

    await requestPlayarrCastLoad(session, sampleRequest);

    expect(loadedMedia?.customData).toBe(sampleRequest);
    expect(loadedMedia?.contentId).toBe(sampleRequest.item.mediaFileId);
  });

  it("normalizes a bare chrome.cast.ErrorCode STRING rejection into a real Error", async () => {
    const session = {
      loadMedia: () => Promise.reject("load_media_failed"),
    };

    await expect(requestPlayarrCastLoad(session, sampleRequest)).rejects.toThrow(
      /load_media_failed/
    );
  });

  it("also normalizes a resolved (not rejected) ErrorCode into a thrown Error", async () => {
    // A type assertion, not a real enum member access -- the fake
    // `chrome.cast` stub above only implements the `media.*` shape this
    // module actually touches, not `ErrorCode` itself.
    const session = {
      loadMedia: async () => "load_media_failed" as unknown as chrome.cast.ErrorCode,
    };

    await expect(requestPlayarrCastLoad(session, sampleRequest)).rejects.toThrow(
      /load_media_failed/
    );
  });

  it("resolves cleanly when loadMedia resolves with undefined", async () => {
    const session = { loadMedia: async () => undefined };
    await expect(requestPlayarrCastLoad(session, sampleRequest)).resolves.toBeUndefined();
  });
});
