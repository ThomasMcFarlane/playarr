import { useState } from "react";
import { ApiError, type VersionEnvelope } from "@streamarr-tv/api-client";
import { DEFAULT_API_BASE_URL } from "@streamarr-tv/domain";
import { useApiBaseUrl, usePrimaryApiClient, useAuth } from "../../lib/ApiClientProvider";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useToast } from "../../lib/toast";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
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
  const { t } = useLanguage();
  useDocumentTitle(t("settings.server.pageTitle"));
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
      showToast(t("settings.server.serverConnectedToast"));
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
      kicker={t("settings.server.kicker")}
      title={t("settings.server.title")}
      description={t("settings.server.description")}
    >
      <section className="card settings-card settings-card-wide">
        <div className="connected-server-list" aria-label={t("settings.server.connectedServersLabel")}>
          {connectedServers.map((server) => (
            <div className="connected-server" key={server.url}>
              <div>
                <strong>{server.label}</strong>
                <span>{server.username}</span>
                <small>{server.url}</small>
              </div>
              {server.primary ? (
                <span className="connected-server-badge">{t("settings.server.primaryBadge")}</span>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    disconnectServer(server.url);
                    showToast(t("settings.server.serverDisconnectedToast"));
                  }}
                >
                  {t("settings.server.disconnect")}
                </button>
              )}
            </div>
          ))}
        </div>

        <form onSubmit={(event) => void handleAddServer(event)} className="connection-form">
          <label className="form-label" htmlFor="additional-server-url">
            {t("settings.server.addAnotherServer")}
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
              placeholder={t("settings.server.serverAddressPlaceholder")}
              required
            />
            <input
              type="text"
              className="input"
              value={serverUsername}
              onChange={(event) => setServerUsername(event.target.value)}
              autoComplete="username"
              placeholder={t("settings.server.usernamePlaceholder")}
              aria-label={t("settings.server.usernameAriaLabel")}
            />
            <input
              type="password"
              className="input"
              value={serverPassword}
              onChange={(event) => setServerPassword(event.target.value)}
              autoComplete="current-password"
              placeholder={t("settings.server.passwordPlaceholder")}
              aria-label={t("settings.server.passwordAriaLabel")}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={addServerState.status === "adding"}
            >
              {addServerState.status === "adding"
                ? t("settings.server.connecting")
                : t("settings.server.connect")}
            </button>
          </div>
          <p className={addServerState.status === "error" ? "error-text" : "hint"} aria-live="polite">
            {addServerState.status === "error"
              ? addServerState.message
              : addServerState.status === "success"
                ? t("settings.server.serverConnectedHint")
                : t("settings.server.credentialsHint")}
          </p>
        </form>

        <div className="connection-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void handleTestConnection()}
            disabled={testState.status === "testing"}
          >
            {testState.status === "testing" ? t("settings.server.testing") : t("settings.server.testConnection")}
          </button>

          {testState.status === "success" && (
            <p className="success-text">
              {t("settings.server.connectedSuccess", {
                serverVersion: testState.version.server_version,
                apiVersion: testState.version.api_version,
              })}
            </p>
          )}
          {testState.status === "error" && (
            <p className="error-text">
              {t("settings.server.connectError", { message: testState.message })}
            </p>
          )}
        </div>

        <p className="hint">{t("settings.server.primaryServerHint", { apiBaseUrl })}</p>

        {window.PlayarrAndroidMobile && (
          <div className="connection-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => window.PlayarrAndroidMobile?.openServerEditor()}
            >
              {t("settings.server.changeAppHost")}
            </button>
            <p className="hint">{t("settings.server.changeAppHostHint")}</p>
          </div>
        )}

        <details className="settings-details">
          <summary>{t("settings.server.tvDetailsSummary")}</summary>
          <p className="hint">
            {t("settings.server.tvDetailsIntro")} <code>?apiBaseUrl=...</code>{" "}
            {t("settings.server.tvDetailsMiddle")} <code>streamarr-config.json</code>
            {t("settings.server.tvDetailsFallback")} <code>{DEFAULT_API_BASE_URL}</code>.
          </p>
        </details>
      </section>
    </SettingsSectionLayout>
  );
}
