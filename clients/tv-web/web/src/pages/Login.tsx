import { useState } from "react";
import { useLocation, useNavigate, type Location } from "react-router-dom";
import { ApiError } from "@streamarr-tv/api-client";
import { useApiBaseUrl, useAuth } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { DeviceLogin } from "../components/DeviceLogin";
import { IS_TV } from "../lib/clientPlatform";
import { initialLoginServerUrl } from "../lib/loginServerUrl";
import { publicHttpServerHandoffUrl } from "../lib/httpServerHandoff";

interface LocationState {
  /** Set by `App.tsx`'s app-shell redirect so a successful login returns to wherever the user was headed. */
  from?: Location | string;
  /** Used by the profile picker when this browser has not signed into the selected profile before. */
  initialUsername?: string;
  /** Optional route state to apply to the post-login destination. */
  fromState?: unknown;
}

/**
 * Real username/password sign-in for Playarr Web -- backs `POST
 * /api/v1/auth/login`'s `AuthMode::FullAccount` tier (see
 * `ApiClientProvider`'s `login`). Reached either by navigating to `/login`
 * directly, or via the app shell's redirect once a protected request's
 * transparent login (`ensureAccessToken`) has failed with nothing left to
 * fall back on -- see `App.tsx`.
 *
 * Deliberately outside the sidebar/header chrome (`App.tsx` mounts this
 * as a sibling of the shelled routes, not a child of `AppShell`) -- there
 * is nothing authenticated to navigate to yet.
 */
export function LoginPage() {
  useDocumentTitle("Sign in");
  const { login, loginWithDeviceToken } = useAuth();
  const [apiBaseUrl] = useApiBaseUrl();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const [serverUrl, setServerUrl] = useState(() =>
    initialLoginServerUrl(apiBaseUrl, window.location.origin, window.location.hostname)
  );
  const [username, setUsername] = useState(state?.initialUsername ?? "");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handoffUrl =
    window.location.protocol === "https:"
      ? publicHttpServerHandoffUrl(serverUrl)
      : undefined;

  function finishLogin() {
    const destination = state?.from ?? "/";
    const destinationState =
      state?.fromState ??
      (typeof destination === "object" && "state" in destination
        ? destination.state
        : undefined);
    navigate(destination, { replace: true, state: destinationState });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    if (handoffUrl) {
      window.location.assign(handoffUrl);
      return;
    }
    try {
      await login({ serverUrl, username, password });
      finishLogin();
    } catch (err) {
      setError(loginErrorMessage(err));
      setSubmitting(false);
    }
  }

  if (IS_TV) {
    return (
      <DeviceLogin
        onAuthenticated={(token) => {
          loginWithDeviceToken(token);
          finishLogin();
        }}
      />
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-backdrop" aria-hidden="true" />
      <div className="auth-card">
        <div className="auth-header">
          <span className="app-logo">
            <img
              className="app-logo-icon"
              src={`${import.meta.env.BASE_URL}playarr-icon.svg`}
              alt=""
            />
            <span><span className="app-logo-accent">Play</span>arr</span>
          </span>
        </div>
        <p className="page-kicker">Welcome home</p>
        <h1 className="auth-title">Sign in to Playarr</h1>
        <p className="muted auth-description">
          Choose your Streamarr server, then save this profile on the current browser.
        </p>

        <form onSubmit={(event) => void handleSubmit(event)}>
          <label className="auth-label" htmlFor="login-server-url">
            Server URL
          </label>
          <input
            id="login-server-url"
            name="server-url"
            type="url"
            className="input auth-input"
            autoComplete="url"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            required
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            placeholder="https://streamarr.example.com"
          />
          <p className="hint auth-server-hint">
            {handoffUrl
              ? "This public HTTP server will open its own Playarr client so the connection stays same-origin."
              : "Your browser connects directly to this server. Playarr does not proxy your login."}
          </p>

          {!handoffUrl && (
            <>
              <label className="auth-label" htmlFor="login-username">
                Username
              </label>
              <input
                id="login-username"
                name="username"
                type="text"
                className="input auth-input"
                autoComplete="username"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />

              <label className="auth-label" htmlFor="login-password">
                Password
              </label>
              <input
                id="login-password"
                name="password"
                type="password"
                className={`input auth-input${error ? " is-error" : ""}`}
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </>
          )}

          {error && (
            <p className="error-text auth-error">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary auth-submit"
            disabled={submitting}
          >
            {handoffUrl ? "Continue on server" : submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * The login endpoint's failure responses carry a real `{error, message}`
 * body (`streamarr_api::error::ApiError`, e.g. `message: "invalid username
 * or password"`) even though the generated OpenAPI type for its 400/401
 * responses is untyped -- see `ApiClient.login`'s doc comment and
 * `backend/crates/streamarr-api/src/error.rs`'s `From<LoginError>` impl.
 * Prefer that real message over `describeApiError`'s generic "Sign-in
 * required" 401 text, which reads wrong on the page whose entire purpose
 * is signing in.
 */
function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | undefined;
    if (typeof body?.message === "string" && body.message.length > 0) {
      return body.message;
    }
    if (err.status === 400) {
      return "This server requires a username and password to sign in.";
    }
    return "Sign-in failed. Check your username and password and try again.";
  }
  if (err instanceof TypeError) {
    return "Could not reach this LAN server. Check the URL and allow Local Network Access when your browser asks.";
  }
  return err instanceof Error ? err.message : String(err);
}
