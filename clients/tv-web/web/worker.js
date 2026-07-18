const DOWNLOADS = new Map([
  [
    "/downloads/android/playarr-android-mobile.apk",
    "android/playarr-android-mobile.apk",
  ],
  [
    "/downloads/android/playarr-android-tv.apk",
    "android/playarr-android-tv.apk",
  ],
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = DOWNLOADS.get(url.pathname);
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
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Cache-Control", "public, max-age=300");
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);
    headers.set("Content-Length", String(object.size));
    headers.set("Content-Type", "application/vnd.android.package-archive");
    headers.set("ETag", object.httpEtag);

    return new Response(request.method === "HEAD" ? null : object.body, { headers });
  },
};
