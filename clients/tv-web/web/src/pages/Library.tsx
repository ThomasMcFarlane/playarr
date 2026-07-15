import { Link } from "react-router-dom";
import { useCatalogBrowse } from "@streamarr-tv/api-client/react";
import { useApiClient } from "../lib/ApiClientProvider";

/** Full catalog browse, backed by the real `GET /api/v1/catalog` endpoint. */
export function LibraryPage() {
  const client = useApiClient();
  const state = useCatalogBrowse(client, { sort: "title" });

  return (
    <div style={{ padding: "2rem", color: "#ffffff" }}>
      <h1>Library</h1>

      {state.status === "loading" && <p style={{ color: "#a0a0a0" }}>Loading...</p>}

      {state.status === "error" && (
        <p style={{ color: "#e74c3c" }}>Could not load the library ({state.message}).</p>
      )}

      {state.status === "empty" && (
        <p style={{ color: "#a0a0a0" }}>
          Your library is empty. Once your Streamarr instance has media, it will show up here.
        </p>
      )}

      {state.status === "ready" && (
        <ul
          style={{
            display: "grid",
            gap: "1rem",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            listStyle: "none",
            padding: 0,
          }}
        >
          {state.data.items.map((work) => (
            <li key={work.id}>
              <Link to={`/library/${work.id}`} style={{ color: "#ffffff", textDecoration: "none" }}>
                {work.title}
              </Link>
              <span style={{ color: "#5c5c5c", fontSize: "0.8rem", marginLeft: "0.5rem" }}>{work.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
