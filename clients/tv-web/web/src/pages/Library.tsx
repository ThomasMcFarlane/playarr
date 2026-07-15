import { useCatalogBrowse } from "@streamarr-tv/api-client/react";
import { useApiClient } from "../lib/ApiClientProvider";
import { WorkCard } from "../components/WorkCard";

/** Full catalog browse, backed by the real `GET /api/v1/catalog` endpoint. */
export function LibraryPage() {
  const client = useApiClient();
  const state = useCatalogBrowse(client, { sort: "title" });

  return (
    <div className="page">
      <h1 className="page-title">Library</h1>

      {state.status === "loading" && <p className="muted">Loading...</p>}

      {state.status === "error" && <p className="error-text">Could not load the library ({state.message}).</p>}

      {state.status === "empty" && (
        <p className="muted">Your library is empty. Once your Streamarr instance has media, it will show up here.</p>
      )}

      {state.status === "ready" && (
        <ul className="poster-grid">
          {state.data.items.map((work) => (
            <WorkCard key={work.id} work={work} />
          ))}
        </ul>
      )}
    </div>
  );
}
