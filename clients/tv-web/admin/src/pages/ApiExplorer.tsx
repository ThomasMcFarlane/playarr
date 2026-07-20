import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
import { ApiError, describeApiError, type UserResponse } from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";

/**
 * One active "view as" session -- minted by `POST
 * /api/v1/admin/users/{user_id}/impersonate` and held only in memory
 * (nothing here is persisted; a page reload drops it and this page falls
 * back to the signed-in admin's own token, same as any other in-memory UI
 * state on this page).
 */
interface ImpersonationState {
  accessToken: string;
  username: string;
  /** `Date.now()` at mint time plus the response's `expires_in` (seconds), in epoch ms. */
  expiresAt: number;
}

/**
 * Turns a failed `client.raw` call into the same human-readable message
 * `describeApiError` gives `ApiClient`'s own wrapped methods -- `raw` calls
 * don't throw `ApiError` themselves (that's `ApiClient.unwrap`'s job), so
 * this constructs one from the raw `{ error, response }` pair instead.
 */
function describeRawFailure(response: Response, error: unknown): string {
  return describeApiError(new ApiError(response.status, response.statusText, error));
}

/**
 * Admin-only interactive API explorer. Renders this server's own live
 * OpenAPI document (`GET /api/v1/openapi.json`) via Scalar's API Reference
 * component, so every "Test Request" call made from the UI hits this real
 * Streamarr instance. Scalar (not swagger-ui-react) specifically because it
 * has real, built-in dark mode -- this app has no light theme at all, and
 * swagger-ui-react's light-only stylesheet needed extensive, fragile CSS
 * overrides to stay readable (see git history for that attempt).
 *
 * The "Impersonate a user" control above the reference panel mints a short-
 * lived, non-refreshable access token for a chosen account (`POST
 * /api/v1/admin/users/{user_id}/impersonate`) and, while active, routes
 * every outgoing request through that user's token instead of the signed-in
 * admin's own -- see `handleRequestBuilt` below. That makes this page a
 * direct, hands-on way to see exactly what a given user's library-ACL
 * grants let them do, without needing a second browser session or their
 * password. The enforcement itself lives entirely on the backend; this page
 * is only a lens onto it -- same as every other admin page here, there is
 * no client-side admin gate, only `RequireAuth`'s signed-in check. A non-
 * admin who reaches this route simply sees 403s from both calls below,
 * which is acceptable and consistent with the rest of this app.
 */
export function ApiExplorerPage() {
  useDocumentTitle("API Explorer");
  const client = useApiClient();

  const [spec, setSpec] = useState<Record<string, unknown> | null>(null);
  const [specLoading, setSpecLoading] = useState(true);
  const [specError, setSpecError] = useState<string | null>(null);

  const [users, setUsers] = useState<UserResponse[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");

  const [impersonating, setImpersonating] = useState<ImpersonationState | null>(null);
  const [impersonateBusy, setImpersonateBusy] = useState(false);
  const [impersonateError, setImpersonateError] = useState<string | null>(null);

  /**
   * The signed-in admin's own current access token. `handleRequestBuilt`
   * below must stay synchronous (it's called inline for every outgoing
   * request), but `client.getAccessToken()` is async -- so this ref is kept
   * fresh by the effect further down instead, and the hook reads it
   * directly.
   */
  const adminTokenRef = useRef<string | undefined>(undefined);

  /**
   * Mirrors `impersonating` state via a ref, not a closure over the state
   * value directly. Learned the hard way from the swagger-ui-react version
   * of this page: that library only read its request-interceptor prop once,
   * at initial mount, and never re-applied it on later re-renders -- a
   * closure over `impersonating` would have forever seen whatever it was at
   * mount time (`null`). Scalar's `configuration` prop may or may not be
   * fully reactive after mount either; keeping a ref in sync and reading
   * `.current` inside a referentially-stable callback sidesteps the
   * question entirely -- it's correct regardless of when Scalar captured
   * the callback.
   */
  const impersonatingRef = useRef<ImpersonationState | null>(null);
  impersonatingRef.current = impersonating;

  // Fetch the live spec on mount.
  useEffect(() => {
    let cancelled = false;
    setSpecLoading(true);
    setSpecError(null);
    client.raw
      .GET("/api/v1/openapi.json")
      .then((result) => {
        if (cancelled) return;
        if (!result.response.ok) {
          setSpecError(describeRawFailure(result.response, result.error));
          return;
        }
        // The generated schema has no body type for this operation (an
        // OpenAPI document describing its own server, generated at
        // request time), so the real JSON object openapi-fetch already
        // parsed comes through typed as `undefined` here -- cast through
        // `unknown` to what it actually is at runtime.
        setSpec((result.data as unknown as Record<string, unknown> | undefined) ?? {});
      })
      .catch((err: unknown) => {
        if (!cancelled) setSpecError(describeApiError(err));
      })
      .finally(() => {
        if (!cancelled) setSpecLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Fetch the user list for the impersonation picker.
  useEffect(() => {
    let cancelled = false;
    client
      .listUsers()
      .then((list) => {
        if (!cancelled) setUsers(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setUsersError(describeApiError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Keeps `adminTokenRef` current -- on mount, and again whenever
  // impersonation is cleared, so requests fall back to a valid (not stale)
  // admin token the moment "Stop impersonating" is clicked.
  useEffect(() => {
    if (impersonating) return;
    let cancelled = false;
    client
      .getAccessToken()
      .then((token) => {
        if (!cancelled) adminTokenRef.current = token;
      })
      .catch(() => {
        if (!cancelled) adminTokenRef.current = undefined;
      });
    return () => {
      cancelled = true;
    };
  }, [client, impersonating]);

  async function handleImpersonate() {
    if (!selectedUserId) return;
    setImpersonateBusy(true);
    setImpersonateError(null);
    try {
      const result = await client.raw.POST("/api/v1/admin/users/{user_id}/impersonate", {
        params: { path: { user_id: selectedUserId } },
      });
      if (!result.response.ok || !result.data) {
        throw new ApiError(result.response.status, result.response.statusText, result.error);
      }
      const impersonatedUser = users?.find((user) => user.id === result.data.user_id);
      setImpersonating({
        accessToken: result.data.access_token,
        username: impersonatedUser?.username ?? result.data.user_id,
        expiresAt: Date.now() + result.data.expires_in * 1000,
      });
    } catch (err) {
      setImpersonateError(describeApiError(err));
    } finally {
      setImpersonateBusy(false);
    }
  }

  function stopImpersonating() {
    setImpersonating(null);
    setImpersonateError(null);
  }

  /**
   * Defense-in-depth backstop, not the primary mechanism: verified (see
   * commit history) that Scalar's "Test Request" panel actually sources its
   * Authorization header from `configuration.authentication.securitySchemes
   * .bearer_auth.token` -- unlike swagger-ui-react, it *does* react to that
   * value changing on a later render, so `configuration` below is
   * deliberately rebuilt on every `impersonating` change rather than frozen
   * after first load. This hook covers any request path that bypasses that
   * resolution (Scalar exposes several ways to fire a request); it reads
   * only refs, never React state, so it stays correct regardless of when
   * Scalar captured this particular function reference.
   */
  const handleRequestBuilt = useCallback(({ request }: { request: Request }) => {
    const active = impersonatingRef.current;
    const token = active ? active.accessToken : adminTokenRef.current;
    if (token) {
      request.headers.set("Authorization", `Bearer ${token}`);
    }
  }, []);

  // Rebuilt whenever `impersonating` changes -- confirmed (unlike
  // swagger-ui-react) that Scalar actually re-reads
  // `authentication.securitySchemes.bearer_auth.token` on a `configuration`
  // prop change, both for the field it displays and the header it actually
  // sends. `handleRequestBuilt` above is kept as a backstop regardless.
  const configuration = useMemo(() => {
    if (!spec) return null;
    return {
      content: spec,
      darkMode: true,
      forceDarkModeState: "dark" as const,
      hideDarkModeToggle: true,
      authentication: {
        preferredSecurityScheme: "bearer_auth",
        securitySchemes: {
          bearer_auth: {
            token: (impersonating ? impersonating.accessToken : adminTokenRef.current) ?? "",
          },
        },
      },
      onRequestBuilt: handleRequestBuilt,
      // eslint-disable-next-line react-hooks/exhaustive-deps
    };
  }, [spec, impersonating]);

  return (
    <div className="page">
      <h1 className="page-title">API Explorer</h1>
      <p className="muted" style={{ maxWidth: 760, marginBottom: "1.5rem" }}>
        Browse and test every Streamarr API endpoint. Use &quot;Impersonate&quot; below to see
        exactly what a specific user&apos;s account can access.
      </p>

      <section className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 className="section-title" style={{ marginTop: 0 }}>
          Impersonate a user
        </h2>

        {impersonating ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "0.75rem",
              padding: "0.75rem 1rem",
              borderRadius: "var(--radius-input)",
              border: "1px solid var(--color-warning)",
              background: "rgba(255, 165, 0, 0.12)",
            }}
          >
            <span>
              Viewing as <strong>{impersonating.username}</strong> -- expires{" "}
              {new Date(impersonating.expiresAt).toLocaleTimeString()}
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={stopImpersonating}>
              Stop impersonating
            </button>
          </div>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              Mints a short-lived token for the selected account -- every "Test Request" call
              below is then sent as that user, until you stop impersonating.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
              <select
                className="input"
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
                disabled={!users || users.length === 0}
              >
                <option value="">Select a user...</option>
                {users?.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.username} ({user.id})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!selectedUserId || impersonateBusy}
                onClick={() => void handleImpersonate()}
              >
                {impersonateBusy ? "Impersonating..." : "Impersonate"}
              </button>
            </div>
          </>
        )}

        {usersError && (
          <p className="error-text hint" style={{ marginBottom: 0 }}>
            {usersError}
          </p>
        )}
        {impersonateError && (
          <p className="error-text hint" style={{ marginBottom: 0 }}>
            {impersonateError}
          </p>
        )}
      </section>

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
