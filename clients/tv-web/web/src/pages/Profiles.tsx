import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { describeApiError } from "@streamarr-tv/api-client";
import { useApiClient, useAuth } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import {
  navigationOriginFromState,
  useNavigationLayer,
} from "../lib/navigationLayer";

interface ProfileLocationState {
  backTo?: unknown;
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

const PROFILE_COLOURS = [
  ["#ee718f", "#9b1e4e"],
  ["#f4a261", "#a8442e"],
  ["#70c1b3", "#176b68"],
  ["#7e8ce0", "#3f3d8f"],
  ["#c78ee8", "#713f8d"],
  ["#d8b35d", "#7b5a18"],
] as const;

function safeBackTo(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && value !== "/profiles"
    ? value
    : "/";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "P"
  );
}

function colourIndex(id: string): number {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash % PROFILE_COLOURS.length;
}

function profileStyle(profile: ViewerProfile): CSSProperties {
  const [start, end] =
    PROFILE_COLOURS[colourIndex(profile.id)] ?? ["#ee718f", "#9b1e4e"];
  return {
    "--profile-colour-start": start,
    "--profile-colour-end": end,
  } as CSSProperties;
}

export function ProfilesPage() {
  useDocumentTitle("Profiles");
  const client = useApiClient();
  const {
    currentUserId,
    currentUserName,
    savedProfiles,
    isProfileSaved,
    switchProfile,
  } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = location.state as ProfileLocationState | null;
  const backTo = safeBackTo(locationState?.backTo);
  const navigationOrigin = navigationOriginFromState(locationState);
  const navigationLayer = useNavigationLayer("profiles");
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
  const pinInputRef = useRef<HTMLInputElement>(null);

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
        username: currentUserName ?? "Viewer",
        name: currentUserName ?? "Viewer",
        isCurrent: true,
        isSaved: true,
        pinLocked: false,
      });
    }
    return profiles;
  }, [currentUserId, currentUserName, savedProfiles]);

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
      navigate("/login", {
        state: {
          from: destination,
          fromState: destinationState,
          initialUsername: profile?.username,
        },
      });
    },
    [navigate]
  );

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    void client
      .listAvailableProfiles()
      .then((available) => {
        if (cancelled) return;
        setServerProfiles(
          available.map((profile) => ({
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
    if (profile.isCurrent) {
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
        action === "settings" ? "/settings" : backTo,
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
      else returnFromProfiles();
    } catch (error) {
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
        action === "settings" ? "/settings" : backTo,
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
      const result = await client.verifyProfilePin(pinProfile.id, { pin });
      if (!result.verified) {
        setPinError("That PIN was not accepted.");
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
    setPinSubmitting(false);
    window.requestAnimationFrame(() => {
      if (!profileId) return;
      document
        .querySelector<HTMLElement>(`#profile-${CSS.escape(profileId)}`)
        ?.focus({ preventScroll: true });
    });
  }

  return (
    <div className="profiles-page">
      <button
        type="button"
        className="tv-back profiles-back"
        aria-label="Back"
        onClick={returnFromProfiles}
      >
        ←
      </button>

      <header className="profiles-heading">
        <p>Profiles</p>
        <h1>Who’s watching?</h1>
      </header>

      <div
        className="profiles-row"
        data-tv-scroll-container
        data-tv-scroll-axis="horizontal"
        data-navigation-scroll-key="profiles:row"
      >
        {profiles.map((profile, index) => {
          const selected = profile.id === selectedProfile?.id;
          const previous = profiles[index - 1];
          const next = profiles[index + 1];
          return (
            <div
              key={profile.id}
              className={`profile-choice${selected ? " is-selected" : ""}`}
              style={profileStyle(profile)}
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
                aria-label={`${profile.name}${profile.isCurrent ? ", current profile" : ""}`}
                aria-pressed={selected}
                disabled={switchingId !== null}
                onFocus={() => setSelectedId(profile.id)}
                onClick={() => requestProfileAction(profile, "select")}
              >
                <span className="profile-avatar" aria-hidden="true">
                  <span>{initials(profile.name)}</span>
                </span>
                <strong>{profile.name}</strong>
                <small>
                  {switchingId === profile.id
                    ? "Switching…"
                    : profile.isCurrent
                      ? "Watching now"
                      : profile.pinLocked
                        ? "PIN required"
                        : profile.isSaved
                          ? "Ready"
                          : "Sign in required"}
                </small>
              </button>
              {selected ? (
                <button
                  id="profile-settings"
                  type="button"
                  className="profiles-settings-link"
                  data-navigation-focus-key={`profiles:${profile.id}:settings`}
                  data-tv-edge-target-up={`#profile-${profile.id}`}
                  onClick={() => requestProfileAction(profile, "settings")}
                >
                  <span aria-hidden="true">⚙</span>
                  <strong>{profile.name} settings</strong>
                </button>
              ) : null}
            </div>
          );
        })}

        <div
          className={`profile-choice profile-add${
            !selectedProfile ? " is-selected" : ""
          }`}
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
            data-tv-edge-target-down="#profile-settings"
            onFocus={() => setSelectedId(ADD_PROFILE_ID)}
            onClick={() => continueToLogin(null, backTo)}
          >
            <span className="profile-avatar" aria-hidden="true">
              <span>+</span>
            </span>
            <strong>Sign in</strong>
            <small>Add another profile</small>
          </button>
          {!selectedProfile ? (
            <button
              id="profile-settings"
              type="button"
              className="profiles-settings-link"
              data-navigation-focus-key="profiles:add:settings"
              data-tv-edge-target-up="#profile-add"
              onClick={openSettings}
            >
              <span aria-hidden="true">⚙</span>
              <strong>Settings</strong>
            </button>
          ) : null}
        </div>
      </div>

      {loadState.status === "loading" ? (
        <div className="profiles-status" role="status">
          <span className="tv-mini-loader" aria-hidden="true" />
          <span>Loading profiles…</span>
        </div>
      ) : loadState.status === "error" ? (
        <p className="profiles-status is-error" role="alert">
          Showing saved profiles. {loadState.message}
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
              aria-label="Close PIN prompt"
              onClick={closePinPrompt}
            >
              ×
            </button>
            <div className="profile-pin-avatar" style={profileStyle(pinProfile)}>
              {initials(pinProfile.name)}
            </div>
            <p>Switch profile</p>
            <h2 id="profile-pin-title">{pinProfile.name}</h2>
            <form onSubmit={(event) => void submitPin(event)}>
              <label htmlFor="profile-pin">Enter four-digit PIN</label>
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
                {pinSubmitting ? "Checking…" : "Continue"}
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
              Use account sign-in
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
