import { useEffect, useState } from "react";
import { ApiClient, ApiError } from "@streamarr-tv/api-client";
import type { PaginatedResult, Work } from "@streamarr-tv/domain";

// Placeholder base URL -- real config will come from a build-time env var
// (`import.meta.env.VITE_API_BASE_URL`) once the backend is deployed.
const apiClient = new ApiClient({ baseUrl: "http://localhost:8080/v1" });

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; works: Work[] };

/**
 * Demonstrates the intended `@streamarr-tv/api-client` + `@streamarr-tv/domain`
 * call shape. There is no backend running in this scaffold, so this will
 * resolve to the `error` branch until `packages/api-client` points at a
 * real API -- that's expected and left visible rather than mocked away.
 */
export function LibraryPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    apiClient
      .get<PaginatedResult<Work>>("/works", { page: 1, pageSize: 24 })
      .then((result) => {
        if (!cancelled) setState({ status: "ready", works: result.items });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof ApiError ? error.message : String(error);
        setState({ status: "error", message });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ padding: "2rem", color: "#ffffff" }}>
      <h1>Library</h1>
      {state.status === "loading" && <p style={{ color: "#a0a0a0" }}>Loading...</p>}
      {state.status === "error" && (
        <p style={{ color: "#e74c3c" }}>
          Could not load the library ({state.message}). Expected until a real
          API is wired up.
        </p>
      )}
      {state.status === "ready" && (
        <ul style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
          {state.works.map((work) => (
            <li key={work.id}>{work.title}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
