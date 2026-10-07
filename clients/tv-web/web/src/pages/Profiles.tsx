import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { describeApiError } from "@playarr-tv/api-client";
import { isPinRequiredError } from "@playarr-tv/device-auth";
import { useApiBaseUrl, useApiClient, useAuth } from "../lib/ApiClientProvider";
import { selectDeviceProfiles } from "../lib/deviceProfiles";
import { ProfileAvatar, useStoredProfileAvatar } from "../components/ProfileAvatar";
import { profileAvatarScope, readProfileAvatar } from "../lib/profileAvatar";
import { SettingsIcon } from "../components/NavIcons";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import {
  navigationOriginFromState,
  useNavigationLayer,
} from "../lib/navigationLayer";
import { TvStageChrome } from "../components/tv/TvStage";
import { clearActivePlayerSession } from "../lib/playerSession";
import { useTvNavigation } from "../lib/useTvNavigation";
import { shouldRevalidateCurrentProfile } from "../lib/profileNavigation";
import {
  requestAndroidTvUpdate,
  subscribeToAndroidTvUpdates,
  type AndroidTvUpdateState,
} from "../lib/androidTvUpdate";
import { IS_TV, PLAYARR_CLIENT_PLATFORM } from "../lib/clientPlatform";

interface ProfileLocationState {
  backTo?: unknown;
  loginFrom?: unknown;
  navigationOrigin?: unknown;
}

interface ViewerProfile {
  id: string;
  username: string;
  name: string;
  isCurrent: boolean;
  isSaved: boolean;
  pinLocked: boolean;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

type ProfileAction = "select" | "settings";

const ADD_PROFILE_ID = "__add_profile__";

function safeBackTo(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && value !== "/profiles"
    ? value
    : "/";
}

function safeLoginFrom(value: unknown, fallback: string): string {
  return typeof value === "string" && value.startsWith("/") && value !== "/profiles"
    ? value
    : fallback;
}

function profileStyle(index = 0): CSSProperties {
  return {
    "--profile-index": index,
  } as CSSProperties;
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 5H5v14h5" />
      <path d="M13 8l4 4-4 4M8 12h9" />
    </svg>
  );
}

export function ProfilesPage(
  { loginFrom: loginFromOverride }: { loginFrom?: string } = {}
) {
  const { t } = useLanguage();
  useDocumentTitle(t("pages.profiles.title"));
  const client = useApiClient();
  const [apiBaseUrl] = useApiBaseUrl();
  const {
    currentUserId,
    currentUserName,
    savedProfiles,
    isProfileSaved,
    switchProfile,
    unlockProfile,
    logoutProfile,
  } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = location.state as ProfileLocationState | null;
  const backTo = safeBackTo(locationState?.backTo);
  const loginFrom = safeLoginFrom(loginFromOverride ?? locationState?.loginFrom, backTo);
  // `navigationOriginFromState` builds a fresh object on every call. Feeding
  // that straight into `useTvNavigation` tore down and re-armed its key
  // listeners, observers and focus timer on every render of this page, so key
  // the origin on its two primitives instead.
  const stateOrigin = navigationOriginFromState(locationState);
  const originRoute = stateOrigin?.route;
  const originEntryKey = stateOrigin?.entryKey;
  const navigationOrigin = useMemo(
    () =>
      originRoute !== undefined && originEntryKey !== undefined
        ? { route: originRoute, entryKey: originEntryKey }
        : null,
    [originRoute, originEntryKey]
  );
  const navigationLayer = useNavigationLayer("profiles");
  useTvNavigation(location.pathname, false, backTo, navigationOrigin);
  const [serverProfiles, setServerProfiles] = useState<ViewerProfile[] | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string>(
    currentUserId ?? ADD_PROFILE_ID
  );
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [pinProfile, setPinProfile] = useState<ViewerProfile | null>(null);
  const [pinAction, setPinAction] = useState<ProfileAction>("select");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSubmitting, setPinSubmitting] = useState(false);
  // True when the PIN is for the server-side unlock lease of a saved profile
  // (the server answered `pin_required`), not the pre-switch verification.
  const [pinForLease, setPinForLease] = useState(false);
  const [updateState, setUpdateState] = useState<AndroidTvUpdateState>({
    status: "idle",
  });
  const pinInputRef = useRef<HTMLInputElement>(null);
  const isAndroidTv = PLAYARR_CLIENT_PLATFORM === "android-tv";
  const currentAvatarScope = currentUserId
    ? profileAvatarScope(apiBaseUrl, currentUserId)
    : undefined;
  const currentAvatar = useStoredProfileAvatar(
    currentAvatarScope,
    currentUserId,
    client
  );

  useEffect(() => {
    if (!loginFromOverride) clearActivePlayerSession();
  }, [loginFromOverride]);

  useEffect(() => {
    if (!isAndroidTv) return;
    return subscribeToAndroidTvUpdates(setUpdateState);
  }, [isAndroidTv]);

  const fallbackProfiles = useMemo<ViewerProfile[]>(() => {
    const profiles = savedProfiles.map((profile) => ({
      id: profile.userId,
      username: profile.name,
      name: profile.name,
      isCurrent: profile.userId === currentUserId,
      isSaved: true,
      // PINs are strictly opt-in. A loading or failed profile-directory
      // request must never invent a lock the viewer did not configure.
      pinLocked: false,
    }));
    if (currentUserId && !profiles.some((profile) => profile.id === currentUserId)) {
      profiles.unshift({
        id: currentUserId,
        username: currentUserName ?? t("pages.profiles.viewerFallbackName"),
        name: currentUserName ?? t("pages.profiles.viewerFallbackName"),
        isCurrent: true,
        isSaved: true,
        pinLocked: false,
      });
    }
    return profiles;
  }, [currentUserId, currentUserName, savedProfiles, t]);

  const profiles = serverProfiles ?? fallbackProfiles;
  const selectedIndex = selectedId !== ADD_PROFILE_ID
    ? profiles.findIndex((profile) => profile.id === selectedId)
    : profiles.length;
  const selectedProfile =
    selectedIndex >= 0 && selectedIndex < profiles.length
      ? profiles[selectedIndex]
      : null;
  const lastProfile = profiles[profiles.length - 1];
  const hasCurrentProfile = profiles.some((profile) => profile.isCurrent);

  const returnFromProfiles = useCallback(() => {
    if (navigationOrigin) {
      navigate(-1);
    } else {
      navigate(backTo);
    }
  }, [backTo, navigate, navigationOrigin]);

  const openSettings = useCallback(() => {
    const origin = navigationLayer.capture(
      document.querySelector<HTMLElement>("#profile-settings")
    );
    navigate("/settings", {
      state: {
        backTo: "/profiles",
        navigationOrigin: origin,
      },
    });
  }, [navigate, navigationLayer]);

  const continueToLogin = useCallback(
    (
      profile: ViewerProfile | null,
      destination: string,
      destinationState?: unknown
    ) => {
      navigate(IS_TV ? "/login/qr" : "/login", {
        state: {
          from: destination,
          fromState: destinationState,
          initialUsername: profile?.username,
          profileTransition: true,
        },
      });
    },
    [navigate]
  );

  useEffect(() => {
    if (!currentUserId) {
      setServerProfiles(null);
      setLoadState({ status: "ready" });
      return;
    }
    let cancelled = false;
    setLoadState({ status: "loading" });
    void client
      .listAvailableProfiles()
      .then((available) => {
        if (cancelled) return;
        setServerProfiles(
          selectDeviceProfiles(available, isProfileSaved, currentUserId).map((profile) => ({
            id: profile.id,
            username: profile.username,
            name: profile.display_name || profile.username,
            isCurrent: profile.is_current || profile.id === currentUserId,
            isSaved: isProfileSaved(profile.id),
            pinLocked: profile.pin_locked,
          }))
        );
        setLoadState({ status: "ready" });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setServerProfiles(null);
        setLoadState({ status: "error", message: describeApiError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [client, currentUserId, isProfileSaved]);

  useEffect(() => {
    if (profiles.length === 0) {
      setSelectedId(ADD_PROFILE_ID);
      return;
    }
    if (selectedId === ADD_PROFILE_ID) return;
    if (selectedId && profiles.some((profile) => profile.id === selectedId)) return;
    setSelectedId(
      profiles.find((profile) => profile.isCurrent)?.id ??
        profiles[0]?.id ??
        ADD_PROFILE_ID
    );
  }, [profiles, selectedId]);

  useEffect(() => {
    if (!pinProfile) return;
    const frame = window.requestAnimationFrame(() => pinInputRef.current?.focus());
    const handleBack = (event: KeyboardEvent) => {
      const isBack =
        event.key === "Escape" ||
        event.key === "BrowserBack" ||
        event.key === "GoBack" ||
        event.keyCode === 10009 ||
        event.keyCode === 461;
      if (!isBack) return;
      event.preventDefault();
      event.stopPropagation();
      closePinPrompt();
    };
    window.addEventListener("keydown", handleBack, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleBack, true);
    };
  }, [pinProfile]);

  async function completeProfileAction(
    profile: ViewerProfile,
    action: ProfileAction
  ) {
    if (
      profile.isCurrent &&
      !shouldRevalidateCurrentProfile(profile.isCurrent, action, loginFromOverride)
    ) {
      if (action === "settings") openSettings();
      else returnFromProfiles();
      return;
    }

    if (!profile.isSaved) {
      const settingsOrigin =
        action === "settings"
          ? navigationLayer.capture(
              document.querySelector<HTMLElement>("#profile-settings")
            )
          : undefined;
      continueToLogin(
        profile,
        action === "settings" ? "/settings" : loginFrom,
        action === "settings"
          ? { backTo: "/profiles", navigationOrigin: settingsOrigin }
          : undefined
      );
      return;
    }

    setSwitchingId(profile.id);
    try {
      await switchProfile(profile.id);
      if (action === "settings") openSettings();
      else navigate(loginFrom, { replace: true });
    } catch (error) {
      if (isPinRequiredError(error)) {
        // The saved session is intact; the server only wants the PIN.
        setSwitchingId(null);
        setPin("");
        setPinError(null);
        setPinAction(action);
        setPinForLease(true);
        setPinProfile(profile);
        return;
      }
      setLoadState({ status: "error", message: describeApiError(error) });
      setSwitchingId(null);
      const settingsOrigin =
        action === "settings"
          ? navigationLayer.capture(
              document.querySelector<HTMLElement>("#profile-settings")
            )
          : undefined;
      continueToLogin(
        profile,
        action === "settings" ? "/settings" : loginFrom,
        action === "settings"
          ? { backTo: "/profiles", navigationOrigin: settingsOrigin }
          : undefined
      );
    }
  }

  function requestProfileAction(profile: ViewerProfile, action: ProfileAction) {
    setSelectedId(profile.id);
    if (profile.pinLocked && !profile.isCurrent) {
      setPin("");
      setPinError(null);
      setPinAction(action);
      setPinForLease(false);
      setPinProfile(profile);
      return;
    }
    void completeProfileAction(profile, action);
  }

  async function submitPin(event: FormEvent) {
    event.preventDefault();
    if (!pinProfile || !/^\d{4}$/.test(pin) || pinSubmitting) return;
    setPinSubmitting(true);
    setPinError(null);
    try {
      if (pinForLease) {
        const leaseProfile = pinProfile;
        const leaseAction = pinAction;
        await unlockProfile(leaseProfile.id, pin);
        setPinProfile(null);
        setPin("");
        setPinForLease(false);
        setPinSubmitting(false);
        if (leaseAction === "settings") openSettings();
        else navigate(loginFrom, { replace: true });
        return;
      }
      const result = await client.verifyProfilePin(pinProfile.id, { pin });
      if (!result.verified) {
        setPinError(t("pages.profiles.pinNotAccepted"));
        setPinSubmitting(false);
        return;
      }
      const profile = pinProfile;
      const action = pinAction;
      setPinProfile(null);
      setPin("");
      setPinSubmitting(false);
      await completeProfileAction(profile, action);
    } catch (error) {
      setPinError(describeApiError(error));
      setPinSubmitting(false);
    }
  }

  function closePinPrompt() {
    const profileId = pinProfile?.id;
    setPinProfile(null);
    setPin("");
    setPinError(null);
    setPinForLease(false);
    setPinSubmitting(false);
    window.requestAnimationFrame(() => {
      if (!profileId) return;
      document
        .querySelector<HTMLElement>(`#profile-${CSS.escape(profileId)}`)
        ?.focus({ preventScroll: true });
    });
  }

  function handleProfileLogout(profile: ViewerProfile) {
    logoutProfile(profile.id);
    setServerProfiles((existing) =>
      existing?.map((candidate) =>
        candidate.id === profile.id
          ? { ...candidate, isCurrent: false, isSaved: false }
          : candidate
      ) ?? null
    );
  }

  function checkForUpdates() {
    setUpdateState({ status: "checking" });
    if (!requestAndroidTvUpdate()) {
      setUpdateState({
        status: "error",
        message: t("pages.profiles.updateUnavailable"),
      });
    }
  }

  const updateLabel = (() => {
    switch (updateState.status) {
      case "checking":
        return t("pages.profiles.updateChecking");
      case "up_to_date":
        return t("pages.profiles.updateCurrent");
      case "downloading":
        return updateState.progress === undefined
          ? t("pages.profiles.updateDownloading")
          : t("pages.profiles.updateDownloadingProgress", {
              progress: updateState.progress,
            });
      case "permission_required":
        return t("pages.profiles.updateAllowInstall");
      case "installing":
        return t("pages.profiles.updateInstalling");
      case "error":
        return t("pages.profiles.updateRetry");
      default:
        return t("pages.profiles.checkForUpdates");
    }
  })();
  const updateBusy =
    updateState.status === "checking" ||
    updateState.status === "downloading" ||
    updateState.status === "installing";

  return (
    <div className="profiles-page">
      <TvStageChrome />

      <header className="profiles-heading">
        <p>{t("pages.profiles.title")}</p>
        <h1>{t("pages.profiles.heading")}</h1>
      </header>

      <div
        className="profiles-row"
        data-tv-scroll-container
        data-tv-scroll-axis="horizontal"
        data-navigation-scroll-key="profiles:row"
      >
        <div className="profiles-track">
          {profiles.map((profile, index) => {
            const selected = profile.id === selectedProfile?.id;
            const previous = profiles[index - 1];
            const next = profiles[index + 1];
            return (
              <div
                key={profile.id}
                className={`profile-choice${selected ? " is-selected" : ""}`}
                style={profileStyle(index)}
              >
                <button
                  id={`profile-${profile.id}`}
                  type="button"
                  className="profile-avatar-button"
                  data-tv-focus-default={
                    profile.isCurrent || (!hasCurrentProfile && index === 0)
                      ? true
                      : undefined
                  }
                  data-navigation-focus-key={`profiles:${profile.id}`}
                  data-tv-edge-target-left={
                    previous ? `#profile-${previous.id}` : undefined
                  }
                  data-tv-edge-target-right={
                    next ? `#profile-${next.id}` : "#profile-add"
                  }
                  data-tv-edge-target-down="#profile-settings"
                  aria-label={
                    profile.isCurrent
                      ? t("pages.profiles.avatarLabelCurrent", { name: profile.name })
                      : t("pages.profiles.avatarLabel", { name: profile.name })
                  }
                  aria-pressed={selected}
                  disabled={switchingId !== null}
                  onFocus={() => setSelectedId(profile.id)}
                  onClick={() => requestProfileAction(profile, "select")}
                >
                  <ProfileAvatar
                    className="profile-avatar"
                    preference={
                      profile.id === currentUserId && currentAvatar
                        ? currentAvatar
                        : readProfileAvatar(
                            profileAvatarScope(apiBaseUrl, profile.id),
                            profile.id
                          )
                    }
                  />
                  <strong>{profile.name}</strong>
                  <small>
                    {switchingId === profile.id
                      ? t("pages.profiles.statusSwitching")
                      : profile.isCurrent
                        ? t("pages.profiles.statusCurrent")
                        : profile.pinLocked
                          ? t("pages.profiles.statusPinRequired")
                          : profile.isSaved
                            ? t("pages.profiles.statusReady")
                            : t("pages.profiles.statusSignInRequired")}
                  </small>
                </button>
                {selected ? (
                  <div className="profile-actions">
                    <button
                      id="profile-settings"
                      type="button"
                      className="profile-action-button profile-settings-button"
                      aria-label={t("pages.profiles.settingsFor", { name: profile.name })}
                      data-navigation-focus-key={`profiles:${profile.id}:settings`}
                      data-tv-edge-target-up={`#profile-${profile.id}`}
                      data-tv-edge-target-right="#profile-sign-out"
                      onClick={() => requestProfileAction(profile, "settings")}
                    >
                      <SettingsIcon />
                    </button>
                    {profile.isSaved || profile.isCurrent ? (
                      <button
                        id="profile-sign-out"
                        type="button"
                        className="profile-action-button profile-sign-out-button"
                        aria-label={`${t("settings.account.signOut")} ${profile.name}`}
                        data-navigation-focus-key={`profiles:${profile.id}:sign-out`}
                        data-tv-edge-target-up={`#profile-${profile.id}`}
                        data-tv-edge-target-left="#profile-settings"
                        onClick={() => handleProfileLogout(profile)}
                      >
                        <SignOutIcon />
                        <strong>{t("settings.account.signOut")}</strong>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}

          <div
            className={`profile-choice profile-add${
              !selectedProfile ? " is-selected" : ""
            }`}
            style={{ "--profile-index": profiles.length } as CSSProperties}
          >
            <button
              id="profile-add"
              type="button"
              className="profile-avatar-button"
              data-tv-focus-default={profiles.length === 0 ? true : undefined}
              data-navigation-focus-key="profiles:add"
              data-tv-edge-target-left={
                lastProfile ? `#profile-${lastProfile.id}` : undefined
              }
              data-tv-edge-target-down={
                isAndroidTv ? "#profiles-check-updates" : "#profiles-clients"
              }
              onFocus={() => setSelectedId(ADD_PROFILE_ID)}
              onClick={() => continueToLogin(null, loginFrom)}
            >
              <span className="profile-avatar" aria-hidden="true">
                <span>+</span>
              </span>
              <strong>{t("pages.profiles.signIn")}</strong>
              <small>{t("pages.profiles.addAnotherProfile")}</small>
            </button>
          </div>
        </div>
      </div>

      {isAndroidTv ? (
        <div className="profile-update-control">
          <button
            id="profiles-check-updates"
            type="button"
            className="profile-update-button"
            data-navigation-focus-key="profiles:check-updates"
            data-tv-edge-target-up="#profile-add"
            data-tv-edge-target-right="#profiles-clients"
            disabled={updateBusy}
            onClick={checkForUpdates}
          >
            {updateLabel}
          </button>
          {updateState.status === "error" ? (
            <span role="alert">{updateState.message}</span>
          ) : null}
        </div>
      ) : null}

      <Link
        id="profiles-clients"
        className="profile-clients-link"
        to="/clients"
        data-navigation-focus-key="profiles:clients"
        data-tv-edge-target-up="#profile-add"
        data-tv-edge-target-left={isAndroidTv ? "#profiles-check-updates" : undefined}
      >
        {t("pages.clients.navClients")}
        <span aria-hidden="true">→</span>
      </Link>

      {loadState.status === "loading" ? (
        <div className="profiles-status" role="status">
          <span className="tv-mini-loader" aria-hidden="true" />
          <span>{t("pages.profiles.loading")}</span>
        </div>
      ) : loadState.status === "error" ? (
        <p className="profiles-status is-error" role="alert">
          {t("pages.profiles.errorShowingSaved", { message: loadState.message })}
        </p>
      ) : null}

      {pinProfile ? (
        <div className="profile-pin-backdrop" role="presentation">
          <section
            className="profile-pin-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-pin-title"
          >
            <button
              type="button"
              className="profile-pin-close"
              aria-label={t("pages.profiles.closePinPrompt")}
              onClick={closePinPrompt}
            >
              ×
            </button>
            <ProfileAvatar
              className="profile-pin-avatar"
              preference={
                pinProfile.id === currentUserId && currentAvatar
                  ? currentAvatar
                  : readProfileAvatar(
                      profileAvatarScope(apiBaseUrl, pinProfile.id),
                      pinProfile.id
                    )
              }
            />
            <p>{t("pages.profiles.switchProfile")}</p>
            <h2 id="profile-pin-title">{pinProfile.name}</h2>
            <form onSubmit={(event) => void submitPin(event)}>
              <label htmlFor="profile-pin">{t("pages.profiles.enterPin")}</label>
              <input
                ref={pinInputRef}
                id="profile-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]{4}"
                maxLength={4}
                value={pin}
                aria-invalid={Boolean(pinError)}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
              />
              {pinError ? <p className="profile-pin-error">{pinError}</p> : null}
              <button type="submit" disabled={pin.length !== 4 || pinSubmitting}>
                {pinSubmitting ? t("pages.profiles.checking") : t("pages.profiles.continue")}
              </button>
            </form>
            <button
              type="button"
              className="profile-pin-sign-in"
              onClick={() => {
                const settingsOrigin =
                  pinAction === "settings"
                    ? navigationLayer.capture(
                        document.querySelector<HTMLElement>("#profile-settings")
                      )
                    : undefined;
                continueToLogin(
                  pinProfile,
                  pinAction === "settings" ? "/settings" : backTo,
                  pinAction === "settings"
                    ? {
                        backTo: "/profiles",
                        navigationOrigin: settingsOrigin,
                      }
                    : undefined
                );
              }}
            >
              {t("pages.profiles.useAccountSignIn")}
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
