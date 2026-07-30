import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApiClient,
  FolderBrowseResponse,
  FolderRoot,
  Work,
} from "@playarr-tv/api-client";
import {
  clearJoinedServerRegistry,
  createJoinedApiClient,
  getJoinedFolderRootServerUrl,
  getJoinedWorkSources,
  joinServerWorks,
  workIdentityKeys,
  type ConnectedServerClient,
} from "./joinedServers";

function work(overrides: Partial<Work> = {}): Work {
  return {
    id: crypto.randomUUID(),
    kind: "movie",
    title: "Voyage",
    sort_title: "Voyage",
    release_date: "2016-09-01T00:00:00Z",
    added_at: "2026-01-01T00:00:00Z",
    availability: "available",
    monitored: true,
    external_refs: [{ provider: "tmdb", external_id: "329865" }],
    genres: [],
    tags: [],
    images: [],
    ...overrides,
  };
}

function server(url: string): ConnectedServerClient {
  return {
    url,
    label: new URL(url).host,
    client: {} as ApiClient,
    getAccessToken: async () => undefined,
  };
}

function folderRoot(id: string, name: string): FolderRoot {
  return {
    id,
    source_instance_id: `${id}-source`,
    source_name: name,
    library_kind: "movie",
    name,
    available: true,
    unavailable_reason: null,
  };
}

beforeEach(() => {
  clearJoinedServerRegistry();
});

describe("joined server catalogue", () => {
  it("joins the same item by external provider identity", () => {
    const first = work({ id: crypto.randomUUID() });
    const second = work({ id: crypto.randomUUID(), title: "Voyage (2016)" });
    const items = joinServerWorks([
      { server: server("https://one.example"), works: [first] },
      { server: server("https://two.example"), works: [second] },
    ]);

    expect(items).toEqual([first]);
    expect(getJoinedWorkSources(first.id).map((source) => source.work.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("falls back to kind, normalised title and release year", () => {
    const first = work({ external_refs: [], title: "Test Series F" });
    const second = work({ external_refs: [], title: " Test Series F " });

    expect(
      joinServerWorks([
        { server: server("https://one.example"), works: [first] },
        { server: server("https://two.example"), works: [second] },
      ])
    ).toHaveLength(1);
  });

  it("does not join different years when external references are absent", () => {
    const first = work({ external_refs: [], release_date: "2016-01-01T00:00:00Z" });
    const second = work({ external_refs: [], release_date: "2024-01-01T00:00:00Z" });

    expect(workIdentityKeys(first)).not.toEqual(workIdentityKeys(second));
    expect(
      joinServerWorks([
        { server: server("https://one.example"), works: [first] },
        { server: server("https://two.example"), works: [second] },
      ])
    ).toHaveLength(2);
  });

  it("does not let a matching title override conflicting external identities", () => {
    const first = work({ external_refs: [{ provider: "tmdb", external_id: "100" }] });
    const second = work({ external_refs: [{ provider: "tmdb", external_id: "200" }] });

    expect(
      joinServerWorks([
        { server: server("https://one.example"), works: [first] },
        { server: server("https://two.example"), works: [second] },
      ])
    ).toHaveLength(2);
  });
});

describe("joined server folders", () => {
  it("fans roots out and routes browsing and media artwork to the owning server", async () => {
    const firstRoot = folderRoot("root-one", "First films");
    const secondRoot = folderRoot("root-two", "Second films");
    const mediaFileId = "media-on-second";
    const secondBrowse: FolderBrowseResponse = {
      root: secondRoot,
      path: "Drama",
      breadcrumbs: [{ name: "Drama", path: "Drama" }],
      entries: [
        {
          entry_type: "media",
          name: "Voyage.mkv",
          path: "Drama/Voyage.mkv",
          media_file_id: mediaFileId,
          media_kind: "movie",
        },
      ],
      total: 1,
      offset: 0,
      limit: 200,
    };
    const firstClient = {
      listFolderRoots: vi.fn(async () => ({ roots: [firstRoot], errors: [] })),
      browseFolder: vi.fn(),
      getMediaThumbnail: vi.fn(),
    } as unknown as ApiClient;
    const secondThumbnail = new Blob(["jpeg"], { type: "image/jpeg" });
    const secondClient = {
      listFolderRoots: vi.fn(async () => ({
        roots: [secondRoot],
        errors: [
          {
            source_instance_id: "stale-source",
            source_name: "Stale source",
            message: "Cached roots were used.",
          },
        ],
      })),
      browseFolder: vi.fn(async () => secondBrowse),
      getMediaThumbnail: vi.fn(async () => secondThumbnail),
    } as unknown as ApiClient;
    const joined = createJoinedApiClient([
      { ...server("https://one.example"), client: firstClient },
      { ...server("https://two.example"), client: secondClient },
    ]);

    await expect(joined.listFolderRoots("movie")).resolves.toEqual({
      roots: [firstRoot, secondRoot],
      errors: [
        {
          source_instance_id: "stale-source",
          source_name: "Stale source",
          message: "Cached roots were used.",
        },
      ],
    });
    expect(getJoinedFolderRootServerUrl(secondRoot.id)).toBe(
      "https://two.example"
    );
    await expect(
      joined.browseFolder(secondRoot.id, { path: "Drama", limit: 200 })
    ).resolves.toEqual(secondBrowse);
    await expect(joined.getMediaThumbnail(mediaFileId)).resolves.toBe(
      secondThumbnail
    );

    expect(firstClient.browseFolder).not.toHaveBeenCalled();
    expect(secondClient.browseFolder).toHaveBeenCalledWith(secondRoot.id, {
      path: "Drama",
      limit: 200,
    });
    expect(secondClient.getMediaThumbnail).toHaveBeenCalledWith(
      mediaFileId,
      undefined
    );
  });

  it("surfaces an unavailable server alongside successful roots", async () => {
    const availableRoot = folderRoot("root-one", "First films");
    const availableClient = {
      listFolderRoots: vi.fn(async () => ({
        roots: [availableRoot],
        errors: [],
      })),
    } as unknown as ApiClient;
    const unavailableClient = {
      listFolderRoots: vi.fn(async () => {
        throw new Error("Server is offline");
      }),
    } as unknown as ApiClient;
    const joined = createJoinedApiClient([
      { ...server("https://one.example"), client: availableClient },
      { ...server("https://offline.example"), client: unavailableClient },
    ]);

    await expect(joined.listFolderRoots("movie")).resolves.toEqual({
      roots: [availableRoot],
      errors: [
        {
          source_instance_id: "https://offline.example",
          source_name: "offline.example",
          message: "Server is offline",
        },
      ],
    });
  });
});
