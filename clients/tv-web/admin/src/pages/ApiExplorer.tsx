import { useCallback, useEffect, useRef, useState } from "react";
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
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
 * The plain, mutable object `swagger-ui-react`'s `requestInterceptor`
 * receives for every outgoing "Try it out" call -- *not* a Fetch API
 * `Request` despite the name; `@types/swagger-ui-react` types it as
 * `{ [k: string]: any }`. `headers` is a plain string-keyed bag, not a
 * `Headers` instance.
 */
interface SwaggerUIRequest {
  headers?: Record<string, unknown>;
  [key: string]: unknown;
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
 * OpenAPI document (`GET /api/v1/openapi.json`) via `swagger-ui-react`, so
 * every "Try it out" call made from the UI hits this real Streamarr
 * instance.
 *
 * The "Impersonate a user" control above the Swagger panel mints a short-
 * lived, non-refreshable access token for a chosen account (`POST
 * /api/v1/admin/users/{user_id}/impersonate`) and, while active, routes
 * every Swagger UI request through that user's token instead of the
 * signed-in admin's own -- see `requestInterceptor` below. That makes this
 * page a direct, hands-on way to see exactly what a given user's library-
 * ACL grants let them do, without needing a second browser session or
 * their password. The enforcement itself lives entirely on the backend;
 * this page is only a lens onto it -- same as every other admin page here,
 * there is no client-side admin gate, only `RequireAuth`'s signed-in check.
 * A non-admin who reaches this route simply sees 403s from both calls
 * below, which is acceptable and consistent with the rest of this app.
 */
export function ApiExplorerPage() {
  useDocumentTitle("API Explorer");
  const client = useApiClient();

  const [spec, setSpec] = useState<object | null>(null);
  const [specLoading, setSpecLoading] = useState(true);
  const [specError, setSpecError] = useState<string | null>(null);

  const [users, setUsers] = useState<UserResponse[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");

  const [impersonating, setImpersonating] = useState<ImpersonationState | null>(null);
  const [impersonateBusy, setImpersonateBusy] = useState(false);
  const [impersonateError, setImpersonateError] = useState<string | null>(null);

  /**
   * The signed-in admin's own current access token. `requestInterceptor`
   * below must stay synchronous (swagger-ui-react calls it inline for
   * every outgoing request), but `client.getAccessToken()` is async -- so
   * this ref is kept fresh by the effect further down instead, and the
   * interceptor just reads it directly.
   */
  const adminTokenRef = useRef<string | undefined>(undefined);

  /**
   * Mirrors `impersonating` state. `swagger-ui-react` only reads its
   * `requestInterceptor` prop once, at initial mount, into the underlying
   * (non-React) Swagger UI system -- it does not re-apply the prop on
   * later re-renders, a known limitation of the wrapper. So a closure that
   * reads `impersonating` directly would forever see whatever it was at
   * mount time (`null`), never a later impersonation. Keeping a ref in
   * sync instead means `requestInterceptor` -- itself kept referentially
   * stable below via `useCallback` -- always reads the *current* value
   * when swagger-ui-react invokes it, regardless of when that one
   * reference was captured.
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
        setSpec((result.data as unknown as object | undefined) ?? {});
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
  // impersonation is cleared, so the interceptor falls back to a valid
  // (not stale) admin token the moment "Stop impersonating" is clicked.
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
   * The single source of truth for the `Authorization` header on every
   * Swagger UI "Try it out" request. This app doesn't use Swagger UI's own
   * "Authorize" dialog, so any header it might have stashed there is
   * stripped and replaced here instead, every time -- either the current
   * impersonation token, or (the normal case) the signed-in admin's own,
   * read straight from `adminTokenRef` so this can stay synchronous.
   */
  const requestInterceptor = useCallback((req: SwaggerUIRequest): SwaggerUIRequest => {
    const headers: Record<string, unknown> = { ...req.headers };
    delete headers.Authorization;
    delete headers.authorization;
    const active = impersonatingRef.current;
    const token = active ? active.accessToken : adminTokenRef.current;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return { ...req, headers };
  }, []);

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
              Mints a short-lived token for the selected account -- every "Try it out" request
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
      {spec && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <SwaggerUI spec={spec} requestInterceptor={requestInterceptor} />
        </div>
      )}
    </div>
  );
}
