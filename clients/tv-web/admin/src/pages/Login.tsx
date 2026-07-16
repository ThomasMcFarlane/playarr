import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, type LoginRequest } from "@streamarr-tv/api-client";
import { getOrCreateDeviceId, TokenStore, toStoredSession } from "@streamarr-tv/device-auth";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";

/**
 * Real username/password login for Streamarr's admin UI. `AuthMode`
 * defaults to `full-account` now (see backend/src/main.rs's
 * auth_mode_from_env) -- there is no transparent zero-credential path
 * anymore, so this form is the only way in.
 */
export function LoginPage() {
  useDocumentTitle("Sign in");
  const client = useApiClient();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body: LoginRequest = {
        device_id: getOrCreateDeviceId(),
        device_name: "Streamarr Admin",
        client_platform: "streamarr-admin",
        client_version: "0.1.0",
        username,
        password,
      };
      const response = await client.login(body);
      new TokenStore().set(toStoredSession(response));
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? "Invalid username or password." : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 360, margin: "4rem auto" }}>
      <h1 className="page-title" style={{ marginBottom: "1.5rem" }}>
        <span className="app-logo">
          <img className="app-logo-icon" src="/streamarr-icon.svg" alt="" />
          <span><span className="app-logo-accent">Stream</span>arr</span>
        </span>
      </h1>
      <form onSubmit={(e) => void handleSubmit(e)} className="card" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <label className="muted" htmlFor="username">
          Username
        </label>
        <input
          id="username"
          className="input"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <label className="muted" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          className="input"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={submitting} style={{ marginTop: "0.5rem" }}>
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
