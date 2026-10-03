// Deterministic catalogue fixtures sized like a real library (1,746 movies,
// 944 series by default). No randomness beyond the seeded PRNG, so repeated
// runs measure the same DOM.
import jpeg from "jpeg-js";

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ADJ = ["Silent", "Last", "Broken", "Hidden", "Golden", "Crimson", "Midnight", "Eternal", "Lost", "Final", "Wild", "Burning", "Frozen", "Secret", "Distant", "Hollow", "Rising", "Fallen", "Electric", "Paper"];
const NOUN = ["Harbour", "Kingdom", "Signal", "Garden", "Empire", "Horizon", "Circus", "Winter", "River", "Mirror", "Orchard", "Station", "Voyage", "Archive", "Frontier", "Lantern", "Compass", "Meridian", "Tide", "Cartographer"];
const TAIL = ["", "", "", " II", " Returns", ": Origins", " of the North", " in Paris", " (Director's Cut)", ": The Series"];
const GENRES = ["Drama", "Comedy", "Action", "Thriller", "Sci-Fi", "Horror", "Documentary", "Animation", "Romance", "Crime"];

function uuid(rand) {
  const h = () => Math.floor(rand() * 0x10000).toString(16).padStart(4, "0");
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
}

export function sortTitle(title) {
  return title.replace(/^(the|a|an)\s+/i, "").toLowerCase();
}

export function buildCatalogue({ movies = 1746, series = 944, sites = 0, artists = 0, seed = 4 } = {}) {
  const rand = mulberry32(seed);
  const make = (kind, count) =>
    Array.from({ length: count }, (_, i) => {
      const title = `${rand() < 0.15 ? "The " : ""}${ADJ[Math.floor(rand() * ADJ.length)]} ${NOUN[Math.floor(rand() * NOUN.length)]}${TAIL[Math.floor(rand() * TAIL.length)]}`;
      const id = uuid(rand);
      const year = 1960 + Math.floor(rand() * 65);
      return {
        id,
        kind,
        title,
        sort_title: sortTitle(title),
        overview: `A deterministic fixture ${kind} (${i}). ${ADJ[i % ADJ.length]} stories drift through the ${NOUN[i % NOUN.length]}.`.repeat(2),
        genres: [GENRES[Math.floor(rand() * GENRES.length)], GENRES[Math.floor(rand() * GENRES.length)]],
        tags: [],
        monitored: true,
        availability: "available",
        added_at: new Date(Date.UTC(2024, 0, 1) + i * 3_600_000).toISOString(),
        release_date: `${year}-0${1 + (i % 9)}-1${i % 9}T00:00:00Z`,
        external_refs: [],
        images: [
          { kind: "poster", url: `https://image.example.invalid/${id}/poster.jpg`, width: 500, height: 750 },
          { kind: "backdrop", url: `https://image.example.invalid/${id}/backdrop.jpg`, width: 1280, height: 720 },
        ],
      };
    });
  return {
    movie: make("movie", movies),
    series: make("series", series),
    site: make("site", sites),
    artist: make("artist", artists),
  };
}

/** Real JPEG bytes (decode cost is part of the measurement), a handful of variants reused across works. */
export function buildJpegs(variants = 12) {
  const encode = (w, h, seed) => {
    const rand = mulberry32(seed);
    const data = Buffer.alloc(w * h * 4);
    const hue = [rand() * 255, rand() * 255, rand() * 255];
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const o = (y * w + x) * 4;
        const n = (rand() - 0.5) * 40;
        data[o] = Math.max(0, Math.min(255, hue[0] * (y / h) + 60 * Math.sin(x / 37) + n));
        data[o + 1] = Math.max(0, Math.min(255, hue[1] * (x / w) + 60 * Math.cos(y / 53) + n));
        data[o + 2] = Math.max(0, Math.min(255, hue[2] + 50 * Math.sin((x + y) / 71) + n));
        data[o + 3] = 255;
      }
    }
    return Buffer.from(jpeg.encode({ data, width: w, height: h }, 70).data);
  };
  return {
    poster: Array.from({ length: variants }, (_, i) => encode(500, 750, 100 + i)),
    backdrop: Array.from({ length: variants }, (_, i) => encode(1280, 720, 200 + i)),
  };
}
