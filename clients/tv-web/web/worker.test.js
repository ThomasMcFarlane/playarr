import { describe, expect, it, vi } from "vitest";
import worker, { LinkSession } from "./worker.js";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, value); }
  async setAlarm() {}
  async deleteAll() { this.values.clear(); }
}

function environment(object) {
  const sessions = new Map();
  return {
    ASSETS: { fetch: vi.fn(async () => new Response("asset")) },
    CLIENT_DOWNLOADS: { get: vi.fn(async () => object) },
    LINK_SESSIONS: {
      idFromName: (name) => name,
      get(id) {
        if (!sessions.has(id)) {
          const storage = new MemoryStorage();
          const impl = new LinkSession({ storage });
          const session = {
            fetch: (request, init) => impl.fetch(new Request(request, init)),
          };
          sessions.set(id, session);
        }
        return sessions.get(id);
      },
    },
  };
}

describe("client package downloads", () => {
  it("serves a published APK without authentication as a same-origin attachment", async () => {
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
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
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

  it.each([
    {
      path: "/downloads/webos/playarr-webos.ipk",
      key: "webos/playarr-webos.ipk",
      filename: "playarr-webos.ipk",
      contentType: "application/octet-stream",
    },
    {
      path: "/downloads/tizen/playarr-tizen.wgt",
      key: "tizen/playarr-tizen.wgt",
      filename: "playarr-tizen.wgt",
      contentType: "application/widget",
    },
    {
      path: "/downloads/roku/playarr-roku.zip",
      key: "roku/playarr-roku.zip",
      filename: "playarr-roku.zip",
      contentType: "application/zip",
    },
  ])("serves the published $filename from its stable R2 key", async ({
    path,
    key,
    filename,
    contentType,
  }) => {
    const env = environment({
      body: new Uint8Array([1, 2, 3]),
      httpEtag: '"release-etag"',
      size: 3,
      writeHttpMetadata() {},
    });

    const response = await worker.fetch(
      new Request(`https://playarr.app${path}`),
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="${filename}"`
    );
    expect(response.headers.get("Content-Type")).toBe(contentType);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(env.CLIENT_DOWNLOADS.get).toHaveBeenCalledWith(key);
  });

  it.each([
    "/downloads/webos/playarr-webos.ipk",
    "/downloads/tizen/playarr-tizen.wgt",
    "/downloads/roku/playarr-roku.zip",
  ])("returns a truthful unpublished response for %s", async (path) => {
    const response = await worker.fetch(
      new Request(`https://playarr.app${path}`),
      environment(null)
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.text()).resolves.toContain("has not been published yet");
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

describe("hosted cast receiver", () => {
  it("redirects the bare /cast path to the trailing-slash form", async () => {
    const env = environment(null);
    const response = await worker.fetch(new Request("https://playarr.app/cast"), env);

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/cast/");
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("serves the receiver's index.html for /cast/", async () => {
    const env = environment(null);
    const response = await worker.fetch(new Request("https://playarr.app/cast/"), env);

    expect(await response.text()).toBe("asset");
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    const requested = env.ASSETS.fetch.mock.calls[0][0];
    expect(new URL(requested.url).pathname).toBe("/cast/index.html");
  });

  it("passes through non-html cast assets unchanged", async () => {
    const env = environment(null);
    env.ASSETS.fetch.mockResolvedValueOnce(
      new Response("console.log('cast')", {
        headers: { "Content-Type": "application/javascript" },
      })
    );

    const response = await worker.fetch(
      new Request("https://playarr.app/cast/assets/receiver.js"),
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/javascript");
    expect(await response.text()).toBe("console.log('cast')");
  });

  it("turns the SPA fallback's html response into a real 404 for a missing cast asset", async () => {
    const env = environment(null);
    env.ASSETS.fetch.mockResolvedValueOnce(
      new Response("<html>web app shell</html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    );

    const response = await worker.fetch(
      new Request("https://playarr.app/cast/assets/missing.js"),
      env
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.not.toContain("web app shell");
  });
});

describe("hosted device linking", () => {
  it("allows packaged TV webviews to preflight and read link responses", async () => {
    const env = environment(null);
    const preflight = await worker.fetch(
      new Request("https://playarr.app/api/link/code", {
        method: "OPTIONS",
        headers: {
          Origin: "app://playarr",
          "Access-Control-Request-Headers": "content-type",
          "Access-Control-Request-Method": "POST",
        },
      }),
      env
    );

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();

    const created = await worker.fetch(
      new Request("https://playarr.app/api/link/code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "app://playarr",
        },
        body: JSON.stringify({ client_platform: "tv-webos" }),
      }),
      env
    );

    expect(created.status).toBe(200);
    expect(created.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(created.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8"
    );
  });

  it("keeps phone-side inspection and authorisation same-origin", async () => {
    const env = environment(null);
    const preflight = await worker.fetch(
      new Request("https://playarr.app/api/link/authorize", {
        method: "OPTIONS",
        headers: { Origin: "https://malicious.example" },
      }),
      env
    );

    expect(preflight.status).toBe(404);
    expect(preflight.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  it.each(["android-mobile", "android-tv", "ios", "web", "tv-webos", "tv-tizen", "tv-vidaa", "tv-roku", "tv-fire", "xbox"])(
    "preserves the %s client platform in the link session",
    async (clientPlatform) => {
      const env = environment(null);
      const created = await worker.fetch(
        new Request("https://playarr.app/api/link/code", {
          method: "POST",
          body: JSON.stringify({ client_platform: clientPlatform }),
        }),
        env
      );
      const code = await created.json();

      const inspection = await worker.fetch(
        new Request(
          `https://playarr.app/api/link/session?user_code=${encodeURIComponent(code.user_code)}`
        ),
        env
      );

      await expect(inspection.json()).resolves.toMatchObject({
        client_platform: clientPlatform,
      });
      expect(inspection.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  );

  it("rejects unsupported client platforms instead of rewriting their identity", async () => {
    const response = await worker.fetch(
      new Request("https://playarr.app/api/link/code", {
        method: "POST",
        body: JSON.stringify({ client_platform: "not-a-playarr-client" }),
      }),
      environment(null)
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_request",
    });
  });

  it("creates, authorises, and returns a one-time pairing claim", async () => {
    const env = environment(null);
    const created = await worker.fetch(
      new Request("https://playarr.app/api/link/code", {
        method: "POST",
        body: JSON.stringify({ client_platform: "android-tv" }),
      }),
      env
    );
    const code = await created.json();
    expect(code.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(code.expires_in).toBe(300);
    expect(code.verification_uri_complete).toContain(encodeURIComponent(code.user_code));

    const inspection = await worker.fetch(
      new Request(`https://playarr.app/api/link/session?user_code=${code.user_code}`),
      env
    );
    await expect(inspection.json()).resolves.toMatchObject({ client_platform: "android-tv" });

    const pending = await worker.fetch(
      new Request(`https://playarr.app/api/link/code/${encodeURIComponent(code.device_code)}`),
      env
    );
    expect(pending.status).toBe(202);

    const authorised = await worker.fetch(
      new Request("https://playarr.app/api/link/authorize", {
        method: "POST",
        body: JSON.stringify({
          user_code: code.user_code,
          server_url: "http://playarr.lan:8484",
          server_device_code: "server-secret-device-code",
          server_urls: ["http://playarr.lan:8484"],
        }),
      }),
      env
    );
    expect(authorised.status).toBe(200);

    const linked = await worker.fetch(
      new Request(`https://playarr.app/api/link/code/${encodeURIComponent(code.device_code)}`),
      env
    );
    await expect(linked.json()).resolves.toEqual({
      user_code: code.user_code,
      server_url: "http://playarr.lan:8484",
      server_device_code: "server-secret-device-code",
      server_urls: ["http://playarr.lan:8484"],
    });
  });

  it("lets the secret-holder collect a claim approved just before display expiry", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const env = environment(null);
      const created = await worker.fetch(
        new Request("https://playarr.app/api/link/code", {
          method: "POST",
          body: JSON.stringify({ client_platform: "web" }),
        }),
        env
      );
      const code = await created.json();

      now.mockReturnValue(300_999);
      const authorised = await worker.fetch(
        new Request("https://playarr.app/api/link/authorize", {
          method: "POST",
          body: JSON.stringify({
            user_code: code.user_code,
            server_url: "http://playarr.lan:8484",
            server_device_code: "server-secret-device-code",
            server_urls: ["http://playarr.lan:8484"],
          }),
        }),
        env
      );
      expect(authorised.status).toBe(200);

      now.mockReturnValue(301_001);
      const linked = await worker.fetch(
        new Request(
          `https://playarr.app/api/link/code/${encodeURIComponent(code.device_code)}`
        ),
        env
      );

      expect(linked.status).toBe(200);
      await expect(linked.json()).resolves.toMatchObject({
        server_device_code: "server-secret-device-code",
      });
    } finally {
      now.mockRestore();
    }
  });

  it("rejects polling without the high-entropy device secret", async () => {
    const env = environment(null);
    const response = await worker.fetch(
      new Request("https://playarr.app/api/link/code/ABCD2345.guessed"),
      env
    );
    expect(response.status).toBe(404);
  });

  it("rejects server claims containing URL credentials", async () => {
    const env = environment(null);
    const created = await worker.fetch(
      new Request("https://playarr.app/api/link/code", {
        method: "POST",
        body: JSON.stringify({ client_platform: "tv-tizen" }),
      }),
      env
    );
    const code = await created.json();
    const response = await worker.fetch(
      new Request("https://playarr.app/api/link/authorize", {
        method: "POST",
        body: JSON.stringify({
          user_code: code.user_code,
          server_url: "https://viewer:secret@playarr.example.com",
          server_device_code: "server-secret-device-code",
          server_urls: ["https://playarr.example.com"],
        }),
      }),
      env
    );

    expect(response.status).toBe(400);
  });
});

describe("link QR code", () => {
  it("renders a decodable PNG for a playarr.app link URL", async () => {
    const env = environment(null);
    const value = "https://playarr.app/link?user_code=ABCD-1234";
    const response = await worker.fetch(
      new Request(`https://playarr.app/api/link/qr?value=${encodeURIComponent(value)}`),
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const bytes = new Uint8Array(await response.arrayBuffer());
    // PNG signature: 0x89 'P' 'N' 'G' \r \n 0x1A \n
    expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // Content box is 216 CSS px at 2× = 432 (matches .device-login-qr inner).
    // PNG IHDR width is big-endian at bytes 16..19.
    const width =
      (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    expect(width).toBe(432);
  });

  it("refuses to encode arbitrary text", async () => {
    const env = environment(null);
    const response = await worker.fetch(
      new Request(
        `https://playarr.app/api/link/qr?value=${encodeURIComponent("https://evil.example/phish")}`
      ),
      env
    );

    expect(response.status).toBe(400);
  });

  it("refuses to encode without a value", async () => {
    const env = environment(null);
    const response = await worker.fetch(new Request("https://playarr.app/api/link/qr"), env);

    expect(response.status).toBe(400);
  });
});

// Mirrors the actual multi-line meta tag formatting in index.html (Prettier
// wraps a tag's attributes onto their own lines once it has more than one),
// so these tests prove the rewriter's regexes work against the real
// template shape, not just a conveniently single-line stand-in for it.
const SAMPLE_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Playarr</title>
    <meta
      name="description"
      content="Playarr is a self-hosted media server. Your library, every screen."
    />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Playarr" />
    <meta
      property="og:description"
      content="Playarr is a self-hosted media server. Your library, every screen."
    />
    <meta property="og:url" content="https://playarr.app/" />
    <meta property="og:image" content="https://playarr.app/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Playarr" />
    <meta
      name="twitter:description"
      content="Playarr is a self-hosted media server. Your library, every screen."
    />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

describe("client page meta tags", () => {
  it("rewrites the title and every description/og/twitter tag for a known client", async () => {
    const env = environment(null);
    env.ASSETS.fetch.mockResolvedValueOnce(
      new Response(SAMPLE_INDEX_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    );

    const response = await worker.fetch(new Request("https://playarr.app/clients/roku"), env);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(html).toContain("<title>Playarr for Roku</title>");
    expect(html).toContain(
      'content="Sideload the Playarr channel on Roku televisions."'
    );
    expect(html).toContain('content="Playarr for Roku"');
    expect(html).toContain('content="https://playarr.app/clients/roku"');
    // og:type/og:image and every other untouched tag survive unchanged.
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html).toContain('content="https://playarr.app/og-image.png"');
    // The generic copy this replaced is gone, not just supplemented.
    expect(html).not.toContain("Playarr is a self-hosted media server");
  });

  it("requests the actual incoming path, not a hardcoded index.html", async () => {
    // Cloudflare's static-asset serving auto-redirects (307) an explicit,
    // literal "/index.html" request to "/" -- confirmed directly against
    // the deployed site, and the exact bug that made every /clients/* page
    // redirect to the homepage. A path that doesn't correspond to a real
    // file (every /clients/* path) instead takes the SPA fallback and
    // returns the real content with no redirect, so the fetched request
    // must preserve the actual incoming path.
    const env = environment(null);
    env.ASSETS.fetch.mockResolvedValueOnce(
      new Response(SAMPLE_INDEX_HTML, { headers: { "Content-Type": "text/html" } })
    );

    await worker.fetch(new Request("https://playarr.app/clients/xbox"), env);

    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    const requested = env.ASSETS.fetch.mock.calls[0][0];
    expect(new URL(requested.url).pathname).toBe("/clients/xbox");
  });

  it("strips a trailing slash so the id still matches a real client", async () => {
    const env = environment(null);
    env.ASSETS.fetch.mockResolvedValueOnce(
      new Response(SAMPLE_INDEX_HTML, { headers: { "Content-Type": "text/html" } })
    );

    const response = await worker.fetch(
      new Request("https://playarr.app/clients/roku/"),
      env
    );
    const html = await response.text();

    expect(html).toContain("<title>Playarr for Roku</title>");
    expect(html).toContain('content="https://playarr.app/clients/roku"');
  });

  it("drops the original Content-Length and Content-Encoding, which no longer match the rewritten body", async () => {
    const env = environment(null);
    env.ASSETS.fetch.mockResolvedValueOnce(
      new Response(SAMPLE_INDEX_HTML, {
        headers: {
          "Content-Type": "text/html",
          "Content-Length": String(SAMPLE_INDEX_HTML.length),
          "Content-Encoding": "br",
        },
      })
    );

    const response = await worker.fetch(new Request("https://playarr.app/clients/roku"), env);

    expect(response.headers.get("Content-Length")).toBeNull();
    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(response.headers.get("Content-Type")).toBe("text/html");
  });

  it("leaves the generic shell untouched for an id that isn't a real client", async () => {
    const env = environment(null);
    env.ASSETS.fetch.mockResolvedValueOnce(
      new Response(SAMPLE_INDEX_HTML, { headers: { "Content-Type": "text/html" } })
    );

    const response = await worker.fetch(
      new Request("https://playarr.app/clients/not-a-real-client"),
      env
    );
    const html = await response.text();

    expect(html).toBe(SAMPLE_INDEX_HTML);
  });

  it("gives the bare /clients index the first client's meta tags, matching where it redirects", async () => {
    const env = environment(null);
    env.ASSETS.fetch.mockResolvedValueOnce(
      new Response(SAMPLE_INDEX_HTML, { headers: { "Content-Type": "text/html" } })
    );

    const response = await worker.fetch(new Request("https://playarr.app/clients"), env);
    const html = await response.text();

    expect(html).toContain("<title>Playarr for Hisense VIDAA</title>");
    expect(html).toContain('content="https://playarr.app/clients/vidaa"');
  });
});
