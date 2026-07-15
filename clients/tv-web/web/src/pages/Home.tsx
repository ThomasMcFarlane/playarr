import { useCatalogBrowse } from "@streamarr-tv/api-client/react";
import { useApiClient } from "../lib/ApiClientProvider";
import { WorkCard } from "../components/WorkCard";

/** Standalone web app landing page: a "recently added" shelf off the real catalog endpoint. */
export function HomePage() {
  const client = useApiClient();
  const state = useCatalogBrowse(client, { sort: "recent", limit: 12 });

  return (
    <div className="page">
      <h1 className="page-title">Streamarr</h1>

      {state.status === "loading" && <p className="muted">Loading recently added titles...</p>}

      {state.status === "error" && (
        <p className="error-text">Could not load recently added titles ({state.message}).</p>
      )}

      {state.status === "empty" && (
        <p className="muted" style={{ maxWidth: 560 }}>
          Nothing has been added to your library yet. Once your Streamarr instance has media, it will
          show up here.
        </p>
      )}

      {state.status === "ready" && (
        <>
          <h2 className="section-title muted" style={{ fontWeight: 400 }}>
            Recently added
          </h2>
          <ul className="poster-grid">
            {state.data.items.map((work) => (
              <WorkCard key={work.id} work={work} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
