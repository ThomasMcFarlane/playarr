// Minimal stand-in for Radarr and Sonarr serving the open-movie showcase catalogue (scripts/showcase).
// usage: node mock-arr.mjs <radarr|sonarr> <port> <catalog.json> <art-dir> <api-key>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const [kind, port, catalogPath, artDir, key] = process.argv.slice(2);
const cat = JSON.parse(fs.readFileSync(catalogPath, "utf8"))[kind];
const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "content-type": type });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const byId = (arr, id) => arr.find((x) => String(x.id) === id);

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;
  const q = u.searchParams;
  if (p.startsWith("/art/")) {
    const f = path.join(artDir, path.basename(p));
    if (!fs.existsSync(f)) return send(res, 404, "not found", "text/plain");
    const png = path.extname(f) === ".png";
    return send(res, 200, fs.readFileSync(f), png ? "image/png" : "image/jpeg");
  }
  if (req.headers["x-api-key"] !== key) return send(res, 401, { error: "unauthorized" });
  if (!p.startsWith("/api/v3")) return send(res, 404, {});
  const r = p.slice("/api/v3".length);
  if (r === "/system/status") return send(res, 200, { appName: kind, version: "0.0.0-showcase" });
  if (r === "/rootfolder") return send(res, 200, cat.rootfolders);
  if (r === "/calendar" || r === "/credit") return send(res, 200, []);
  let m;
  if (kind === "radarr") {
    if (r === "/movie") return send(res, 200, cat.movies);
    if ((m = r.match(/^\/movie\/(\d+)$/))) {
      const x = byId(cat.movies, m[1]);
      return x ? send(res, 200, x) : send(res, 404, {});
    }
  } else {
    if (r === "/series") return send(res, 200, cat.series);
    if ((m = r.match(/^\/series\/(\d+)$/))) {
      const x = byId(cat.series, m[1]);
      return x ? send(res, 200, x) : send(res, 404, {});
    }
    if (r === "/episode") return send(res, 200, cat.episodes.filter((e) => String(e.seriesId) === q.get("seriesId")));
    if (r === "/episodefile") return send(res, 200, cat.episodefiles.filter((e) => String(e.seriesId) === q.get("seriesId")));
  }
  console.log("unhandled", req.method, req.url);
  send(res, 404, {});
}).listen(Number(port), "127.0.0.1", () => console.log(kind, "listening", port));
