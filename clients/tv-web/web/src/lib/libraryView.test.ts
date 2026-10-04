import { readFileSync } from "node:fs";
import { createMemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import {
  LIBRARY_VIEW_DEFAULTS,
  applyLibraryView,
  parseLibraryView,
  rememberLibraryView,
  storedLibraryView,
  type LibraryViewState,
} from "./libraryView";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("library view query", () => {
  it("round-trips every view, size, sort and order through the URL", () => {
    for (const view of ["list", "screen", "cover", "cover-flow"] as const)
      for (const size of ["small", "medium", "large"] as const)
        for (const sort of ["title", "date_added"] as const)
          for (const order of ["asc", "desc"] as const) {
            const state: LibraryViewState = { view, size, sort, order };
            const query = applyLibraryView(new URLSearchParams(), state).toString();
            expect(parseLibraryView(new URLSearchParams(query), "artist")).toEqual(state);
          }
  });

  it("writes defaults explicitly so a shared link is deterministic", () => {
    expect(applyLibraryView(new URLSearchParams(), { view: "screen" }).toString()).toBe("view=screen");
  });

  it("keeps unrelated params (filters, panel) untouched", () => {
    const next = applyLibraryView(new URLSearchParams("audio=en&panel=filters&sort=title"), { sort: "date_added" });
    expect(next.get("audio")).toBe("en");
    expect(next.get("panel")).toBe("filters");
    expect(next.get("sort")).toBe("date_added");
  });

  it("ignores malformed values and falls back per field", () => {
    const parsed = parseLibraryView(new URLSearchParams("view=bogus&size=large&sort=nope&order=desc"), "movie");
    expect(parsed).toEqual({ ...LIBRARY_VIEW_DEFAULTS, size: "large", order: "desc" });
  });

  it("allows Cover Flow for artists only", () => {
    expect(parseLibraryView(new URLSearchParams("view=cover-flow"), "artist").view).toBe("cover-flow");
    expect(parseLibraryView(new URLSearchParams("view=cover-flow"), "movie").view).toBe("screen");
  });

  it("uses stored defaults only for fields the URL omits", () => {
    const storage = memory({ "playarr.libraryView.movie": "list", "playarr.artworkSize.movie": "small" });
    const stored = storedLibraryView("movie", storage);
    expect(stored.view).toBe("list");
    expect(parseLibraryView(new URLSearchParams(""), "movie", stored)).toMatchObject({ view: "list", size: "small" });
    expect(parseLibraryView(new URLSearchParams("view=cover"), "movie", stored)).toMatchObject({ view: "cover", size: "small" });
  });

  it("remembers the last choice per kind and tolerates missing storage", () => {
    const storage = memory();
    rememberLibraryView("series", { view: "cover", order: "desc" }, storage);
    expect(storedLibraryView("series", storage)).toMatchObject({ view: "cover", order: "desc" });
    expect(storedLibraryView("movie", storage)).toEqual(LIBRARY_VIEW_DEFAULTS);
    expect(() => rememberLibraryView("series", { view: "list" }, null)).not.toThrow();
    expect(storedLibraryView("series", null)).toEqual(LIBRARY_VIEW_DEFAULTS);
  });
});

describe("library view history", () => {
  const search = (router: ReturnType<typeof createMemoryRouter>) => new URLSearchParams(router.state.location.search);

  it("restores earlier views on back and later ones on forward, and deep links restore directly", async () => {
    const router = createMemoryRouter([{ path: "/movies", element: null }], { initialEntries: ["/movies?view=list&size=large"] });
    expect(parseLibraryView(search(router), "movie")).toMatchObject({ view: "list", size: "large" });

    await router.navigate({ pathname: "/movies", search: applyLibraryView(search(router), { sort: "date_added", order: "desc" }).toString() });
    await router.navigate({ pathname: "/movies", search: applyLibraryView(search(router), { view: "cover" }).toString() });
    expect(parseLibraryView(search(router), "movie")).toEqual({ view: "cover", size: "large", sort: "date_added", order: "desc" });

    await router.navigate(-1);
    expect(parseLibraryView(search(router), "movie")).toEqual({ view: "list", size: "large", sort: "date_added", order: "desc" });
    await router.navigate(-1);
    expect(parseLibraryView(search(router), "movie")).toEqual({ view: "list", size: "large", sort: "title", order: "asc" });
    await router.navigate(1);
    expect(parseLibraryView(search(router), "movie").sort).toBe("date_added");
  });

  it("the Library page reads view state from the URL, not directly from localStorage", () => {
    const page = readFileSync(new URL("../pages/Library.tsx", import.meta.url), "utf8");
    expect(page).not.toMatch(/window\.localStorage/);
    expect(page).toMatch(/parseLibraryView\(searchParams/);
  });
});
