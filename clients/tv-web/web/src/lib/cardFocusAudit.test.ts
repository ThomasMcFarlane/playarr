import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Media cards (posters, thumbnails, episode tiles, playlist stacks, folder cards, suggestion tiles) show the shared card
 * focus on keyboard and D-pad focus: a lift and a soft shadow, never a ring (owner ruling Q13, docs/design/page-layout.md
 * section 5, item 1a). Every card class below must define a `:focus-visible` rule that lifts it, and no `:focus-visible`
 * rule on a card may draw an outline. A new `*-card` or `*-tile` class in the sources fails here until it is listed as a
 * media card (and given the focus treatment) or as a non-media surface with a reason.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const css = [read("../styles/global.css"), read("../styles/page-layout.css"), read("../pages/Folders.css"), read("../pages/Calendar.css")].join("\n");

/** Media cards: the class that receives focus, and the selector of the element that must lift. */
const MEDIA_CARDS: Record<string, string> = {
  "tv-title-card": ".tv-title-card:focus-visible",
  "tv-home-card": ".tv-home-card:focus-visible",
  "tv-episode-card": ".tv-episode-card:focus-visible",
  "tv-music-album-card": ".tv-title-card:focus-visible", // an album is a title card
  "tv-person-card": ".tv-episode-card:focus-visible", // cast tiles are episode cards
  "tv-playlist-directory-card": ".tv-playlist-directory-card:focus-visible .tv-playlist-card-art", // the stack lifts as one unit
  "folders-card": ".folders-card:focus-visible",
  "end-screen-tile": ".end-screen-tile:focus-visible",
  "tv-list-card": ".tv-title-card:focus-visible", // list view of the library grid
};

/** Surfaces named card or tile that are not media cards. */
const NOT_MEDIA = new Set([
  "settings-card", // settings panels
  "auth-card",
  "device-login-card",
  "device-link-card",
  "player-status-card",
  "tv-playlist-card", // the playlist card's art and cover pieces (tv-playlist-card-art, tv-playlist-card-cover)
]);

function walk(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(new URL(`${entry.name}/`, dir)) : /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name) ? [new URL(entry.name, dir)] : []
  );
}

function ruleBodies(selectorPart: string): string[] {
  const bodies: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(",").map((s) => s.trim().replace(/\s+/g, " "));
    if (selectors.some((s) => s.includes(selectorPart))) bodies.push(m[2]!);
  }
  return bodies;
}

describe("card focus audit", () => {
  it("every card or tile class in the sources is a listed media card or a listed non-media surface", () => {
    const found = new Set<string>();
    for (const dir of ["../pages/", "../components/"]) {
      for (const file of walk(new URL(dir, import.meta.url))) {
        const source = readFileSync(file, "utf8");
        for (const m of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
          for (const token of `${m[1] ?? ""} ${m[2] ?? ""}`.split(/\s+/)) {
            if (/^[a-z][a-z0-9-]*-(card|tile)$/.test(token)) found.add(token);
          }
        }
      }
    }
    const unknown = [...found].filter((token) => !(token in MEDIA_CARDS) && !NOT_MEDIA.has(token));
    expect(unknown, "add the class to MEDIA_CARDS with its focus rule, or to NOT_MEDIA with a reason").toEqual([]);
  });

  it("every media card lifts on :focus-visible with the shared shadow", () => {
    const failures: string[] = [];
    for (const [card, focusSelector] of Object.entries(MEDIA_CARDS)) {
      const bodies = ruleBodies(focusSelector);
      const lifts = bodies.some((b) => /transform:[^;]*(translateY\(-|scale\(1\.0)/.test(b));
      if (!lifts) failures.push(`${card}: no \`${focusSelector}\` rule lifts it (transform: translateY / scale)`);
    }
    expect(failures).toEqual([]);
  });

  it("no :focus-visible rule on a media card draws an outline", () => {
    const offenders: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = m[2]!;
      if (!/outline:\s*[0-9.]+(px|rem)\s+solid/.test(body)) continue;
      for (const selector of m[1]!.split(",").map((s) => s.trim().replace(/\s+/g, " "))) {
        if (!selector.includes(":focus-visible")) continue;
        // Only the card or tile itself (or its art) is a media card focus target; controls inside cards are not.
        const target = selector.split(" ").filter((part) => !part.startsWith(".tv-detail"))[0] ?? "";
        const cardClass = Object.keys(MEDIA_CARDS).find((c) => new RegExp(`\\.${c}(?![\\w-])`).test(selector));
        if (cardClass && !/\.tv-detail\b/.test(selector.split(":focus-visible")[0]!) && !/:not\(\.tv-episode-card\)/.test(selector)) {
          offenders.push(`${selector} (${target})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
