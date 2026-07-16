import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { describeApiError, type Work } from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { KIND_LABELS } from "./PosterCard";

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;
const RESULT_LIMIT = 8;

/**
 * Header type-ahead over `searchCatalog` -- the same flow `Library.tsx`
 * used to run inline, relocated here per the redesign spec so it's
 * reachable from every page, not just Library itself. Navigating to a
 * result (or pressing Enter with none focused) just sets `/library?q=...`;
 * Admin has no per-work detail route to link to instead (see
 * `Library.tsx`'s doc comment).
 *
 * Debounced by `DEBOUNCE_MS` and guarded against out-of-order responses
 * with a request-generation counter -- a fast typist can have two
 * `searchCatalog` calls in flight at once, and without this, a slower
 * earlier response landing after a faster later one would silently
 * overwrite the dropdown with stale results.
 */
export function GlobalSearchInput() {
  const client = useApiClient();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Work[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRequestId = useRef(0);
  const debounceTimer = useRef<number>();
  const blurTimer = useRef<number>();

  useEffect(() => {
    window.clearTimeout(debounceTimer.current);
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setError(null);
      return;
    }
    debounceTimer.current = window.setTimeout(() => {
      const requestId = ++latestRequestId.current;
      client
        .searchCatalog(trimmed, RESULT_LIMIT)
        .then((works) => {
          if (requestId !== latestRequestId.current) return;
          setResults(works);
          setError(null);
        })
        .catch((err: unknown) => {
          if (requestId !== latestRequestId.current) return;
          setError(describeApiError(err));
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(debounceTimer.current);
  }, [query, client]);

  useEffect(() => () => window.clearTimeout(blurTimer.current), []);

  function goToLibrarySearch(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    navigate(`/library?q=${encodeURIComponent(trimmed)}`);
    setOpen(false);
  }

  return (
    <div className="header-search">
      <input
        type="text"
        className="input header-search-input"
        placeholder="Search titles..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay so a click on a result (which blurs the input first) has
          // a chance to register before the dropdown unmounts.
          blurTimer.current = window.setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Enter") {
            goToLibrarySearch(query);
          }
        }}
      />
      {open && query.trim().length >= MIN_QUERY_LENGTH && (
        <div className="header-search-results">
          {error && <div className="header-search-empty">{error}</div>}
          {!error && results.length === 0 && <div className="header-search-empty">No matches</div>}
          {!error &&
            results.map((work) => (
              <button
                key={work.id}
                type="button"
                className="header-search-result"
                onClick={() => goToLibrarySearch(work.title)}
              >
                <span>{work.title}</span>
                <span className="badge badge-neutral badge-pill">{KIND_LABELS[work.kind]}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
