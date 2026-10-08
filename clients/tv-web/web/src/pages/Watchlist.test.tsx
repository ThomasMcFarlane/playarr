import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TitleAction, WatchlistEntry } from "@playarr-tv/api-client";
import { LanguageProvider } from "../lib/i18n/LanguageProvider";
import { WatchlistRow } from "./Watchlist";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((message) => {
    if (!String(message).includes("useLayoutEffect does nothing on the server")) {
      throw new Error(`Unexpected console.error: ${String(message)}`);
    }
  });
});

afterAll(() => consoleErrorSpy.mockRestore());

function entry(actions: TitleAction[], sources: WatchlistEntry["title"]["sources"]): WatchlistEntry {
  return {
    added_at: "2026-10-03T00:00:00Z",
    in_watchlist: true,
    title: {
      title_key: "tmdb:movie:949",
      kind: "movie",
      title: "Orbit",
      year: 1995,
      external_refs: [],
      editions: [],
      sources,
    },
    actions,
  } as WatchlistEntry;
}

function render(item: WatchlistEntry): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <LanguageProvider>
        <ul>
          <WatchlistRow entry={item} onRemove={() => undefined} />
        </ul>
      </LanguageProvider>
    </MemoryRouter>
  );
}

describe("WatchlistRow", () => {
  it("offers Resume that opens the exact media file and links to the library detail", () => {
    const html = render(
      entry(
        [
          { action: "resume", enabled: true, media_file_id: "file-1", position_ms: 61000 },
          { action: "play", enabled: true, media_file_id: "file-1" },
          { action: "record", enabled: false, reason: "Recording is not available yet" },
        ] as TitleAction[],
        [{ source: "library", label: "Library", availability: "available", work_id: "work-1" }] as never
      )
    );
    expect(html).toContain('href="/player/file-1"');
    expect(html).toContain("Resume");
    expect(html).toContain('href="/movies/work-1"');
    expect(html).not.toContain("Recording is not available yet");
    expect(html).toContain("Remove from watchlist");
  });

  it("explains why nothing is playable for an out-of-library title", () => {
    const html = render(
      entry(
        [
          { action: "play", enabled: false, reason: "Not in a library you can access" },
          { action: "request", enabled: false, reason: "No request provider is configured" },
        ] as TitleAction[],
        []
      )
    );
    expect(html).not.toContain("/player/");
    expect(html).toContain("Not in a library you can access");
    expect(html).toContain("No request provider is configured");
  });
});
