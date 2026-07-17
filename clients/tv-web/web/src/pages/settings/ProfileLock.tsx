import { useEffect, useRef, useState } from "react";
import { ApiError } from "@streamarr-tv/api-client";
import { usePrimaryApiClient, useAuth } from "../../lib/ApiClientProvider";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useToast } from "../../lib/toast";
import { SettingsSectionLayout } from "./SettingsSectionLayout";

type ProfilePinState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

export function SettingsProfileLockPage() {
  useDocumentTitle("Profile lock — Settings");
  const client = usePrimaryApiClient();
  const { currentUserName } = useAuth();
  const { showToast } = useToast();
  const [profilePin, setProfilePin] = useState("");
  const [profilePinLocked, setProfilePinLocked] = useState(false);
  const [profilePinState, setProfilePinState] = useState<ProfilePinState>({
    status: "loading",
  });
  const profilePinRequestRef = useRef(0);

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

  return (
    <SettingsSectionLayout
      kicker="Make it yours"
      title="Profile lock"
      description={`Require a four-digit PIN before switching to ${currentUserName ?? "this profile"}.`}
    >
      <section className="card settings-card settings-card-wide">
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
    </SettingsSectionLayout>
  );
}
