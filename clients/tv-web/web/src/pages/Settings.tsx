import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  type UserInviteRequestResponse,
  type VersionEnvelope,
} from "@streamarr-tv/api-client";
import { DEFAULT_API_BASE_URL } from "@streamarr-tv/domain";
import { useApiBaseUrl, usePrimaryApiClient, useAuth } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useTheme, type ThemePreference } from "../lib/theme";
import { useToast } from "../lib/toast";
import { QrCode } from "../components/QrCode";

type ConnectionTestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; version: VersionEnvelope }
  | { status: "error"; message: string };

type AddServerState =
  | { status: "idle" | "adding" | "success" }
  | { status: "error"; message: string };

const AUDIO_LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
  { value: "hi", label: "Hindi" },
  { value: "ar", label: "Arabic" },
  { value: "th", label: "Thai" },
] as const;

type AudioLanguage = (typeof AUDIO_LANGUAGE_OPTIONS)[number]["value"];

type PlayerPreferenceState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

type ProfilePinState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

type FriendInviteState =
  | { status: "loading" }
  | { status: "ready"; request: UserInviteRequestResponse | null }
  | { status: "saving"; request: UserInviteRequestResponse | null }
  | { status: "error"; request: UserInviteRequestResponse | null; message: string };

function isAudioLanguage(value: string): value is AudioLanguage {
  return AUDIO_LANGUAGE_OPTIONS.some((option) => option.value === value);
}

/**
 * Base API URL configuration (task: "make the base URL configurable"), plus
 * a "Test connection" button that calls the real `GET /api/system/version`
 * endpoint so an operator can confirm the value points at a real,
 * compatible Streamarr instance before relying on it elsewhere in the app.
 */
export function SettingsPage() {
  useDocumentTitle("Settings");
  const [apiBaseUrl] = useApiBaseUrl();
  const client = usePrimaryApiClient();
  const {
    connectedServers,
    connectServer,
    currentUserName,
    disconnectServer,
    logout,
  } = useAuth();
  const navigate = useNavigate();
  const { preference, setPreference } = useTheme();
  const { showToast } = useToast();
  const [serverUrl, setServerUrl] = useState("");
  const [serverUsername, setServerUsername] = useState(currentUserName ?? "");
  const [serverPassword, setServerPassword] = useState("");
  const [addServerState, setAddServerState] = useState<AddServerState>({ status: "idle" });
  const [testState, setTestState] = useState<ConnectionTestState>({ status: "idle" });
  const [audioLanguage, setAudioLanguage] = useState<AudioLanguage>("en");
  const [playerPreferenceState, setPlayerPreferenceState] = useState<PlayerPreferenceState>({
    status: "loading",
  });
  const playerPreferenceRequestRef = useRef(0);
  const [profilePin, setProfilePin] = useState("");
  const [profilePinLocked, setProfilePinLocked] = useState(false);
  const [profilePinState, setProfilePinState] = useState<ProfilePinState>({
    status: "loading",
  });
  const profilePinRequestRef = useRef(0);
  const [friendInviteState, setFriendInviteState] = useState<FriendInviteState>({
    status: "loading",
  });
  const [friendInviteLink, setFriendInviteLink] = useState<string | null>(null);
  const [friendInviteExpiresAt, setFriendInviteExpiresAt] = useState<string | null>(null);
  const [friendInviteCopied, setFriendInviteCopied] = useState(false);

  useEffect(() => {
    const requestId = ++playerPreferenceRequestRef.current;
    setPlayerPreferenceState({ status: "loading" });

    void client
      .getPlayerPreferences()
      .then((preferences) => {
        if (playerPreferenceRequestRef.current !== requestId) return;
        const language = preferences.preferred_audio_language;
        setAudioLanguage(isAudioLanguage(language) ? language : "en");
        setPlayerPreferenceState({ status: "ready" });
      })
      .catch((error) => {
        if (playerPreferenceRequestRef.current !== requestId) return;
        const message = error instanceof ApiError ? error.message : String(error);
        setPlayerPreferenceState({ status: "error", message });
      });

    return () => {
      if (playerPreferenceRequestRef.current === requestId) {
        playerPreferenceRequestRef.current += 1;
      }
    };
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void client
        .getMyUserInviteRequest()
        .then((request) => {
          if (!cancelled) setFriendInviteState({ status: "ready", request });
        })
        .catch((error) => {
          if (cancelled) return;
          setFriendInviteState({
            status: "error",
            request: null,
            message: error instanceof ApiError ? error.message : String(error),
          });
        });
    };
    refresh();
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [client]);

  useEffect(() => {
    const requestId = ++profilePinRequestRef.current;
    setProfilePinState({ status: "loading" });
    void client
      .getProfilePinSetting()
      .then((setting) => {
        if (profilePinRequestRef.current !== requestId) return;
        setProfilePinLocked(setting.pin_locked);
        setProfilePinState({ status: "ready" });
      })
      .catch((error) => {
        if (profilePinRequestRef.current !== requestId) return;
        const message = error instanceof ApiError ? error.message : String(error);
        setProfilePinState({ status: "error", message });
      });

    return () => {
      if (profilePinRequestRef.current === requestId) {
        profilePinRequestRef.current += 1;
      }
    };
  }, [client]);

  function handleSignOut() {
    logout();
    navigate("/login", { replace: true });
  }

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

  async function handleAudioLanguageChange(nextLanguage: AudioLanguage) {
    if (
      nextLanguage === audioLanguage ||
      playerPreferenceState.status === "loading" ||
      playerPreferenceState.status === "saving"
    ) {
      return;
    }

    const previousLanguage = audioLanguage;
    const requestId = ++playerPreferenceRequestRef.current;
    setAudioLanguage(nextLanguage);
    setPlayerPreferenceState({ status: "saving" });

    try {
      const preferences = await client.updatePlayerPreferences({
        preferred_audio_language: nextLanguage,
      });
      if (playerPreferenceRequestRef.current !== requestId) return;
      const savedLanguage = preferences.preferred_audio_language;
      setAudioLanguage(isAudioLanguage(savedLanguage) ? savedLanguage : nextLanguage);
      setPlayerPreferenceState({ status: "saved" });
      showToast("Player preference saved.");
    } catch (error) {
      if (playerPreferenceRequestRef.current !== requestId) return;
      setAudioLanguage(previousLanguage);
      const message = error instanceof ApiError ? error.message : String(error);
      setPlayerPreferenceState({ status: "error", message });
    }
  }

  async function handleProfilePinSave(event: React.FormEvent) {
    event.preventDefault();
    if (profilePinState.status === "saving") return;
    if (!/^\d{4}$/.test(profilePin)) {
      setProfilePinState({ status: "error", message: "Enter exactly four digits." });
      return;
    }

    const requestId = ++profilePinRequestRef.current;
    const replacingPin = profilePinLocked;
    setProfilePinState({ status: "saving" });
    try {
      const setting = await client.updateProfilePinSetting({ pin: profilePin });
      if (profilePinRequestRef.current !== requestId) return;
      setProfilePinLocked(setting.pin_locked);
      setProfilePin("");
      setProfilePinState({ status: "saved" });
      showToast(replacingPin ? "Profile PIN replaced." : "Profile PIN set.");
    } catch (error) {
      if (profilePinRequestRef.current !== requestId) return;
      const message = error instanceof ApiError ? error.message : String(error);
      setProfilePinState({ status: "error", message });
    }
  }

  async function handleProfilePinRemove() {
    if (profilePinState.status === "saving") return;
    const requestId = ++profilePinRequestRef.current;
    setProfilePinState({ status: "saving" });
    try {
      const setting = await client.updateProfilePinSetting({ pin: null });
      if (profilePinRequestRef.current !== requestId) return;
      setProfilePinLocked(setting.pin_locked);
      setProfilePin("");
      setProfilePinState({ status: "saved" });
      showToast("Profile PIN removed.");
    } catch (error) {
      if (profilePinRequestRef.current !== requestId) return;
      const message = error instanceof ApiError ? error.message : String(error);
      setProfilePinState({ status: "error", message });
    }
  }

  async function handleRequestFriendInvite() {
    const current = friendInviteState.status === "loading" ? null : friendInviteState.request;
    setFriendInviteState({ status: "saving", request: current });
    try {
      const request = await client.createUserInviteRequest();
      setFriendInviteState({ status: "ready", request });
      showToast("Invite request sent to your Streamarr admin.");
    } catch (error) {
      setFriendInviteState({
        status: "error",
        request: current,
        message: error instanceof ApiError ? error.message : String(error),
      });
    }
  }

  async function handleGenerateFriendInvite() {
    const current = friendInviteState.status === "loading" ? null : friendInviteState.request;
    setFriendInviteState({ status: "saving", request: current });
    try {
      const invite = await client.generateApprovedUserInvite();
      const url = new URL("/signup", "https://playarr.app");
      url.searchParams.set("server", apiBaseUrl);
      url.searchParams.set("invite", invite.invite_token);
      setFriendInviteLink(url.toString());
      setFriendInviteExpiresAt(invite.expires_at);
      setFriendInviteCopied(false);
      const request = await client.getMyUserInviteRequest();
      setFriendInviteState({ status: "ready", request });
      showToast("Friend invite generated. It is valid for 24 hours.");
    } catch (error) {
      setFriendInviteState({
        status: "error",
        request: current,
        message: error instanceof ApiError ? error.message : String(error),
      });
    }
  }

  async function handleCopyFriendInvite() {
    if (!friendInviteLink) return;
    try {
      await navigator.clipboard.writeText(friendInviteLink);
      setFriendInviteCopied(true);
      showToast("Invite link copied.");
    } catch {
      setFriendInviteState((current) => ({
        status: "error",
        request: current.status === "loading" ? null : current.request,
        message: "Could not copy the link. Select and copy it manually.",
      }));
    }
  }

  const selectedAudioLanguage =
    AUDIO_LANGUAGE_OPTIONS.find((option) => option.value === audioLanguage)?.label ?? "English";

  return (
    <div className="page settings-page">
      <div className="page-intro">
        <p className="page-kicker">Make it yours</p>
        <h1 className="page-title">Preferences</h1>
        <p className="page-description">Choose how Playarr looks and where it connects.</p>
      </div>

      <div className="settings-grid">
        <section className="card settings-card">
          <div className="settings-card-heading">
            <span className="settings-card-number">01</span>
            <div>
              <h2 className="section-title">Appearance</h2>
              <p className="muted">Follow this device or keep a theme fixed.</p>
            </div>
          </div>
          <div className="theme-choice" role="group" aria-label="Colour theme">
            {(["system", "light", "dark"] as ThemePreference[]).map((option) => (
              <button
                key={option}
                type="button"
                className={`theme-choice-button${preference === option ? " is-active" : ""}`}
                onClick={() => {
                  if (option === preference) return;
                  setPreference(option);
                  showToast("Theme preference saved.");
                }}
                aria-pressed={preference === option}
              >
                {option}
              </button>
            ))}
          </div>
        </section>

        <section className="card settings-card">
          <div className="settings-card-heading">
            <span className="settings-card-number">02</span>
            <div>
              <h2 className="section-title">Player</h2>
              <p className="muted">Choose the audio language Playarr should prioritise.</p>
            </div>
          </div>

          <div
            className="player-language-choice"
            role="radiogroup"
            aria-label="Preferred audio language"
            aria-busy={
              playerPreferenceState.status === "loading" ||
              playerPreferenceState.status === "saving"
            }
          >
            {AUDIO_LANGUAGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                className={`player-language-button${
                  audioLanguage === option.value ? " is-active" : ""
                }`}
                aria-checked={audioLanguage === option.value}
                onClick={() => void handleAudioLanguageChange(option.value)}
              >
                <span>{option.label}</span>
                <small>{option.value}</small>
              </button>
            ))}
          </div>

          <p
            className={`player-preference-status${
              playerPreferenceState.status === "error" ? " is-error" : ""
            }`}
            aria-live="polite"
          >
            {playerPreferenceState.status === "loading"
              ? "Loading your player preference…"
              : playerPreferenceState.status === "saving"
                ? `Saving ${selectedAudioLanguage}…`
                : playerPreferenceState.status === "error"
                  ? `Could not update the player preference (${playerPreferenceState.message}).`
                  : `${selectedAudioLanguage} will be selected when it is available.`}
          </p>
        </section>

        <section className="card settings-card settings-card-wide">
          <div className="settings-card-heading">
            <span className="settings-card-number">03</span>
            <div>
              <h2 className="section-title">Server connection</h2>
              <p className="muted">
                Combine libraries from multiple servers in one Playarr interface.
              </p>
            </div>
          </div>

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
                type="url"
                className={`input${addServerState.status === "error" ? " is-error" : ""}`}
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                placeholder="https://streamarr.example.com"
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

        <section className="card settings-card">
          <div className="settings-card-heading">
            <span className="settings-card-number">04</span>
            <div>
              <h2 className="section-title">Profile lock</h2>
              <p className="muted">
                Require a four-digit PIN before switching to {currentUserName ?? "this profile"}.
              </p>
            </div>
          </div>

          <form className="profile-pin-settings" onSubmit={(event) => void handleProfilePinSave(event)}>
            <label className="form-label" htmlFor="profile-lock-pin">
              {profilePinLocked ? "Replace PIN" : "New PIN"}
            </label>
            <div className="connection-form-row">
              <input
                id="profile-lock-pin"
                type="password"
                className={`input${profilePinState.status === "error" ? " is-error" : ""}`}
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={4}
                pattern="[0-9]{4}"
                placeholder="••••"
                value={profilePin}
                disabled={profilePinState.status === "loading" || profilePinState.status === "saving"}
                onChange={(event) => setProfilePin(event.target.value.replace(/\D/g, "").slice(0, 4))}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={
                  profilePin.length !== 4 ||
                  profilePinState.status === "loading" ||
                  profilePinState.status === "saving"
                }
              >
                {profilePinState.status === "saving" ? "Saving…" : profilePinLocked ? "Replace" : "Set PIN"}
              </button>
            </div>
          </form>

          <div className="profile-pin-settings-status" aria-live="polite">
            <p className={profilePinState.status === "error" ? "error-text" : "muted"}>
              {profilePinState.status === "loading"
                ? "Loading profile lock…"
                : profilePinState.status === "saving"
                  ? "Updating profile lock…"
                  : profilePinState.status === "error"
                    ? profilePinState.message
                    : profilePinLocked
                      ? "PIN lock is on."
                      : "PIN lock is off."}
            </p>
            {profilePinLocked ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={profilePinState.status === "saving"}
                onClick={() => void handleProfilePinRemove()}
              >
                Remove PIN
              </button>
            ) : null}
          </div>
        </section>

        <section className="card settings-card">
          <div className="settings-card-heading">
            <span className="settings-card-number">05</span>
            <div>
              <h2 className="section-title">Invite a friend</h2>
              <p className="muted">Ask your Streamarr admin for one friend-invite QR code.</p>
            </div>
          </div>
          {friendInviteState.status === "loading" ? (
            <p className="muted">Checking invite status…</p>
          ) : (
            <>
              <p className="muted" aria-live="polite">
                {!friendInviteState.request
                  ? "You have not requested an invite yet."
                  : friendInviteState.request.status === "pending"
                    ? "Waiting for an admin to review your request."
                    : friendInviteState.request.status === "approved"
                      ? "Approved — generate your QR code when you are ready to share it."
                      : friendInviteState.request.status === "denied"
                        ? "Your previous request was not approved. You can ask again."
                        : "Your approved invite was generated. Request another when you need one."}
              </p>
              {friendInviteState.status === "error" ? (
                <p className="error-text" role="alert">{friendInviteState.message}</p>
              ) : null}
              <button
                type="button"
                className="btn btn-primary"
                disabled={friendInviteState.status === "saving" || friendInviteState.request?.status === "pending"}
                onClick={() =>
                  friendInviteState.request?.status === "approved"
                    ? void handleGenerateFriendInvite()
                    : void handleRequestFriendInvite()
                }
              >
                {friendInviteState.status === "saving"
                  ? "Working…"
                  : friendInviteState.request?.status === "approved"
                    ? "Generate invite QR"
                    : friendInviteState.request?.status === "pending"
                      ? "Request pending"
                      : "Request invite QR"}
              </button>
            </>
          )}
        </section>

        <section className="card settings-card">
          <div className="settings-card-heading">
            <span className="settings-card-number">06</span>
            <div>
              <h2 className="section-title">Account</h2>
              <p className="muted">End this browser session and return to sign in.</p>
            </div>
          </div>
          <button type="button" className="btn btn-danger" onClick={handleSignOut}>
            Sign out
          </button>
        </section>
      </div>

      {friendInviteLink ? (
        <div
          className="server-choice-backdrop"
          role="presentation"
          onMouseDown={() => setFriendInviteLink(null)}
        >
          <section
            className="server-choice-modal friend-invite-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="friend-invite-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <p className="page-kicker">Ready to share</p>
            <h2 id="friend-invite-title">Invite a friend to Playarr</h2>
            <p className="muted">
              This one-use code opens Playarr with your Streamarr server already locked in.
            </p>
            <QrCode
              value={friendInviteLink}
              size={260}
              label="QR code for a Playarr friend invitation"
            />
            <label className="form-label" htmlFor="friend-invite-link">Invite link</label>
            <input
              id="friend-invite-link"
              className="input"
              value={friendInviteLink}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            {friendInviteExpiresAt ? (
              <p className="hint">
                Expires {new Date(friendInviteExpiresAt).toLocaleString()}. The invite can be used once.
              </p>
            ) : null}
            <div className="connection-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setFriendInviteLink(null)}>
                Close
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void handleCopyFriendInvite()}>
                {friendInviteCopied ? "Copied" : "Copy link"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
