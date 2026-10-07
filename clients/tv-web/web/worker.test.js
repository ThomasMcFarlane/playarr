import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { LinkSession } from "./worker.js";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, value); }
  async setAlarm() {}
  async deleteAll() { this.values.clear(); }
}

function environment() {
  const sessions = new Map();
  return {
    ASSETS: { fetch: vi.fn(async () => new Response("asset")) },
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

const RELEASES = "https://github.com/ThomasMcFarlane/playarr/releases";

function releaseEnv(releases) {
  const list = releases ?? [
    { tag_name: "android-v0.4.0-rc.1", prerelease: true },
    { tag_name: "backend-v0.4.0", prerelease: false },
    { tag_name: "android-v0.3.1", prerelease: false },
    { tag_name: "android-v0.3.0", prerelease: false },
  ];
  const fetchMock = vi.fn(async (url) =>
    String(url).startsWith("https://api.github.com/")
      ? new Response(JSON.stringify(list), { status: 200 })
      : new Response("{}", { status: 200 })
  );
  vi.stubGlobal("fetch", fetchMock);
  return { env: environment(), fetchMock };
}

afterEach(() => vi.unstubAllGlobals());

describe("client package downloads", () => {
  it("redirects the latest Android APK to the newest stable android release asset", async () => {
    const { env, fetchMock } = releaseEnv();
    const response = await worker.fetch(
      new Request("https://playarr.app/downloads/android/playarr-android.apk"),
      env
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      `${RELEASES}/download/android-v0.3.1/playarr-android.apk`
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns a clear 404 when no stable android release exists", async () => {
    const { env } = releaseEnv([{ tag_name: "backend-v1.0.0", prerelease: false }]);
    const response = await worker.fetch(
      new Request("https://playarr.app/downloads/android/playarr-android.apk"),
      env
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toContain("not been published");
  });

  it("proxies the latest Android manifest and redirects versioned APKs to their tag", async () => {
    const { env, fetchMock } = releaseEnv();
    const manifest = await worker.fetch(
      new Request("https://playarr.app/downloads/android/playarr-android.json"),
      env
    );
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${RELEASES}/download/android-v0.3.1/playarr-android.json`,
      expect.anything()
    );

    const apk = await worker.fetch(
      new Request(
        "https://playarr.app/downloads/android/releases/1.2.3/playarr-android.apk"
      ),
      env
    );
    expect(apk.status).toBe(302);
    expect(apk.headers.get("Location")).toBe(
      `${RELEASES}/download/v1.2.3/playarr-android.apk`
    );
  });

  it("redirects a versioned APK to its android-v release when no v release has it", async () => {
    const fetchMock = vi.fn(async (url) =>
      String(url).includes("/download/v1.2.3/")
        ? new Response("Not Found", { status: 404 })
        : new Response("", { status: 302 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const env = environment();
    const apk = await worker.fetch(
      new Request("https://playarr.app/downloads/android/releases/1.2.3/SHA256SUMS"),
      env
    );
    expect(apk.status).toBe(302);
    expect(apk.headers.get("Location")).toBe(`${RELEASES}/download/android-v1.2.3/SHA256SUMS`);
  });

  it("prefers the newest all-platform v release that carries the asset", async () => {
    const { env } = releaseEnv([
      { tag_name: "v0.6.0", prerelease: false, assets: [{ name: "latest.json" }] },
      {
        tag_name: "v0.5.0",
        prerelease: false,
        assets: [
          { name: "playarr-android.apk" },
          { name: "playarr-android.json" },
          { name: "latest.json" },
          { name: "playarr-server-0.5.0-linux-arm64.tar.gz" },
        ],
      },
      { tag_name: "backend-v0.4.0", prerelease: false },
      { tag_name: "android-v0.3.1", prerelease: false },
    ]);
    const get = async (path) => worker.fetch(new Request(`https://playarr.app${path}`), env);

    const apk = await get("/downloads/android/playarr-android.apk");
    expect(apk.headers.get("Location")).toBe(`${RELEASES}/download/v0.5.0/playarr-android.apk`);

    const tarball = await get("/downloads/server/playarr-server-linux-arm64.tar.gz");
    expect(tarball.headers.get("Location")).toBe(
      `${RELEASES}/download/v0.5.0/playarr-server-0.5.0-linux-arm64.tar.gz`
    );

    const manifest = await get("/downloads/server/latest.json");
    expect(manifest.status).toBe(200);
    expect(fetch).toHaveBeenLastCalledWith(
      `${RELEASES}/download/v0.6.0/latest.json`,
      expect.anything()
    );
  });

  it.each([
    ["/downloads/roku/playarr-roku.zip", "playarr-roku-0.5.0.zip"],
    ["/downloads/webos/playarr-webos.ipk", "playarr-webos-0.5.0.ipk"],
    ["/downloads/tizen/playarr-tizen.wgt", "playarr-tizen-0.5.0.wgt"],
  ])("redirects %s to the newest v release that carries %s", async (path, asset) => {
    const { env } = releaseEnv([
      { tag_name: "v0.6.0", prerelease: false, assets: [{ name: "latest.json" }] },
      { tag_name: "v0.5.0", prerelease: false, assets: [{ name: asset }] },
      { tag_name: "android-v0.4.0", prerelease: false },
    ]);
    const response = await worker.fetch(new Request(`https://playarr.app${path}`), env);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${RELEASES}/download/v0.5.0/${asset}`);
  });

  it.each([
    "/downloads/webos/playarr-webos.ipk",
    "/downloads/tizen/playarr-tizen.wgt",
    "/downloads/roku/playarr-roku.zip",
  ])("returns a truthful unpublished response for %s", async (path) => {
    // A release without the package (for example Tizen, which needs the owner's signing profile).
    const { env } = releaseEnv([{ tag_name: "v0.5.0", prerelease: false, assets: [{ name: "latest.json" }] }]);
    const response = await worker.fetch(new Request(`https://playarr.app${path}`), env);

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.text()).resolves.toContain("has not been published yet");
  });

  it("redirects Playarr Server tarballs and checksums to GitHub Release assets", async () => {
    const { env } = releaseEnv();
    const get = async (path) =>
      worker.fetch(new Request(`https://playarr.app${path}`), env);

    const stable = await get("/downloads/server/playarr-server-linux-arm64.tar.gz");
    expect(stable.status).toBe(302);
    expect(stable.headers.get("Location")).toBe(
      `${RELEASES}/download/backend-v0.4.0/playarr-server-0.4.0-linux-arm64.tar.gz`
    );

    const sha = await get("/downloads/server/playarr-server-linux-amd64.tar.gz.sha256");
    expect(sha.headers.get("Location")).toBe(
      `${RELEASES}/download/backend-v0.4.0/playarr-server-0.4.0-linux-amd64.tar.gz.sha256`
    );

    const manifest = await get("/downloads/server/latest.json");
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get("Content-Type")).toBe("application/json; charset=utf-8");

    const versioned = await get(
      "/downloads/server/playarr-server-0.1.0-linux-amd64.tar.gz"
    );
    expect(versioned.headers.get("Location")).toBe(
      `${RELEASES}/download/v0.1.0/playarr-server-0.1.0-linux-amd64.tar.gz`
    );
    const sums = await get("/downloads/server/playarr-server-0.2.0-rc.1-SHA256SUMS");
    expect(sums.headers.get("Location")).toBe(
      `${RELEASES}/download/v0.2.0-rc.1/playarr-server-0.2.0-rc.1-SHA256SUMS`
    );
  });

  describe("no published release", () => {
    function noRelease(list = []) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) =>
          String(url).startsWith("https://api.github.com/")
            ? new Response(JSON.stringify(list), { status: 200 })
            : new Response("Not Found", { status: 404 })
        )
      );
    }

    it.each([
      "/downloads/android/playarr-android.apk",
      "/downloads/android/playarr-android.json",
      "/downloads/android/releases/1.2.3/playarr-android.apk",
      "/downloads/android/releases/1.2.3/SHA256SUMS",
      "/downloads/server/latest.json",
      "/downloads/server/playarr-server-linux-amd64.tar.gz",
      "/downloads/server/playarr-server-linux-arm64.tar.gz.sha256",
      "/downloads/server/playarr-server-0.1.0-linux-amd64.tar.gz",
      "/downloads/server/playarr-server-0.1.0-SHA256SUMS",
    ])("returns 404 for %s", async (path) => {
      noRelease();
      const response = await worker.fetch(new Request(`https://playarr.app${path}`), environment());

      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(response.text()).resolves.toContain("has not been published yet");
    });

    it("returns 404 when the tag exists but the asset does not", async () => {
      noRelease([{ tag_name: "android-v0.3.1", prerelease: false }]);
      const response = await worker.fetch(
        new Request("https://playarr.app/downloads/android/playarr-android.json"),
        environment()
      );
      expect(response.status).toBe(404);
    });

    it("returns 404 when GitHub cannot be reached", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
      const response = await worker.fetch(
        new Request("https://playarr.app/downloads/android/playarr-android.apk"),
        environment()
      );
      expect(response.status).toBe(404);
    });
  });

  it("does not expose other download paths", async () => {
    const env = environment();
    for (const path of [
      "/downloads/server/releases/0.1.0/anything",
      "/downloads/server/playarr-server-0.1.0-linux-riscv.tar.gz",
      "/downloads/server/playarr-server-..%2F..-linux-amd64.tar.gz",
    ]) {
      await worker.fetch(new Request(`https://playarr.app${path}`), env);
    }
    // Not release download paths: handed to static assets, never to GitHub.
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(3);
  });

  it("does not expose arbitrary download paths", async () => {
    const env = environment();
    await worker.fetch(
      new Request("https://playarr.app/downloads/android/releases/latest/private-key"),
      env
    );
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
  });

  it("delegates ordinary application routes to static assets", async () => {
    const env = environment();
    const response = await worker.fetch(new Request("https://playarr.app/clients"), env);

    expect(await response.text()).toBe("asset");
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
  });
});

describe("hosted cast receiver", () => {
  it("redirects the bare /cast path to the trailing-slash form", async () => {
    const env = environment();
    const response = await worker.fetch(new Request("https://playarr.app/cast"), env);

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/cast/");
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("serves the receiver's index.html for /cast/", async () => {
    const env = environment();
    const response = await worker.fetch(new Request("https://playarr.app/cast/"), env);

    expect(await response.text()).toBe("asset");
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    const requested = env.ASSETS.fetch.mock.calls[0][0];
    expect(new URL(requested.url).pathname).toBe("/cast/index.html");
  });

  it("passes through non-html cast assets unchanged", async () => {
    const env = environment();
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
    const env = environment();
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
    const env = environment();
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

  it("lets a server-hosted page (plain http) inspect and authorise a link", async () => {
    const env = environment();
    const preflight = await worker.fetch(
      new Request("https://playarr.app/api/link/authorize", {
        method: "OPTIONS",
        headers: {
          Origin: "http://192.0.2.10:8484",
          "Access-Control-Request-Headers": "content-type",
          "Access-Control-Request-Method": "POST",
        },
      }),
      env
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const inspection = await worker.fetch(
      new Request("https://playarr.app/api/link/session?user_code=ABCD-2345", {
        headers: { Origin: "http://192.0.2.10:8484" },
      }),
      env
    );
    expect(inspection.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("still answers 404 for unknown link paths without CORS", async () => {
    const preflight = await worker.fetch(
      new Request("https://playarr.app/api/link/other", {
        method: "OPTIONS",
        headers: { Origin: "https://malicious.example" },
      }),
      environment()
    );
    expect(preflight.status).toBe(404);
    expect(preflight.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  it.each(["android-mobile", "android-tv", "ios", "web", "tv-webos", "tv-tizen", "tv-vidaa", "tv-roku", "tv-fire", "xbox"])(
    "preserves the %s client platform in the link session",
    async (clientPlatform) => {
      const env = environment();
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
      expect(inspection.headers.get("Access-Control-Allow-Origin")).toBe("*");
    }
  );

  it("rejects unsupported client platforms instead of rewriting their identity", async () => {
    const response = await worker.fetch(
      new Request("https://playarr.app/api/link/code", {
        method: "POST",
        body: JSON.stringify({ client_platform: "not-a-playarr-client" }),
      }),
      environment()
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_request",
    });
  });

  it("creates, authorises, and returns a one-time pairing claim", async () => {
    const env = environment();
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
      const env = environment();
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
    const env = environment();
    const response = await worker.fetch(
      new Request("https://playarr.app/api/link/code/ABCD2345.guessed"),
      env
    );
    expect(response.status).toBe(404);
  });

  it("rejects server claims containing URL credentials", async () => {
    const env = environment();
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
    const env = environment();
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
    const env = environment();
    const response = await worker.fetch(
      new Request(
        `https://playarr.app/api/link/qr?value=${encodeURIComponent("https://evil.example/phish")}`
      ),
      env
    );

    expect(response.status).toBe(400);
  });

  it("refuses to encode without a value", async () => {
    const env = environment();
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
    const env = environment();
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
    const env = environment();
    env.ASSETS.fetch.mockResolvedValueOnce(
      new Response(SAMPLE_INDEX_HTML, { headers: { "Content-Type": "text/html" } })
    );

    await worker.fetch(new Request("https://playarr.app/clients/xbox"), env);

    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    const requested = env.ASSETS.fetch.mock.calls[0][0];
    expect(new URL(requested.url).pathname).toBe("/clients/xbox");
  });

  it("strips a trailing slash so the id still matches a real client", async () => {
    const env = environment();
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
    const env = environment();
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
    const env = environment();
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
    const env = environment();
    env.ASSETS.fetch.mockResolvedValueOnce(
      new Response(SAMPLE_INDEX_HTML, { headers: { "Content-Type": "text/html" } })
    );

    const response = await worker.fetch(new Request("https://playarr.app/clients"), env);
    const html = await response.text();

    expect(html).toContain("<title>Playarr for Hisense VIDAA</title>");
    expect(html).toContain('content="https://playarr.app/clients/vidaa"');
  });
});

describe("public legal page meta tags", () => {
  it("serves the privacy route anonymously with privacy-specific metadata", async () => {
    const env = environment();
    env.ASSETS.fetch.mockResolvedValueOnce(
      new Response(SAMPLE_INDEX_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    );

    const response = await worker.fetch(
      new Request("https://playarr.app/legal/privacy"),
      env
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("<title>Privacy policy · Playarr</title>");
    expect(html).toContain(
      'content="How the Playarr Android app, web app, self-hosted server and public linking service handle data."'
    );
    expect(html).toContain('content="https://playarr.app/legal/privacy"');
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
  });

  it("normalises a trailing slash to the canonical legal URL", async () => {
    const env = environment();
    env.ASSETS.fetch.mockResolvedValueOnce(
      new Response(SAMPLE_INDEX_HTML, { headers: { "Content-Type": "text/html" } })
    );

    const response = await worker.fetch(
      new Request("https://playarr.app/legal/terms/"),
      env
    );
    const html = await response.text();

    expect(html).toContain("<title>Terms of use · Playarr</title>");
    expect(html).toContain('content="https://playarr.app/legal/terms"');
  });

  it("serves account-deletion guidance with a canonical public URL", async () => {
    const env = environment();
    env.ASSETS.fetch.mockResolvedValueOnce(
      new Response(SAMPLE_INDEX_HTML, { headers: { "Content-Type": "text/html" } })
    );

    const response = await worker.fetch(
      new Request("https://playarr.app/legal/account-deletion"),
      env
    );
    const html = await response.text();

    expect(html).toContain("<title>Account deletion · Playarr</title>");
    expect(html).toContain('content="https://playarr.app/legal/account-deletion"');
  });
});
