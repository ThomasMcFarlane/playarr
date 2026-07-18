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
      new Request("https://playarr.app/downloads/android/playarr-android.apk"),
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain(
      "playarr-android.apk"
    );
    expect(response.headers.get("Content-Type")).toBe(
      "application/vnd.android.package-archive"
    );
    expect(env.CLIENT_DOWNLOADS.get).toHaveBeenCalledWith(
      "android/playarr-android.apk"
    );
  });

  it("returns a clear 404 until the signed release is published", async () => {
    const response = await worker.fetch(
      new Request("https://playarr.app/downloads/android/playarr-android.apk"),
      environment(null)
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toContain("not been published");
  });

  it("serves the latest Android manifest and its immutable versioned APK", async () => {
    const object = {
      body: new Uint8Array([1]),
      httpEtag: '"release-etag"',
      size: 1,
      writeHttpMetadata() {},
    };
    const env = environment(object);

    const manifest = await worker.fetch(
      new Request("https://playarr.app/downloads/android/playarr-android.json"),
      env
    );
    expect(manifest.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(env.CLIENT_DOWNLOADS.get).toHaveBeenLastCalledWith(
      "android/playarr-android.json"
    );

    const apk = await worker.fetch(
      new Request(
        "https://playarr.app/downloads/android/releases/1.2.3/playarr-android.apk"
      ),
      env
    );
    expect(apk.headers.get("Content-Type")).toBe(
      "application/vnd.android.package-archive"
    );
    expect(apk.headers.get("Cache-Control")).toContain("immutable");
    expect(env.CLIENT_DOWNLOADS.get).toHaveBeenLastCalledWith(
      "android/releases/1.2.3/playarr-android.apk"
    );
  });

  it("does not expose arbitrary R2 object paths", async () => {
    const env = environment(null);
    await worker.fetch(
      new Request("https://playarr.app/downloads/android/releases/latest/private-key"),
      env
    );

    expect(env.CLIENT_DOWNLOADS.get).not.toHaveBeenCalled();
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
  });

  it("delegates ordinary application routes to static assets", async () => {
    const env = environment(null);
    const response = await worker.fetch(new Request("https://playarr.app/clients"), env);

    expect(await response.text()).toBe("asset");
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(env.CLIENT_DOWNLOADS.get).not.toHaveBeenCalled();
  });
});
