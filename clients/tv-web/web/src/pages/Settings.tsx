import { useState } from "react";
import { ApiError, type VersionEnvelope } from "@streamarr-tv/api-client";
import { DEFAULT_API_BASE_URL } from "@streamarr-tv/domain";
import { useApiBaseUrl, useApiClient } from "../lib/ApiClientProvider";

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
    const trimmed = draft.trim() || DEFAULT_API_BASE_URL;
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
    <div style={{ padding: "2rem", color: "#ffffff" }}>
      <h1>Settings</h1>
      <p style={{ color: "#a0a0a0", maxWidth: 560 }}>
        Point this app at your own Streamarr instance. Every operator runs their own server, so
        there is no baked-in default beyond <code>{DEFAULT_API_BASE_URL}</code> for local development.
      </p>

      <form onSubmit={handleSave} style={{ display: "flex", gap: "0.5rem", maxWidth: 480, marginTop: "1rem" }}>
        <label htmlFor="api-base-url" style={{ display: "none" }}>
          API base URL
        </label>
        <input
          id="api-base-url"
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={DEFAULT_API_BASE_URL}
          style={{
            flex: 1,
            padding: "0.5rem 0.75rem",
            borderRadius: 6,
            border: "1px solid #2a2a2a",
            background: "#121212",
            color: "#ffffff",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "0.5rem 1rem",
            borderRadius: 6,
            border: "none",
            background: "#e50914",
            color: "#ffffff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Save
        </button>
      </form>

      <button
        type="button"
        onClick={() => void handleTestConnection()}
        disabled={testState.status === "testing"}
        style={{
          marginTop: "0.75rem",
          padding: "0.4rem 0.9rem",
          borderRadius: 6,
          border: "1px solid #2a2a2a",
          background: "transparent",
          color: "#ffffff",
          cursor: "pointer",
        }}
      >
        {testState.status === "testing" ? "Testing..." : "Test connection"}
      </button>

      {testState.status === "success" && (
        <p style={{ color: "#2ecc71", marginTop: "0.5rem" }}>
          Connected -- server {testState.version.server_version} (API {testState.version.api_version}).
        </p>
      )}
      {testState.status === "error" && (
        <p style={{ color: "#e74c3c", marginTop: "0.5rem" }}>Could not connect ({testState.message}).</p>
      )}

      <p style={{ color: "#5c5c5c", fontSize: "0.875rem", marginTop: "2rem", maxWidth: 560 }}>
        The TV apps (webOS, Tizen, VIDAA) have no keyboard to type a URL into: they resolve theirs from
        a <code>?apiBaseUrl=...</code> launch query param or an operator-editable{" "}
        <code>streamarr-config.json</code> file shipped alongside the app bundle, falling back to{" "}
        <code>{DEFAULT_API_BASE_URL}</code>. See each TV app's README for details. Linked-device
        management for TV pairing lives on each TV itself (see the pairing screen shown before Browse).
      </p>
    </div>
  );
}
