import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { FolderEntry, FolderRoot } from "@playarr-tv/api-client";
import { describe, expect, it } from "vitest";
import { translations } from "../lib/i18n/translations";
import { EntryCard, RootChooser } from "./Folders";

const en = translations.en;
const t = (key: keyof typeof en, params?: Record<string, string | number>) =>
  en[key].replace(/\{\{(\w+)\}\}/g, (m, k: string) => (params && k in params ? String(params[k]) : m));

const directory: FolderEntry = { entry_type: "directory", name: "Season A", path: "Season A", item_count: 2 };
const media: FolderEntry = {
  entry_type: "media",
  name: "Sample Clip 01.mp4",
  path: "Sample Clip 01.mp4",
  media_file_id: "file-1",
  title: "Sample Clip 01",
  duration_ms: 65_000,
  height: 480,
  size_bytes: 2048,
  video_codec: "h264",
  watch_state: "part_watched",
  position_ms: 20_000,
};

describe("folder entry cards", () => {
  it("renders a directory as an openable folder with its item count", () => {
    const markup = renderToStaticMarkup(<EntryCard entry={directory} view="list" t={t} onOpen={() => undefined} />);
    expect(markup).toContain('aria-label="Open folder Season A"');
    expect(markup).toContain("2 items");
    expect(markup).toContain("is-directory");
  });

  it("offers Resume with progress for a part-watched file and shows its facts", () => {
    const markup = renderToStaticMarkup(<EntryCard entry={media} view="list" t={t} onOpen={() => undefined} />);
    expect(markup).toContain('aria-label="Resume Sample Clip 01"');
    expect(markup).toContain(">Resume<");
    expect(markup).toContain("1:05 · 480p · 2.00 KB");
    expect(markup).toContain("width:31%");
    expect(markup).toContain('data-navigation-focus-key="folders:media:Sample Clip 01.mp4"');
  });

  it("plays an unwatched file and quietly marks a watched one", () => {
    const fresh = renderToStaticMarkup(<EntryCard entry={{ ...media, watch_state: undefined, position_ms: undefined }} view="list" t={t} onOpen={() => undefined} />);
    expect(fresh).toContain('aria-label="Play Sample Clip 01"');
    expect(fresh).not.toContain("folders-progress");
    const done = renderToStaticMarkup(<EntryCard entry={{ ...media, watch_state: "watched" }} view="list" t={t} onOpen={() => undefined} />);
    expect(done).toContain("is-watched");
    expect(done).toContain(">Watched<");
  });
});

describe("root chooser", () => {
  const roots: FolderRoot[] = [
    { id: "r1", source_instance_id: "s1", source_name: "Movies", display_label: "Movies", library_kind: "movie", name: "Sample Unsorted", available: true, scan_status: "ready", item_count: 3 },
    { id: "r2", source_instance_id: "s1", source_name: "Movies", display_label: "Movies", library_kind: "movie", name: "New Root", available: false, scan_status: "scanning", item_count: 0 },
  ];

  it("lists every root with its state", () => {
    const markup = renderToStaticMarkup(<RootChooser roots={roots} t={t} onChoose={() => undefined} />);
    expect(markup).toContain("Sample Unsorted");
    expect(markup).toContain("Movies · 3 items");
    expect(markup).toContain("Movies · Scanning");
  });
});

describe("folders page wiring", () => {
  const source = readFileSync(new URL("./Folders.tsx", import.meta.url), "utf8");
  it("keeps every view setting in the URL and uses the shared shell", () => {
    expect(source).toMatch(/useSearchParams/);
    expect(source).toMatch(/parseFolderUrl/);
    expect(source).toMatch(/<PageLayout/);
    expect(source).toMatch(/<FiltersDrawer/);
    expect(source).toMatch(/kind: "filters"/);
    expect(source).toMatch(/usePanelParam/);
    expect(source).not.toMatch(/page-filters-button/);
  });
});
