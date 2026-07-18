import { describe, expect, it } from "vitest";
import type { ApiClient, Work } from "@streamarr-tv/api-client";
import {
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
