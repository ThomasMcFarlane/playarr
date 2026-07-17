import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiClient, ApiError } from "@streamarr-tv/api-client";
import { useAuth } from "../lib/ApiClientProvider";
import { createLocalNetworkFetch } from "../lib/localNetworkFetch";
import { parseSignupInvite } from "../lib/signupInvite";
import { useDocumentTitle } from "../lib/useDocumentTitle";

const invite = parseSignupInvite(window.location.search);
const browserFetch = createLocalNetworkFetch();

export function SignupPage() {
  useDocumentTitle("Create account");
  const navigate = useNavigate();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signupClient = useMemo(
    () =>
      invite
        ? new ApiClient({ baseUrl: invite.serverUrl, fetchImpl: browserFetch })
        : null,
    []
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!invite || !signupClient) return;
    if (password !== passwordConfirmation) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await signupClient.signup({
        invite_token: invite.inviteToken,
        username,
        display_name: displayName,
        email: email || undefined,
        password,
      });
      await login({ serverUrl: invite.serverUrl, username, password });
      navigate("/", { replace: true });
    } catch (err) {
      setError(signupErrorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-backdrop" aria-hidden="true" />
      <div className="auth-card">
        <div className="auth-header">
          <span className="app-logo">
            <img className="app-logo-icon" src="/playarr-icon.svg" alt="" />
            <span><span className="app-logo-accent">Play</span>arr</span>
          </span>
        </div>
        <p className="page-kicker">You&apos;re invited</p>
        <h1 className="auth-title">Create your Playarr account</h1>
        <p className="muted auth-description">
          Choose your account details for the Streamarr server that invited you.
        </p>

        {!invite ? (
          <p className="error-text auth-error">
            This invitation link is incomplete or invalid. Ask your Streamarr administrator for a
            new QR code.
          </p>
        ) : (
          <form onSubmit={(event) => void handleSubmit(event)}>
            <label className="auth-label" htmlFor="signup-server-url">Server URL</label>
            <input
              id="signup-server-url"
              name="server-url"
              type="url"
              className="input auth-input"
              value={invite.serverUrl}
              readOnly
              aria-readonly="true"
              tabIndex={-1}
            />
            <p className="hint auth-server-hint">
              This address is locked to the server that issued your invitation.
            </p>

            <label className="auth-label" htmlFor="signup-username">Username</label>
            <input
              id="signup-username"
              name="username"
              type="text"
              className="input auth-input"
              autoComplete="username"
              required
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />

            <label className="auth-label" htmlFor="signup-display-name">Display name</label>
            <input
              id="signup-display-name"
              name="display-name"
              type="text"
              className="input auth-input"
              autoComplete="name"
              required
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />

            <label className="auth-label" htmlFor="signup-email">Email (optional)</label>
            <input
              id="signup-email"
              name="email"
              type="email"
              className="input auth-input"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />

            <label className="auth-label" htmlFor="signup-password">Password</label>
            <input
              id="signup-password"
              name="password"
              type="password"
              className="input auth-input"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />

            <label className="auth-label" htmlFor="signup-password-confirmation">
              Confirm password
            </label>
            <input
              id="signup-password-confirmation"
              name="password-confirmation"
              type="password"
              className={`input auth-input${error ? " is-error" : ""}`}
              autoComplete="new-password"
              required
              value={passwordConfirmation}
              onChange={(event) => setPasswordConfirmation(event.target.value)}
            />

            {error && <p className="error-text auth-error">{error}</p>}

            <button type="submit" className="btn btn-primary auth-submit" disabled={submitting}>
              {submitting ? "Creating account…" : "Create account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function signupErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | undefined;
    if (typeof body?.message === "string" && body.message.length > 0) return body.message;
    if (err.status === 410) return "This invitation has expired or has already been used.";
    if (err.status === 409) return "That username is already taken.";
    return "Could not create the account. Ask your administrator for a new invitation.";
  }
  if (err instanceof TypeError) {
    return "Could not reach this Streamarr server. Check that you are on the same network and allow Local Network Access when asked.";
  }
  return err instanceof Error ? err.message : String(err);
}
