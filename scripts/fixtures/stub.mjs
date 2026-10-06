#!/usr/bin/env node
// Local stand-in for Sonarr, Radarr and Dubarr, serving the fixture catalogue.
// One listener, three path prefixes: /sonarr, /radarr, /dubarr. Loopback only.
// Usage: node stub.mjs <media-dir> <port> <api-key>
import http from "node:http";
import { createReadStream, statSync } from "node:fs";
import { basename, join } from "node:path";
import { SERIES, MOVIES, episodeRelPath, movieRelPath, dubRelPath, LANG_NAME } from "./catalog.mjs";

const [root, portArg, apiKey] = process.argv.slice(2);
if (!root || !portArg || !apiKey) {
  console.error("usage: stub.mjs <media-dir> <port> <api-key>");
  process.exit(2);
}
const port = Number(portArg);
const names = (langs) => langs.map((l) => LANG_NAME[l]).join("/");
const quality = { quality: { id: 7, name: "Bluray-1080p", source: "bluray", resolution: 1080 }, revision: { version: 1, real: 0, isRepack: false } };
const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

function mediaInfo(codec, audio, subs) {
  return {
    audioCodec: "AAC",
    audioBitrate: 48000,
    audioChannels: 1,
    videoCodec: codec === "hevc" ? "x265" : "x264",
    videoBitrate: 300000,
    resolution: "320x180",
    runTime: "0:00:06",
    audioLanguages: names(audio),
    subtitles: names(subs),
  };
}

// Build the in-memory *arr views once; ids are stable across restarts.
const sonarr = SERIES.map((s) => {
  let epId = s.id * 1000;
  let fileId = s.id * 1000;
  const episodes = [];
  const files = [];
  for (const sn of s.seasons) {
    for (let e = 1; e <= sn.episodes; e++) {
      const rel = episodeRelPath(s, sn.season, e);
      const abs = join(root, rel);
      const size = statSync(abs).size;
      epId++;
      fileId++;
      episodes.push({ id: epId, seriesId: s.id, seasonNumber: sn.season, episodeNumber: e, title: `Episode ${e}`, overview: "Placeholder episode.", airDate: `${s.year + sn.season - 1}-01-0${e}`, runtime: 1, images: [], hasFile: true, monitored: true, episodeFileId: fileId });
      files.push({ id: fileId, seriesId: s.id, seasonNumber: sn.season, relativePath: rel.split("/").slice(2).join("/"), path: abs, size, quality, mediaInfo: mediaInfo(sn.codec, s.audio, s.subtitles) });
    }
  }
  if (s.upcoming) {
    epId++;
    episodes.push({ id: epId, seriesId: s.id, seasonNumber: s.upcoming.season, episodeNumber: s.upcoming.episode, title: "Upcoming episode", overview: "Placeholder upcoming episode.", airDate: isoDay(s.upcoming.inDays), runtime: 1, images: [], hasFile: false, monitored: true, episodeFileId: 0 });
  }
  const series = {
    id: s.id, title: s.title, sortTitle: s.title.toLowerCase(), tvdbId: s.tvdbId, monitored: true, status: "continuing",
    path: join(root, "tv", `${s.title} (${s.year})`), overview: "Placeholder series.", genres: s.genres, images: [],
    firstAired: `${s.year}-01-01T00:00:00Z`, certification: s.certification, ratings: { value: 7.5, votes: 100 },
    statistics: { episodeFileCount: files.length },
  };
  return { series, episodes, files };
});

const radarr = MOVIES.map((m) => {
  const abs = join(root, movieRelPath(m));
  const file = { id: m.id, movieId: m.id, relativePath: basename(abs), path: abs, size: statSync(abs).size, quality, mediaInfo: mediaInfo(m.codec, m.audio, m.subtitles) };
  return {
    id: m.id, title: m.title, sortTitle: m.title.toLowerCase(), tmdbId: m.tmdbId, monitored: true, hasFile: true,
    path: join(root, "movies", `${m.title} (${m.year})`), runtime: 1, movieFile: file, overview: "Placeholder film.",
    genres: m.genres, images: [], digitalRelease: `${m.year}-06-01T00:00:00Z`, year: m.year, certification: m.certification,
  };
});

const dubTracks = MOVIES.filter((m) => m.dub).map((m) => {
  const abs = join(root, dubRelPath(m));
  return {
    id: m.dub.id, language: m.dub.language, vendor: "fixture", codec: "aac", channels: 1, bitrateKbps: 48, durationMs: 6000,
    sizeBytes: statSync(abs).size, title: m.dub.title, mediaPath: join(root, movieRelPath(m)), checksum: "",
    downloadUrl: `/api/v1/tracks/${m.dub.id}/download`, _file: abs,
  };
});
const publicTrack = ({ _file, ...rest }) => rest;

const send = (res, status, body, headers = {}) => {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(text);
};

function sendFileRanged(req, res, file, type) {
  const size = statSync(file).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (!range) {
    res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes" });
    return createReadStream(file).pipe(res);
  }
  const start = range[1] === "" ? Math.max(0, size - Number(range[2])) : Number(range[1]);
  const end = range[1] !== "" && range[2] !== "" ? Math.min(Number(range[2]), size - 1) : size - 1;
  res.writeHead(206, { "content-type": type, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes" });
  createReadStream(file, { start, end }).pipe(res);
}

function handle(req, res) {
  const url = new URL(req.url, "http://stub");
  const q = url.searchParams;
  if (url.pathname === "/healthz") return send(res, 200, { ok: true });
  if (req.headers["x-api-key"] !== apiKey) return send(res, 401, { error: "bad api key" });
  const [, app, ...rest] = url.pathname.split("/");
  const path = "/" + rest.join("/");

  if (app === "sonarr") {
    if (path === "/api/v3/system/status") return send(res, 200, { appName: "Sonarr", version: "4.0.0-fixture" });
    if (path === "/api/v3/rootfolder") return send(res, 200, [{ id: 1, path: join(root, "tv"), accessible: true }]);
    if (path === "/api/v3/series") return send(res, 200, sonarr.map((s) => s.series));
    const one = /^\/api\/v3\/series\/(\d+)$/.exec(path);
    if (one) {
      const hit = sonarr.find((s) => s.series.id === Number(one[1]));
      return hit ? send(res, 200, hit.series) : send(res, 404, {});
    }
    const sid = Number(q.get("seriesId"));
    if (path === "/api/v3/episode") return send(res, 200, sonarr.find((s) => s.series.id === sid)?.episodes ?? []);
    if (path === "/api/v3/episodefile") return send(res, 200, sonarr.find((s) => s.series.id === sid)?.files ?? []);
    if (path === "/api/v3/calendar") {
      const [start, end] = [q.get("start") ?? "0000", q.get("end") ?? "9999"];
      const out = sonarr.flatMap((s) =>
        s.episodes.filter((e) => e.airDate >= start.slice(0, 10) && e.airDate <= end.slice(0, 10))
          .map((e) => ({ ...e, airDateUtc: `${e.airDate}T01:00:00Z`, series: { id: s.series.id, title: s.series.title, tvdbId: s.series.tvdbId, images: [] } })));
      return send(res, 200, out);
    }
    return send(res, 404, { error: `fixture stub: no route ${path}` });
  }
  if (app === "radarr") {
    if (path === "/api/v3/system/status") return send(res, 200, { appName: "Radarr", version: "5.0.0-fixture" });
    if (path === "/api/v3/rootfolder") return send(res, 200, [{ id: 1, path: join(root, "movies"), accessible: true }]);
    if (path === "/api/v3/movie") return send(res, 200, radarr);
    const one = /^\/api\/v3\/movie\/(\d+)$/.exec(path);
    if (one) {
      const hit = radarr.find((m) => m.id === Number(one[1]));
      return hit ? send(res, 200, hit) : send(res, 404, {});
    }
    if (path === "/api/v3/calendar") return send(res, 200, []);
    if (path === "/api/v3/credit") return send(res, 200, []);
    return send(res, 404, { error: `fixture stub: no route ${path}` });
  }
  if (app === "dubarr") {
    if (path === "/api/v1/system/status") return send(res, 200, { appName: "Dubarr", version: "0.0.0-fixture" });
    if (path === "/api/v1/tracks") {
      const p = q.get("path");
      const hits = p ? dubTracks.filter((t) => p === t.mediaPath || p.endsWith(basename(t.mediaPath))) : q.get("id") ? dubTracks.filter((t) => String(MOVIES.find((m) => m.dub?.id === t.id)?.id) === q.get("id")) : [];
      return send(res, 200, hits.map(publicTrack));
    }
    if (path === "/api/v1/tracks/changes") return send(res, 200, { cursor: 0, changes: [] });
    const dl = /^\/api\/v1\/tracks\/([^/]+)\/download$/.exec(path);
    if (dl) {
      const t = dubTracks.find((x) => x.id === dl[1]);
      return t ? sendFileRanged(req, res, t._file, "audio/mp4") : send(res, 404, {});
    }
    return send(res, 404, { error: `fixture stub: no route ${path}` });
  }
  return send(res, 404, { error: "unknown app prefix" });
}

http.createServer(handle).listen(port, "127.0.0.1", () => console.log(`fixture stub listening on 127.0.0.1:${port}`));
