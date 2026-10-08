import { useEffect, useRef, useState } from "react";
import { ApiError } from "@playarr-tv/api-client";
import { usePrimaryApiClient, useAuth } from "../../lib/ApiClientProvider";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useToast } from "../../lib/toast";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import { SettingsSectionLayout } from "./SettingsSectionLayout";
import { Button } from "../../components/ui";

type ProfilePinState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

export function SettingsProfileLockPage() {
  const { t } = useLanguage();
  useDocumentTitle(t("settings.profileLock.documentTitle"));
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
      setProfilePinState({ status: "error", message: t("settings.profileLock.errorFourDigits") });
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
      showToast(
        replacingPin ? t("settings.profileLock.toastReplaced") : t("settings.profileLock.toastSet"),
      );
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
      showToast(t("settings.profileLock.toastRemoved"));
    } catch (error) {
      if (profilePinRequestRef.current !== requestId) return;
      const message = error instanceof ApiError ? error.message : String(error);
      setProfilePinState({ status: "error", message });
    }
  }

  return (
    <SettingsSectionLayout>
      <section className="card settings-card settings-card-wide">
        <form className="profile-pin-settings" onSubmit={(event) => void handleProfilePinSave(event)}>
          <label className="form-label" htmlFor="profile-lock-pin">
            {profilePinLocked
              ? t("settings.profileLock.replacePinLabel")
              : t("settings.profileLock.newPinLabel")}
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
            <Button
              type="submit" variant="primary"
              disabled={
                profilePin.length !== 4 ||
                profilePinState.status === "loading" ||
                profilePinState.status === "saving"
              }
            >
              {profilePinState.status === "saving"
                ? t("settings.profileLock.saving")
                : profilePinLocked
                  ? t("settings.profileLock.replace")
                  : t("settings.profileLock.setPin")}
            </Button>
          </div>
        </form>

        <div className="profile-pin-settings-status" aria-live="polite">
          <p className={profilePinState.status === "error" ? "error-text" : "muted"}>
            {profilePinState.status === "loading"
              ? t("settings.profileLock.loading")
              : profilePinState.status === "saving"
                ? t("settings.profileLock.updating")
                : profilePinState.status === "error"
                  ? profilePinState.message
                  : profilePinLocked
                    ? t("settings.profileLock.lockOn")
                    : t("settings.profileLock.lockOff")}
          </p>
          {profilePinLocked ? (
            <Button
              type="button" size="sm"
              disabled={profilePinState.status === "saving"}
              onClick={() => void handleProfilePinRemove()}
            >
              {t("settings.profileLock.removePin")}
            </Button>
          ) : null}
        </div>
      </section>
    </SettingsSectionLayout>
  );
}
