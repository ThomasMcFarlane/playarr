const DOWNLOADS = new Map([
  ["/downloads/android/playarr-android.apk", "android/playarr-android.apk"],
  ["/downloads/android/playarr-android.json", "android/playarr-android.json"],
]);

const VERSIONED_ANDROID_DOWNLOAD =
  /^\/downloads\/android\/releases\/(\d+\.\d+\.\d+)\/(playarr-android\.apk|SHA256SUMS)$/;

function downloadKey(pathname) {
  const stableKey = DOWNLOADS.get(pathname);
  if (stableKey) return stableKey;
  const versioned = pathname.match(VERSIONED_ANDROID_DOWNLOAD);
  return versioned ? `android/releases/${versioned[1]}/${versioned[2]}` : undefined;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = downloadKey(url.pathname);
    if (!key) return env.ASSETS.fetch(request);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    const object = await env.CLIENT_DOWNLOADS.get(key);
    if (!object) {
      return new Response("This Android release has not been published yet.", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const filename = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
    const isApk = filename.endsWith(".apk");
    const isJson = filename.endsWith(".json");
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set(
      "Cache-Control",
      VERSIONED_ANDROID_DOWNLOAD.test(url.pathname)
        ? "public, max-age=31536000, immutable"
        : "public, max-age=300"
    );
    headers.set(
      "Content-Disposition",
      `${isApk ? "attachment" : "inline"}; filename="${filename}"`
    );
    headers.set("Content-Length", String(object.size));
    headers.set(
      "Content-Type",
      isApk
        ? "application/vnd.android.package-archive"
        : isJson
          ? "application/json; charset=utf-8"
          : "text/plain; charset=utf-8"
    );
    headers.set("ETag", object.httpEtag);
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(request.method === "HEAD" ? null : object.body, { headers });
  },
};
