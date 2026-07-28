import { describe, expect, it, vi } from "vitest";
import { loadWorkArtworkBlobUrl } from "./artwork";

describe("loadWorkArtworkBlobUrl", () => {
  it("returns a blob: URL built from the first successful kind", async () => {
    const fetchArtwork = vi.fn(async () => new Blob(["fake-image-bytes"], { type: "image/jpeg" }));

    const url = await loadWorkArtworkBlobUrl(fetchArtwork, "work-1");

    expect(fetchArtwork).toHaveBeenCalledWith("work-1", "poster");
    expect(url).toMatch(/^blob:/);
  });

  it("falls back to the next preferred kind when the first fails", async () => {
    const fetchArtwork = vi.fn(async (_workId: string, kind: string) => {
      if (kind === "poster") throw new Error("404 no poster");
      return new Blob(["fake-image-bytes"]);
    });

    const url = await loadWorkArtworkBlobUrl(fetchArtwork, "work-1");

    expect(fetchArtwork).toHaveBeenNthCalledWith(1, "work-1", "poster");
    expect(fetchArtwork).toHaveBeenNthCalledWith(2, "work-1", "backdrop");
    expect(url).toMatch(/^blob:/);
  });

  it("resolves to undefined -- never throws -- once every kind has failed", async () => {
    const fetchArtwork = vi.fn(async () => {
      throw new Error("network error");
    });

    await expect(loadWorkArtworkBlobUrl(fetchArtwork, "work-1")).resolves.toBeUndefined();
    expect(fetchArtwork).toHaveBeenCalledTimes(2);
  });

  it("respects a caller-supplied kind preference order", async () => {
    const fetchArtwork = vi.fn(async () => new Blob(["fake-image-bytes"]));

    await loadWorkArtworkBlobUrl(fetchArtwork, "work-1", ["thumb"]);

    expect(fetchArtwork).toHaveBeenCalledWith("work-1", "thumb");
    expect(fetchArtwork).toHaveBeenCalledTimes(1);
  });
});
