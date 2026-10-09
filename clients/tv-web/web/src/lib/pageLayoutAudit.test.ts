import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Page layout audit (docs/design/page-layout.md, section 7.1). Scans `src/pages/**` and `src/components/**`, excluding
 * `components/shell/**` (the layout components themselves), for the ways a page can draw its own chrome.
 *
 * Existing offenders sit in `BASELINE` with the number of hits they may still have. A count may only go down: the test
 * fails when a file has more hits than its baseline, and when it has fewer (lower the baseline). Each migration step
 * removes its pages from the baseline, and it is empty when the migration is finished (W8).
 */
const src = join(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

const files = [...sources(join(src, "pages")), ...sources(join(src, "components"))]
  .map((path) => relative(src, path))
  .filter((file) => !file.startsWith("components/shell/"))
  .sort();

/** Source without comments (a doc comment may name a class; only code counts). */
function code(file: string): string {
  return readFileSync(join(src, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const RULES = {
  /** A page frame or header used directly. Pages pass `header` to PageLayout. */
  frame: /<PageHeader\b/g,
  /** A header pill rendered by hand. Only PageActions renders pills. */
  pill: /<(FiltersButton|PanelButton|ActionPill)\b/g,
  /** Header chrome class names. */
  chromeClass: /(?<![\w-])(page-filters-button|action-pill|tv-page-back|tv-library-heading|page-header)(?![\w-])/g,
  /** A scroll container written by hand. Use ScrollArea. */
  scrollContainer: /data-tv-scroll-container/g,
  /** A hand-made loading, empty or error state. Use the state components. */
  stateElement:
    /<[a-zA-Z.]+(?=[^<>]*role=["{]+(?:status|alert))[^<>]*?className=(?:"[^"]*(?:loading|loader|error|empty)[^"]*"|\{`[^`]*(?:loading|loader|error|empty)[^`]*`\})/gs,
} as const;

type Rule = keyof typeof RULES;

const BASELINE: Record<Rule, Record<string, number>> = {
  /** None allowed: the migration is finished. */
  frame: {},
  /** None allowed. */
  pill: {},
  /** TvStageChrome (the exempt Profiles and Clients pages). */
  chromeClass: {
    "components/tv/TvStage.tsx": 2,
  },
  /** Pages not yet on ScrollArea, plus non-page surfaces (dropdowns, dialogs, player panels, auth layout) that own a native scroller. */
  scrollContainer: {
    "components/DeviceLogin.tsx": 1,
    "components/LanguageDropdown.tsx": 1,
    "components/PageScrollRoot.tsx": 1,
    "components/ProfileAuthLayout.tsx": 1,
    "components/ResumeChooserModal.tsx": 1,
    "components/SearchablePlaylistSelect.tsx": 1,
    "components/ThemeDropdown.tsx": 1,
    "components/player/EndScreen.tsx": 1,
    "components/player/PlaybackHealthPanel.tsx": 1,
    "components/player/PlayerSurface.tsx": 1,
    "components/tv/ListPanel.tsx": 1,
    "components/tv/TvStage.tsx": 2,
    "pages/Calendar.tsx": 3,
    "pages/Clients.tsx": 2,
    "pages/Library.tsx": 1,
    "pages/NavPerfHarness.tsx": 1,
    "pages/Playlists.tsx": 1,
    "pages/Profiles.tsx": 1,
    "pages/settings/ProfileAvatar.tsx": 1,
  },
  /** Pages with hand-made states (W3, W6) and inline field errors or status text in components that are not page states. */
  stateElement: {
    "components/CalendarLink.tsx": 2,
    "components/MediaContextMenu.tsx": 1,
    "components/PlaylistContextMenu.tsx": 1,
    "components/RequestButton.tsx": 1,
    "components/ServerChoiceModal.tsx": 1,
    "components/WatchlistToggle.tsx": 1,
    "components/player/CastButton.tsx": 1,
    "components/player/PlaybackHealthPanel.tsx": 1,
    "components/player/PlayerControls.tsx": 2,
    "components/player/PlayerSurface.tsx": 1,
    "components/remote/PlayOnDeviceDialog.tsx": 1,
    "components/remote/RemotePad.tsx": 1,
    "components/remote/RemotePairingPrompt.tsx": 1,
    "pages/Downloads.tsx": 1,
    "pages/Playlists.tsx": 1,
    "pages/Profiles.tsx": 1,
    "pages/Watchlist.tsx": 1,
    "pages/settings/Invite.tsx": 2,
    "pages/settings/ProfileAvatar.tsx": 1,
    "pages/settings/Remote.tsx": 1,
    "pages/settings/YourData.tsx": 3,
  },
};

function hits(file: string, rule: Rule): number {
  return code(file).match(RULES[rule])?.length ?? 0;
}

describe("page layout audit", () => {
  for (const rule of Object.keys(RULES) as Rule[]) {
    it(`${rule}: no file draws page chrome beyond its baseline, and the baseline only shrinks`, () => {
      const over: string[] = [];
      const stale: string[] = [];
      for (const file of files) {
        const found = hits(file, rule);
        const allowed = BASELINE[rule][file] ?? 0;
        if (found > allowed) over.push(`${file}: ${found} (allowed ${allowed})`);
        if (found < allowed) stale.push(`${file}: ${found} (baseline ${allowed}) - lower the baseline`);
      }
      expect(over, `use PageLayout, PageActions, ScrollArea or the state components (docs/design/page-layout.md)`).toEqual([]);
      expect(stale).toEqual([]);
      for (const file of Object.keys(BASELINE[rule])) expect(files, `${file} is in the ${rule} baseline but is not scanned`).toContain(file);
    });
  }
});

export { files as scannedFiles, hits, RULES };
