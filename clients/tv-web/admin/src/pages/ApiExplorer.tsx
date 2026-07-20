import { useMemo } from "react";
import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
import { useApiExplorer } from "../lib/ApiExplorerContext";
import { useDocumentTitle } from "../lib/useDocumentTitle";

/**
 * Admin-only interactive API explorer. Renders this server's own live
 * OpenAPI document (`GET /api/v1/openapi.json`) via Scalar's API Reference
 * component, so every "Test Request" call made from the UI hits this real
 * Streamarr instance. Scalar (not swagger-ui-react) specifically because it
 * has real, built-in dark mode -- this app has no light theme at all, and
 * swagger-ui-react's light-only stylesheet needed extensive, fragile CSS
 * overrides to stay readable (see git history for that attempt).
 *
 * Navigation (tag links, "Introduction") lives in the app's own sidebar now
 * (`ApiExplorerNavSection`, under "API Explorer") rather than Scalar's
 * built-in inner sidebar -- that inner sidebar scrolled away with the page
 * content instead of staying pinned like the rest of this app's nav.
 * `showSidebar`/`showToolbar: "never"` below turn off Scalar's own sidebar
 * and its "Developer Tools" bar entirely. The "Impersonate a user" control
 * lives in `ApiExplorerToolbar`, a second nav bar under the app's main
 * header (see `App.tsx`) -- also not inside this page's own scrollable
 * content, for the same "stay pinned" reason. `ApiExplorerContext` is the
 * shared state this page, the nav section, and the toolbar all read from,
 * since none of the three is a parent of another.
 *
 * Impersonation mints a short-lived, non-refreshable access token for a
 * chosen account (`POST /api/v1/admin/users/{user_id}/impersonate`) and,
 * while active, routes every outgoing request through that user's token
 * instead of the signed-in admin's own -- see `ApiExplorerContext`'s
 * `handleRequestBuilt`. That makes this page a direct, hands-on way to see
 * exactly what a given user's library-ACL grants let them do, without
 * needing a second browser session or their password. The enforcement
 * itself lives entirely on the backend; this page is only a lens onto it --
 * same as every other admin page here, there is no client-side admin gate,
 * only `RequireAuth`'s signed-in check. A non-admin who reaches this route
 * simply sees 403s from both calls this makes, which is acceptable and
 * consistent with the rest of this app.
 */
export function ApiExplorerPage() {
  useDocumentTitle("API Explorer");
  const { spec, specLoading, specError, currentToken, handleRequestBuilt } = useApiExplorer();

  // Rebuilt whenever `currentToken` changes (i.e. whenever impersonation is
  // started/stopped) -- confirmed (unlike swagger-ui-react) that Scalar
  // actually re-reads `authentication.securitySchemes.bearer_auth.token` on
  // a `configuration` prop change, both for the field it displays and the
  // header it actually sends. `handleRequestBuilt` is kept as a backstop
  // regardless (see its own doc comment in `ApiExplorerContext`).
  const configuration = useMemo(() => {
    if (!spec) return null;
    return {
      content: spec,
      darkMode: true,
      forceDarkModeState: "dark" as const,
      hideDarkModeToggle: true,
      showSidebar: false,
      showToolbar: "never" as const,
      authentication: {
        preferredSecurityScheme: "bearer_auth",
        securitySchemes: {
          bearer_auth: {
            token: currentToken,
          },
        },
      },
      onRequestBuilt: handleRequestBuilt,
    };
  }, [spec, currentToken, handleRequestBuilt]);

  return (
    <div className="page">
      <h1 className="page-title">API Explorer</h1>
      <p className="muted" style={{ maxWidth: 760, marginBottom: "1.5rem" }}>
        Browse and test every Streamarr API endpoint. Use "Impersonate" above to see exactly what
        a specific user's account can access.
      </p>

      {specLoading && <p className="muted">Loading API specification...</p>}
      {specError && <p className="error-text">{specError}</p>}
      {configuration && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <ApiReferenceReact configuration={configuration} />
        </div>
      )}
    </div>
  );
}
