import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Library paging (B11, B12)", () => {
  const source = read("./Library.tsx");

  it("clears the in-flight marker only for the request that set it", () => {
    expect(source).toContain("if (requestRef.current === request) requestRef.current = null;");
  });

  it("jump-to-letter catches a failed page load instead of rejecting", () => {
    const jump = source.slice(source.indexOf("async function jumpToLetter"));
    expect(jump.slice(0, jump.indexOf("setJumpingLetter(null)"))).toMatch(
      /try \{\s*added = await appendNextPage\(\);\s*\} catch \{/
    );
  });
});

describe("Playlists directory load (B10)", () => {
  const source = read("../lib/playlistsData.ts");
  const page = read("./Playlists.tsx");

  it("bounds the fan-out and shares playlist item reads with the query cache", () => {
    expect(source).toContain("mapWithLimit(");
    expect(source).not.toMatch(/await Promise\.all\(\s*playlists\.map/);
    expect(source).not.toMatch(/await Promise\.all\(\s*workIds\.map/);
    expect(source).toContain("client.queries.fetch(");
  });

  it("reports failures instead of swallowing them", () => {
    expect(page).toContain("pages.playlists.partialLoadToast");
    expect(page).toContain("throw loaded.firstFailure");
  });
});

describe("HouseholdGate (B20)", () => {
  const source = read("../components/HouseholdGate.tsx");

  it("fetches once on mount and ignores out-of-order replies", () => {
    // The poll effect does not refresh on mount; the route-key effect is the only mount fetch.
    expect(source.match(/^\s*refresh\(\);$/gm)).toHaveLength(1);
    expect(source).toContain("mine === sequence.current");
  });

  it("does not poll while the tab is hidden", () => {
    expect(source).toContain('document.visibilityState !== "hidden"');
  });
});

describe("Remote settings polling (B25)", () => {
  const source = read("./settings/Remote.tsx");

  it("uses the visibility-aware poll at a gentle interval", () => {
    expect(source).toContain("useVisiblePolling(refresh, REFRESH_INTERVAL_MS)");
    expect(source).toMatch(/REFRESH_INTERVAL_MS = 15_000/);
    expect(source).not.toMatch(/setInterval\(\(\) => void refresh\(\), 5_000\)/);
  });
});

describe("MediaContextMenu (B27)", () => {
  const source = read("../components/MediaContextMenu.tsx");

  it("attaches the capture keyup listener only while armed, with a timeout", () => {
    expect(source).not.toMatch(/useEffect\(\(\) => \{\s*const consumeOriginRelease/);
    expect(source).toContain("ORIGIN_RELEASE_WINDOW_MS");
    expect(source).toContain('window.addEventListener("keyup", consumeOriginRelease, true)');
  });

  it("does not keep work details forever", () => {
    expect(source).toContain("DETAIL_CACHE_MS");
    expect(source.match(/detailCacheRef\.current\.clear\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
