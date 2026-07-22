import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { describeApiError, type SourceMatrixResponse, type Work, type WorkKind } from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { LibraryToolbarMenus, type LibraryViewMode } from "../components/LibraryToolbarMenus";
import { SourceMatrixView, type MatrixSort } from "../components/SourceMatrixView";
import { PosterCard } from "../components/PosterCard";
import { ALPHA_RAIL_LETTERS, AlphabetIndexRail, bucketLetter } from "../components/AlphabetIndexRail";

/** Per-request batch size for the sequential full-set browse loader (see the module doc comment). */
const BATCH_SIZE = 500;
/** `searchCatalog` doesn't paginate server-side -- a search result set is expected to be small. */
const SEARCH_RESULT_LIMIT = 50;

const WORK_KINDS: readonly WorkKind[] = [
  "movie",
  "series",
  "site",
  "artist",
  "author",
];

function parseKind(value: string | null): WorkKind | null {
  return value !== null && (WORK_KINDS as readonly string[]).includes(value) ? (value as WorkKind) : null;
}

function parseView(value: string | null): LibraryViewMode {
  return value === "list" || value === "matrix" ? value : "grid";
}

function parseMatrixSort(value: string | null): MatrixSort {
  return value === "folder" ? "folder" : "library";
}

/**
 * Read-only catalog browse for Streamarr's admin surface -- lets an
 * operator verify a registered `*arr` source actually synced (titles,
 * availability, genres) without needing Playarr streaming access. Backed
 * by the same `GET /api/v1/catalog` endpoint Playarr Web uses, gated on
 * the backend by `CatalogViewer` (streaming access OR admin -- see
 * `backend/crates/streamarr-api/src/auth_extractor.rs`), not
 * `StreamingUser`: this page can never obtain a playback URL, it only
 * lists what's in the catalog.
 *
 * `kind`/`source_instance_id`/`q` all live in the URL (`useSearchParams`)
 * rather than local state -- shareable/reload-safe, and it's what lets
 * `GlobalSearchInput` (in the header) drive this page just by navigating
 * to `/library?q=...`.
 *
 * Browse mode loads the *entire* matching, title-sorted result set up
 * front in `BATCH_SIZE` batches rather than a manual "Load more" button:
 * the alphabet rail has to be able to jump to any letter, and a letter
 * past whatever's currently loaded would otherwise be a dead click or
 * silently wrong (see the redesign spec's §3.4 for the full reasoning --
 * this mirrors the real *arr apps' own accepted "load the whole list"
 * tradeoff). Each load is guarded by a generation counter so a fast filter
 * change can't have an older, slower batch's `setItems` call land after a
 * newer one's and silently show stale results -- a real bug the previous,
 * ungated `refresh()` had.
 *
 * Search mode (`?q=` present) still uses the small, unpaginated
 * `searchCatalog` call directly, exactly as before -- see §3.5. It has no
 * `kind`/`source_instance_id` params of its own, so type filtering is
 * applied client-side (safe, `Work.kind` is always present) and the
 * library filter is disabled entirely (no `source_instance_id` on `Work`
 * to filter by). The alphabet rail is omitted in search mode too --
 * `searchCatalog` results carry no guaranteed `sort_title` ordering.
 */
export function LibraryPage() {
  useDocumentTitle("Library");
  const client = useApiClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const query = searchParams.get("q") ?? "";
  const kind = parseKind(searchParams.get("kind"));
  const sourceInstanceId = searchParams.get("source_instance_id");
  const searchActive = query.trim().length > 0;
  const view = parseView(searchParams.get("view"));
  const matrixSort = parseMatrixSort(searchParams.get("matrix_sort"));

  const [items, setItems] = useState<Work[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matrix, setMatrix] = useState<SourceMatrixResponse | null>(null);

  const generation = useRef(0);
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});

  function setKind(next: WorkKind | null) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === null) params.delete("kind");
      else params.set("kind", next);
      return params;
    });
  }

  function setSourceInstanceId(next: string | null) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === null) params.delete("source_instance_id");
      else params.set("source_instance_id", next);
      return params;
    });
  }

  function setView(next: LibraryViewMode) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === "grid") params.delete("view"); else params.set("view", next);
      return params;
    });
  }

  function setMatrixSort(next: MatrixSort) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === "library") params.delete("matrix_sort"); else params.set("matrix_sort", next);
      return params;
    });
  }

  useEffect(() => {
    if (view !== "matrix") return;
    setMatrix(null);
    client.getSourceMatrix().then(setMatrix).catch((err: unknown) => setError(describeApiError(err)));
  }, [client, view]);

  useEffect(() => {
    const myGeneration = ++generation.current;
    itemRefs.current = {};
    setError(null);

    if (searchActive) {
      setLoading(true);
      setItems(null);
      setTotal(null);
      client
        .searchCatalog(query.trim(), SEARCH_RESULT_LIMIT)
        .then((results) => {
          if (generation.current !== myGeneration) return;
          const filtered = kind === null ? results : results.filter((w) => w.kind === kind);
          setItems(filtered);
          setTotal(filtered.length);
        })
        .catch((err: unknown) => {
          if (generation.current !== myGeneration) return;
          setError(describeApiError(err));
        })
        .finally(() => {
          if (generation.current === myGeneration) setLoading(false);
        });
      return;
    }

    setLoading(true);
    setItems([]);
    setTotal(null);

    async function loadAll() {
      let loaded: Work[] = [];
      let offset = 0;
      for (;;) {
        const page = await client.browseCatalog({
          sort: "title",
          order: "asc",
          kind: kind ?? undefined,
          source_instance_id: view === "matrix" ? undefined : sourceInstanceId ?? undefined,
          limit: BATCH_SIZE,
          offset,
        });
        if (generation.current !== myGeneration) return;
        loaded = loaded.concat(page.items);
        const knownTotal = page.total ?? loaded.length;
        setItems(loaded);
        setTotal(knownTotal);
        if (page.items.length === 0 || loaded.length >= knownTotal) break;
        offset += BATCH_SIZE;
      }
    }

    loadAll()
      .catch((err: unknown) => {
        if (generation.current !== myGeneration) return;
        setError(describeApiError(err));
      })
      .finally(() => {
        if (generation.current === myGeneration) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, query, kind, sourceInstanceId, searchActive, view]);

  const firstIdByLetter = useMemo(() => {
    const map: Record<string, string> = {};
    if (!items) return map;
    for (const work of items) {
      const letter = bucketLetter(work.sort_title);
      if (!(letter in map)) map[letter] = work.id;
    }
    return map;
  }, [items]);

  function handleAlphaSelect(letter: string) {
    const startIndex = ALPHA_RAIL_LETTERS.indexOf(letter as (typeof ALPHA_RAIL_LETTERS)[number]);
    for (let i = startIndex; i < ALPHA_RAIL_LETTERS.length; i++) {
      const candidate = ALPHA_RAIL_LETTERS[i];
      const id = candidate ? firstIdByLetter[candidate] : undefined;
      if (!id) continue;
      itemRefs.current[id]?.scrollIntoView({ block: "start", behavior: "auto" });
      return;
    }
  }

  const toolbarLabel = (() => {
    if (loading && (total === null || (items?.length ?? 0) < total)) {
      return `Loading... ${items?.length ?? 0} of ${total ?? "?"}`;
    }
    const count = total ?? items?.length ?? 0;
    return searchActive ? `${count} match${count === 1 ? "" : "es"}` : `${count} item${count === 1 ? "" : "s"}`;
  })();

  return (
    <div className="library-page">
      <div className="library-toolbar">
        <span className="library-toolbar-count">{toolbarLabel}</span>
        <LibraryToolbarMenus
          view={view}
          onViewChange={setView}
          matrixSort={matrixSort}
          onMatrixSortChange={setMatrixSort}
          kind={kind}
          onKindChange={setKind}
          sourceInstanceId={sourceInstanceId}
          onSourceInstanceChange={setSourceInstanceId}
          searchActive={searchActive}
        />
      </div>

      {error && (
        <p className="error-text" style={{ padding: "0 var(--content-padding)" }}>
          {error}
        </p>
      )}

      <div className="library-content-row">
        {view === "matrix" && items !== null && matrix !== null ? (
          <SourceMatrixView items={items} matrix={matrix} sort={matrixSort} />
        ) : (
        <div
          className="poster-grid-scroll"
          data-tv-scroll-container
          data-tv-scroll-axis="vertical"
          data-navigation-scroll-key={`admin-library-${view}`}
        >
          {view === "matrix" && matrix === null && !error && (
            <p className="muted">Loading source matrix...</p>
          )}
          {items !== null && items.length === 0 && !loading && (
            <p className="muted">
              {searchActive
                ? "No titles match that search."
                : "Nothing has synced yet -- check Source instances and Tasks."}
            </p>
          )}
          {view === "grid" && items !== null && items.length > 0 && (
            <ul className="poster-grid">
              {items.map((work) => (
                <PosterCard
                  key={work.id}
                  work={work}
                  ref={(el) => {
                    itemRefs.current[work.id] = el;
                  }}
                />
              ))}
            </ul>
          )}
          {view === "list" && items !== null && items.length > 0 && (
            <table className="library-list-table">
              <thead><tr><th>Title</th><th>Type</th><th>Availability</th><th>Released</th><th>Added</th></tr></thead>
              <tbody>{items.map((work) => <tr key={work.id} ref={(element) => { itemRefs.current[work.id] = element; }}><th>{work.title}</th><td>{work.kind}</td><td>{work.availability.replaceAll("_", " ")}</td><td>{work.release_date ? new Date(work.release_date).toLocaleDateString() : "—"}</td><td>{new Date(work.added_at).toLocaleDateString()}</td></tr>)}</tbody>
            </table>
          )}
        </div>
        )}
        {!searchActive && view !== "matrix" && <AlphabetIndexRail onSelect={handleAlphaSelect} />}
      </div>
    </div>
  );
}
