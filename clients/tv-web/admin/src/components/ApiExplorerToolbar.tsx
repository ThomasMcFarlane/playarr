import { useApiExplorer } from "../lib/ApiExplorerContext";

/**
 * A second, page-specific nav bar directly below the app's main header --
 * NOT inside the scrollable page content (so it stays put, same reasoning
 * as the sidebar) and NOT the far-left sidebar (tag/Introduction navigation
 * lives there instead; this bar is only for impersonation). Rendered by
 * `App.tsx` only while on `/api-explorer`.
 */
export function ApiExplorerToolbar() {
  const {
    users,
    usersError,
    selectedUserId,
    setSelectedUserId,
    impersonating,
    impersonateBusy,
    impersonateError,
    handleImpersonate,
    stopImpersonating,
  } = useApiExplorer();

  return (
    <div className="api-explorer-toolbar">
      {impersonating ? (
        <div className="api-explorer-toolbar-impersonating">
          <span>
            Viewing as <strong>{impersonating.username}</strong> -- expires{" "}
            {new Date(impersonating.expiresAt).toLocaleTimeString()}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={stopImpersonating}>
            Stop impersonating
          </button>
        </div>
      ) : (
        <div className="api-explorer-toolbar-form">
          <span className="muted" style={{ fontSize: "var(--font-size-caption)" }}>
            Impersonate a user -- every "Test Request" call is then sent as them
          </span>
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
            className="btn btn-primary btn-sm"
            disabled={!selectedUserId || impersonateBusy}
            onClick={() => void handleImpersonate()}
          >
            {impersonateBusy ? "Impersonating..." : "Impersonate"}
          </button>
        </div>
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
    </div>
  );
}
