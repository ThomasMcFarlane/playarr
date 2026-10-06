// Fixture catalogue: the single source of truth for the placeholder media, the
// stub Sonarr/Radarr/Dubarr responses and the expectations in verify.mjs.
// Placeholder names only: never put a real title in this file.

export const SERIES = [
  {
    id: 1,
    title: "Sample Series 1",
    year: 2019,
    tvdbId: 900001,
    certification: "TV-Y7",
    genres: ["Animation"],
    seasons: [
      { season: 1, codec: "h264", episodes: 3 },
      { season: 2, codec: "hevc", episodes: 2 },
      { season: 3, codec: "h264", episodes: 2 },
    ],
    // One episode with no file yet and an air date relative to "today", so the
    // calendar has an upcoming item (see `upcomingEpisode`).
    upcoming: { season: 3, episode: 3, inDays: 3 },
    audio: ["eng", "fra"],
    subtitles: ["eng"],
  },
  {
    id: 2,
    title: "Sample Series 2",
    year: 2021,
    tvdbId: 900002,
    certification: "TV-MA",
    genres: ["Drama"],
    seasons: [{ season: 1, codec: "h264", episodes: 2 }],
    audio: ["eng", "jpn"],
    subtitles: ["eng"],
  },
];

export const MOVIES = [
  {
    id: 1,
    title: "Test Movie A",
    year: 2020,
    tmdbId: 800001,
    certification: "PG",
    genres: ["Adventure"],
    codec: "h264",
    audio: ["eng", "fra", "spa"],
    subtitles: ["eng", "fra"],
    // Alternate-audio dub served by the Dubarr stub.
    dub: { id: "dub-movie-a-deu", language: "deu", title: "Test Movie A (German dub)" },
  },
  {
    id: 2,
    title: "Test Movie B",
    year: 2021,
    tmdbId: 800002,
    certification: "R",
    genres: ["Thriller"],
    codec: "hevc",
    audio: ["eng", "jpn"],
    subtitles: ["eng"],
  },
  {
    id: 3,
    title: "Test Movie C",
    year: 2022,
    tmdbId: 800003,
    certification: "G",
    genres: ["Family"],
    codec: "h264",
    audio: ["eng"],
    subtitles: [],
    sidecarSubtitles: ["spa"],
  },
];

// Per-language tone so each audio track is audibly distinct.
export const TONE_HZ = { eng: 440, fra: 523, spa: 587, jpn: 659, deu: 698 };
export const LANG_NAME = { eng: "English", fra: "French", spa: "Spanish", jpn: "Japanese", deu: "German" };

const pad = (n) => String(n).padStart(2, "0");

export function movieRelPath(m) {
  return `movies/${m.title} (${m.year})/${m.title} (${m.year}).mkv`;
}

export function episodeRelPath(s, season, episode) {
  return `tv/${s.title} (${s.year})/Season ${pad(season)}/${s.title} - S${pad(season)}E${pad(episode)}.mkv`;
}

export function dubRelPath(m) {
  return `dubs/${m.dub.id}.m4a`;
}

/** Every video file to generate: {rel, codec, audio, subtitles, seed, kind}. */
export function allVideoFiles() {
  const out = [];
  let seed = 0;
  for (const m of MOVIES) {
    out.push({ rel: movieRelPath(m), codec: m.codec, audio: m.audio, subtitles: m.subtitles, sidecar: m.sidecarSubtitles ?? [], seed: ++seed });
  }
  for (const s of SERIES) {
    for (const sn of s.seasons) {
      for (let e = 1; e <= sn.episodes; e++) {
        out.push({ rel: episodeRelPath(s, sn.season, e), codec: sn.codec, audio: s.audio, subtitles: s.subtitles, sidecar: [], seed: ++seed });
      }
    }
  }
  return out;
}

// Fixture users. Passwords are fixed, public, fixture-only values: the server
// only ever listens on loopback and holds nothing but placeholder media.
export const FIXTURE_PASSWORD = "fixture-pass-0001"; // gitleaks:allow (public fixture-only value)
export const GUARDIAN_PIN = "2468";
export const CHILD_PIN = "1357";

// Child schedule window in minutes of the day (UTC). Overridable with
// FIXTURE_CHILD_WINDOW="start-end" so verification can run at any hour.
export function childWindow(env = process.env) {
  const raw = env.FIXTURE_CHILD_WINDOW ?? "0-1440";
  const m = /^(\d+)-(\d+)$/.exec(raw);
  if (!m) throw new Error(`FIXTURE_CHILD_WINDOW must look like 360-1260, got ${raw}`);
  return { start: Number(m[1]), end: Number(m[2]) };
}

export const USERS = {
  admin: { username: "fx-admin", display: "Fixture Admin" },
  viewer: { username: "fx-viewer", display: "Fixture Viewer" },
  guardian: { username: "fx-guardian", display: "Fixture Guardian" },
  child: { username: "fx-child", display: "Fixture Child" },
  childLocked: { username: "fx-child-locked", display: "Fixture Child (locked)" },
};
