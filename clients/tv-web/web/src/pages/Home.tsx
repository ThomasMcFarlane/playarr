import { Link } from "react-router-dom";
import { useCatalogBrowse } from "@streamarr-tv/api-client/react";
import { useApiClient } from "../lib/ApiClientProvider";

/** Standalone web app landing page: a "recently added" shelf off the real catalog endpoint. */
export function HomePage() {
  const client = useApiClient();
  const state = useCatalogBrowse(client, { sort: "recent", limit: 12 });

  return (
    <div style={{ padding: "2rem", color: "#ffffff" }}>
      <h1>Streamarr</h1>

      {state.status === "loading" && <p style={{ color: "#a0a0a0" }}>Loading recently added titles...</p>}

      {state.status === "error" && (
        <p style={{ color: "#e74c3c" }}>Could not load recently added titles ({state.message}).</p>
      )}

      {state.status === "empty" && (
        <p style={{ color: "#a0a0a0", maxWidth: 560 }}>
          Nothing has been added to your library yet. Once your Streamarr instance has media, it will
          show up here.
        </p>
      )}

      {state.status === "ready" && (
        <>
          <h2 style={{ fontSize: "1.1rem", color: "#a0a0a0", fontWeight: 400 }}>Recently added</h2>
          <ul
            style={{
              display: "grid",
              gap: "1rem",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              listStyle: "none",
              padding: 0,
            }}
          >
            {state.data.items.map((work) => (
              <li key={work.id}>
                <Link to={`/library/${work.id}`} style={{ color: "#ffffff", textDecoration: "none" }}>
                  {work.title}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
