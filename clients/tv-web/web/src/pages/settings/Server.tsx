import { useState } from "react";
import { ApiError, type VersionEnvelope } from "@streamarr-tv/api-client";
import { DEFAULT_API_BASE_URL } from "@streamarr-tv/domain";
import { useApiBaseUrl, usePrimaryApiClient, useAuth } from "../../lib/ApiClientProvider";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useToast } from "../../lib/toast";
import { SettingsSectionLayout } from "./SettingsSectionLayout";

type ConnectionTestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; version: VersionEnvelope }
  | { status: "error"; message: string };

type AddServerState =
  | { status: "idle" | "adding" | "success" }
  | { status: "error"; message: string };

export function SettingsServerPage() {
  useDocumentTitle("Server connection — Settings");
  const [apiBaseUrl] = useApiBaseUrl();
  const client = usePrimaryApiClient();
  const { connectedServers, connectServer, disconnectServer, currentUserName } = useAuth();
  const { showToast } = useToast();
  const [serverUrl, setServerUrl] = useState("");
  const [serverUsername, setServerUsername] = useState(currentUserName ?? "");
  const [serverPassword, setServerPassword] = useState("");
  const [addServerState, setAddServerState] = useState<AddServerState>({ status: "idle" });
  const [testState, setTestState] = useState<ConnectionTestState>({ status: "idle" });

  async function handleAddServer(event: React.FormEvent) {
    event.preventDefault();
    if (addServerState.status === "adding") return;
    setAddServerState({ status: "adding" });
    try {
      await connectServer({
        serverUrl: serverUrl.trim(),
        username: serverUsername.trim(),
        password: serverPassword,
      });
      setServerUrl("");
      setServerPassword("");
      setAddServerState({ status: "success" });
      showToast("Server connected.");
    } catch (error) {
      setAddServerState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
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
    <SettingsSectionLayout
      kicker="Make it yours"
      title="Server connection"
      description="Combine libraries from multiple servers in one Playarr interface."
    >
      <section className="card settings-card settings-card-wide">
        <div className="connected-server-list" aria-label="Connected servers">
          {connectedServers.map((server) => (
            <div className="connected-server" key={server.url}>
              <div>
                <strong>{server.label}</strong>
                <span>{server.username}</span>
                <small>{server.url}</small>
              </div>
              {server.primary ? (
                <span className="connected-server-badge">Primary</span>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    disconnectServer(server.url);
                    showToast("Server disconnected.");
                  }}
                >
                  Disconnect
                </button>
              )}
            </div>
          ))}
        </div>

        <form onSubmit={(event) => void handleAddServer(event)} className="connection-form">
          <label className="form-label" htmlFor="additional-server-url">
            Add another server
          </label>
          <div className="connection-server-fields">
            <input
              id="additional-server-url"
              type="text"
              className={`input${addServerState.status === "error" ? " is-error" : ""}`}
              autoComplete="url"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              placeholder="203.0.113.10 or https://streamarr.example.com"
              required
            />
            <input
              type="text"
              className="input"
              value={serverUsername}
              onChange={(event) => setServerUsername(event.target.value)}
              autoComplete="username"
              placeholder="Username"
              aria-label="Username for additional server"
            />
            <input
              type="password"
              className="input"
              value={serverPassword}
              onChange={(event) => setServerPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="Password"
              aria-label="Password for additional server"
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={addServerState.status === "adding"}
            >
              {addServerState.status === "adding" ? "Connecting…" : "Connect"}
            </button>
          </div>
          <p className={addServerState.status === "error" ? "error-text" : "hint"} aria-live="polite">
            {addServerState.status === "error"
              ? addServerState.message
              : addServerState.status === "success"
                ? "Server connected. Its library is now joined with this profile."
                : "Credentials and requests go directly from this browser to that server."}
          </p>
        </form>

        <div className="connection-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void handleTestConnection()}
            disabled={testState.status === "testing"}
          >
            {testState.status === "testing" ? "Testing…" : "Test connection"}
          </button>

          {testState.status === "success" && (
            <p className="success-text">
              Connected — server {testState.version.server_version} (API {testState.version.api_version}).
            </p>
          )}
          {testState.status === "error" && (
            <p className="error-text">Could not connect ({testState.message}).</p>
          )}
        </div>

        <p className="hint">
          {apiBaseUrl} remains the primary server for profile and player preferences.
        </p>

        <details className="settings-details">
          <summary>TV app connection details</summary>
          <p className="hint">
            TV apps resolve their server from an <code>?apiBaseUrl=...</code> launch query or an
            operator-editable <code>streamarr-config.json</code>, falling back to{" "}
            <code>{DEFAULT_API_BASE_URL}</code>.
          </p>
        </details>
      </section>
    </SettingsSectionLayout>
  );
}
