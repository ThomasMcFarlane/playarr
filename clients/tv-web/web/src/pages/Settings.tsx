import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, type VersionEnvelope } from "@streamarr-tv/api-client";
import { DEFAULT_API_BASE_URL, normaliseApiBaseUrl } from "@streamarr-tv/domain";
import { useApiBaseUrl, useApiClient, useAuth } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useTheme, type ThemePreference } from "../lib/theme";

/** Restores the actual default (this page's own origin -- see `ApiClientProvider.tsx`) when the field is cleared. */
function defaultApiBaseUrl(): string {
  return typeof window !== "undefined" ? window.location.origin : DEFAULT_API_BASE_URL;
}

type ConnectionTestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; version: VersionEnvelope }
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
  const [apiBaseUrl, setApiBaseUrl] = useApiBaseUrl();
  const client = useApiClient();
  const { currentUserName, logout } = useAuth();
  const navigate = useNavigate();
  const { preference, setPreference } = useTheme();
  const [draft, setDraft] = useState(apiBaseUrl);
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

  function handleSave(event: React.FormEvent) {
    event.preventDefault();
    try {
      const normalised = normaliseApiBaseUrl(draft.trim() || defaultApiBaseUrl());
      if (normalised !== apiBaseUrl) {
        setApiBaseUrl(normalised);
        navigate("/login", { replace: true });
        return;
      }
      setDraft(normalised);
      setTestState({ status: "idle" });
    } catch (error) {
      setTestState({
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
    setProfilePinState({ status: "saving" });
    try {
      const setting = await client.updateProfilePinSetting({ pin: profilePin });
      if (profilePinRequestRef.current !== requestId) return;
      setProfilePinLocked(setting.pin_locked);
      setProfilePin("");
      setProfilePinState({ status: "saved" });
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
    } catch (error) {
      if (profilePinRequestRef.current !== requestId) return;
      const message = error instanceof ApiError ? error.message : String(error);
      setProfilePinState({ status: "error", message });
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
                onClick={() => setPreference(option)}
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
                Playarr connects directly from this browser to the server selected at sign-in.
              </p>
            </div>
          </div>

          <form onSubmit={handleSave} className="connection-form">
            <label className="form-label" htmlFor="api-base-url">
              API base URL
            </label>
            <div className="connection-form-row">
              <input
                id="api-base-url"
                type="text"
                className={`input${testState.status === "error" ? " is-error" : ""}`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={defaultApiBaseUrl()}
              />
              <button type="submit" className="btn btn-primary">
                Change server
              </button>
            </div>
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
            Changing server signs out the current profile so credentials and sessions stay scoped
            to the correct Streamarr instance.
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
              <h2 className="section-title">Account</h2>
              <p className="muted">End this browser session and return to sign in.</p>
            </div>
          </div>
          <button type="button" className="btn btn-danger" onClick={handleSignOut}>
            Sign out
          </button>
        </section>
      </div>
    </div>
  );
}
