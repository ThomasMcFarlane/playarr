import { describe, expect, it, vi } from "vitest";
import worker from "./worker.js";

function environment(object) {
  return {
    ASSETS: { fetch: vi.fn(async () => new Response("asset")) },
    CLIENT_DOWNLOADS: { get: vi.fn(async () => object) },
  };
}

describe("Android APK downloads", () => {
  it("serves a published APK as a same-origin attachment", async () => {
    const env = environment({
      body: new Uint8Array([1, 2, 3]),
      httpEtag: '"release-etag"',
      size: 3,
      writeHttpMetadata(headers) {
        headers.set("Last-Modified", "Fri, 18 Jul 2026 00:00:00 GMT");
      },
    });

    const response = await worker.fetch(
      new Request("https://playarr.app/downloads/android/playarr-android-tv.apk"),
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain(
      "playarr-android-tv.apk"
    );
    expect(response.headers.get("Content-Type")).toBe(
      "application/vnd.android.package-archive"
    );
    expect(env.CLIENT_DOWNLOADS.get).toHaveBeenCalledWith(
      "android/playarr-android-tv.apk"
    );
  });

  it("returns a clear 404 until the signed release is published", async () => {
    const response = await worker.fetch(
      new Request("https://playarr.app/downloads/android/playarr-android-mobile.apk"),
      environment(null)
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toContain("not been published");
  });

  it("delegates ordinary application routes to static assets", async () => {
    const env = environment(null);
    const response = await worker.fetch(new Request("https://playarr.app/clients"), env);

    expect(await response.text()).toBe("asset");
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(env.CLIENT_DOWNLOADS.get).not.toHaveBeenCalled();
  });
});
