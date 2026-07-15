import { useState } from "react";
import { ApiError, type VersionEnvelope } from "@streamarr-tv/api-client";
import { DEFAULT_API_BASE_URL } from "@streamarr-tv/domain";
import { useApiBaseUrl, useApiClient } from "../lib/ApiClientProvider";

/** Restores the actual default (this page's own origin -- see `ApiClientProvider.tsx`) when the field is cleared. */
function defaultApiBaseUrl(): string {
  return typeof window !== "undefined" ? window.location.origin : DEFAULT_API_BASE_URL;
}

type ConnectionTestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; version: VersionEnvelope }
  | { status: "error"; message: string };

/**
 * Base API URL configuration (task: "make the base URL configurable"), plus
 * a "Test connection" button that calls the real `GET /api/system/version`
 * endpoint so an operator can confirm the value points at a real,
 * compatible Streamarr instance before relying on it elsewhere in the app.
 */
export function SettingsPage() {
  const [apiBaseUrl, setApiBaseUrl] = useApiBaseUrl();
  const client = useApiClient();
  const [draft, setDraft] = useState(apiBaseUrl);
  const [testState, setTestState] = useState<ConnectionTestState>({ status: "idle" });

  function handleSave(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = draft.trim() || defaultApiBaseUrl();
    setApiBaseUrl(trimmed);
    setDraft(trimmed);
    setTestState({ status: "idle" });
  }

  async function handleTestConnection() {
    setTestState({ status: "testing" });
    try {
      const version = await client.getVersion();
      setTestState({ status: "success", version });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : String(error);
      setTestState({ status: "error", message });
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">Settings</h1>

      <div className="card" style={{ maxWidth: 560 }}>
        <h2 className="section-title">Server connection</h2>
        <p className="muted" style={{ marginBottom: "1rem" }}>
          This app is normally served by your Streamarr instance itself, so it talks to that same
          server by default -- nothing to configure. Only change this if you're running the web app
          separately from the API (a split reverse-proxy setup, or pointing a local dev build at a
          different instance).
        </p>

        <form onSubmit={handleSave} style={{ display: "flex", gap: "0.5rem" }}>
          <label htmlFor="api-base-url" style={{ display: "none" }}>
            API base URL
          </label>
          <input
            id="api-base-url"
            type="text"
            className="input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={defaultApiBaseUrl()}
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn btn-primary">
            Save
          </button>
        </form>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => void handleTestConnection()}
          disabled={testState.status === "testing"}
          style={{ marginTop: "0.75rem" }}
        >
          {testState.status === "testing" ? "Testing..." : "Test connection"}
        </button>

        {testState.status === "success" && (
          <p className="success-text" style={{ marginTop: "0.5rem" }}>
            Connected -- server {testState.version.server_version} (API {testState.version.api_version}).
          </p>
        )}
        {testState.status === "error" && (
          <p className="error-text" style={{ marginTop: "0.5rem" }}>
            Could not connect ({testState.message}).
          </p>
        )}
      </div>

      <p className="hint" style={{ marginTop: "1.5rem", maxWidth: 560 }}>
        The TV apps (webOS, Tizen, VIDAA) have no keyboard to type a URL into: they resolve theirs from
        a <code>?apiBaseUrl=...</code> launch query param or an operator-editable{" "}
        <code>streamarr-config.json</code> file shipped alongside the app bundle, falling back to{" "}
        <code>{DEFAULT_API_BASE_URL}</code>. See each TV app's README for details. Linked-device
        management for TV pairing lives on each TV itself (see the pairing screen shown before Browse).
      </p>
    </div>
  );
}
