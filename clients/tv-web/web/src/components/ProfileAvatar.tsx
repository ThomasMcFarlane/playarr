import { useEffect, useState, type CSSProperties } from "react";
import {
  PROFILE_AVATAR_CHANGED_EVENT,
  profileAvatarPreset,
  readProfileAvatar,
  syncProfileAvatar,
  type ProfileAvatarPreference,
  type ProfileAvatarSyncClient,
} from "../lib/profileAvatar";

interface ProfileAvatarProps {
  className?: string;
  preference: ProfileAvatarPreference;
}

function PresetArtwork({ preset }: { preset: ProfileAvatarPreference & { kind: "preset" } }) {
  switch (preset.preset) {
    case "astronaut":
      return (
        <svg viewBox="0 0 100 100" focusable="false">
          <circle cx="50" cy="42" r="29" fill="#eef5ff" />
          <circle cx="50" cy="42" r="21" fill="#21315f" />
          <path d="M31 77c4-13 14-20 19-20s15 7 19 20" fill="#eef5ff" />
          <circle cx="43" cy="39" r="3" fill="#fff" />
          <circle cx="57" cy="39" r="3" fill="#fff" />
          <path d="M44 49c4 3 8 3 12 0" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
          <path d="M21 25l-7-6m65 6 7-6" stroke="#d7e5ff" strokeWidth="4" strokeLinecap="round" />
        </svg>
      );
    case "cat":
      return (
        <svg viewBox="0 0 100 100" focusable="false">
          <path d="M24 37 18 15l25 13h14l25-13-6 22c8 7 12 17 10 28-3 17-18 25-36 25S17 82 14 65c-2-11 2-21 10-28Z" fill="#ffe0bd" />
          <path d="m24 28-2-8 11 6m43 2 2-8-11 6" fill="#ef8c92" />
          <path d="M32 52h8m20 0h8" stroke="#4b3550" strokeWidth="5" strokeLinecap="round" />
          <path d="m46 62 4 3 4-3m-4 3v6" fill="none" stroke="#4b3550" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M35 65 15 60m20 11-20 5m50-11 20-5m-20 11 20 5" stroke="#fff2df" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );
    case "dinosaur":
      return (
        <svg viewBox="0 0 100 100" focusable="false">
          <path d="m28 29-9-14 17 4 5-12 10 13 12-9 2 17c14 5 23 16 23 29 0 18-16 31-38 31S12 75 12 57c0-12 6-22 16-28Z" fill="#bde78b" />
          <circle cx="38" cy="49" r="5" fill="#254b45" />
          <circle cx="65" cy="49" r="5" fill="#254b45" />
          <circle cx="39" cy="47" r="1.5" fill="#fff" />
          <circle cx="66" cy="47" r="1.5" fill="#fff" />
          <path d="M38 66c8 7 17 7 25 0" fill="none" stroke="#254b45" strokeWidth="4" strokeLinecap="round" />
          <path d="m45 67 3 7 4-6 4 6 3-7" fill="#fff" />
        </svg>
      );
    case "robot":
      return (
        <svg viewBox="0 0 100 100" focusable="false">
          <path d="M50 20V9m0 0 7-5M50 9l-7-5" stroke="#e8fbff" strokeWidth="4" strokeLinecap="round" />
          <rect x="17" y="20" width="66" height="62" rx="17" fill="#dff7f7" />
          <rect x="26" y="34" width="48" height="31" rx="10" fill="#294263" />
          <circle cx="40" cy="49" r="5" fill="#72e3d3" />
          <circle cx="60" cy="49" r="5" fill="#72e3d3" />
          <path d="M40 72h20" stroke="#6a91a3" strokeWidth="4" strokeLinecap="round" />
          <path d="M17 43H9v18h8m66-18h8v18h-8" fill="none" stroke="#dff7f7" strokeWidth="6" strokeLinejoin="round" />
        </svg>
      );
    case "pirate":
      return (
        <svg viewBox="0 0 100 100" focusable="false">
          <circle cx="50" cy="53" r="34" fill="#f3c49e" />
          <path d="M18 35c7-20 54-25 68 2-23-8-44-6-68-2Z" fill="#802f4b" />
          <path d="M21 31 12 17c15-4 29 1 38 11" fill="#c84b58" />
          <circle cx="38" cy="52" r="4" fill="#3a2935" />
          <path d="M58 52h13m-7-8v16" stroke="#3a2935" strokeWidth="4" strokeLinecap="round" />
          <path d="M53 44c9-5 19-3 25 4" fill="none" stroke="#3a2935" strokeWidth="4" />
          <path d="M39 68c9 7 19 7 27-1" fill="none" stroke="#7e3e3f" strokeWidth="4" strokeLinecap="round" />
        </svg>
      );
    case "alien":
      return (
        <svg viewBox="0 0 100 100" focusable="false">
          <path d="M50 10c25 0 39 17 35 39-4 21-22 39-35 43-13-4-31-22-35-43C11 27 25 10 50 10Z" fill="#c7f0bd" />
          <path d="M25 43c9-8 18-8 24 1-5 14-17 18-24-1Zm50 0c-9-8-18-8-24 1 5 14 17 18 24-1Z" fill="#292949" />
          <circle cx="38" cy="45" r="2" fill="#fff" />
          <circle cx="62" cy="45" r="2" fill="#fff" />
          <path d="M42 72c5 2 11 2 16 0" fill="none" stroke="#4b765d" strokeWidth="3" strokeLinecap="round" />
          <circle cx="18" cy="20" r="3" fill="#e8dcff" />
          <circle cx="83" cy="17" r="2" fill="#e8dcff" />
        </svg>
      );
  }
}

export function ProfileAvatar({ className = "", preference }: ProfileAvatarProps) {
  const preset = profileAvatarPreset(preference);
  const style = {
    "--profile-colour-start": preset.start,
    "--profile-colour-end": preset.end,
  } as CSSProperties;

  return (
    <span
      className={`profile-avatar-visual${className ? ` ${className}` : ""}${
        preference.kind === "custom" ? " is-custom" : ""
      }`}
      style={style}
      aria-hidden="true"
    >
      {preference.kind === "custom" ? (
        <img src={preference.dataUrl} alt="" />
      ) : (
        <PresetArtwork preset={preference} />
      )}
    </span>
  );
}

export function useStoredProfileAvatar(
  scope: string | undefined,
  userId: string | undefined,
  client?: ProfileAvatarSyncClient
) {
  const [preference, setPreference] = useState<ProfileAvatarPreference | null>(() =>
    scope && userId ? readProfileAvatar(scope, userId) : null
  );

  useEffect(() => {
    let cancelled = false;
    setPreference(scope && userId ? readProfileAvatar(scope, userId) : null);
    if (!scope || !userId) return;
    if (client) {
      void syncProfileAvatar(client, scope, userId)
        .then((syncedPreference) => {
          if (!cancelled) setPreference(syncedPreference);
        })
        .catch(() => {
          // The local value remains usable while this device is offline.
        });
    }
    const handleChange = (event: Event) => {
      if (
        event instanceof CustomEvent &&
        (event.detail as { scope?: unknown } | null)?.scope !== scope
      ) {
        return;
      }
      setPreference(readProfileAvatar(scope, userId));
    };
    window.addEventListener(PROFILE_AVATAR_CHANGED_EVENT, handleChange);
    return () => {
      cancelled = true;
      window.removeEventListener(PROFILE_AVATAR_CHANGED_EVENT, handleChange);
    };
  }, [client, scope, userId]);

  return preference;
}
