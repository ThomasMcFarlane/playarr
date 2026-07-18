export const ANDROID_TV_UPDATE_EVENT = "playarr:android-update";

export type AndroidTvUpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up_to_date"; versionName?: string }
  | { status: "downloading"; versionName?: string; progress?: number }
  | { status: "permission_required"; versionName?: string }
  | { status: "installing"; versionName?: string }
  | { status: "error"; message: string };

interface AndroidTvNativeBridge {
  checkForUpdates(): void;
}

declare global {
  interface Window {
    PlayarrAndroid?: AndroidTvNativeBridge;
  }
}

export function canCheckForAndroidTvUpdates(
  bridge: AndroidTvNativeBridge | undefined =
    typeof window === "undefined" ? undefined : window.PlayarrAndroid
): boolean {
  return typeof bridge?.checkForUpdates === "function";
}

export function requestAndroidTvUpdate(
  bridge: AndroidTvNativeBridge | undefined =
    typeof window === "undefined" ? undefined : window.PlayarrAndroid
): boolean {
  if (!canCheckForAndroidTvUpdates(bridge)) return false;
  bridge?.checkForUpdates();
  return true;
}

export function parseAndroidTvUpdateState(detail: unknown): AndroidTvUpdateState | null {
  if (!detail || typeof detail !== "object") return null;
  const value = detail as Record<string, unknown>;
  const versionName = typeof value.versionName === "string" ? value.versionName : undefined;

  switch (value.status) {
    case "checking":
      return { status: "checking" };
    case "up_to_date":
      return { status: "up_to_date", versionName };
    case "downloading":
      return {
        status: "downloading",
        versionName,
        progress:
          typeof value.progress === "number"
            ? Math.max(0, Math.min(100, Math.round(value.progress)))
            : undefined,
      };
    case "permission_required":
      return { status: "permission_required", versionName };
    case "installing":
      return { status: "installing", versionName };
    case "error":
      return {
        status: "error",
        message:
          typeof value.message === "string" && value.message.length > 0
            ? value.message
            : "Could not update Playarr.",
      };
    default:
      return null;
  }
}

export function subscribeToAndroidTvUpdates(
  listener: (state: AndroidTvUpdateState) => void,
  target: Pick<Window, "addEventListener" | "removeEventListener"> = window
): () => void {
  const handleUpdate = (event: Event) => {
    const state = parseAndroidTvUpdateState((event as CustomEvent<unknown>).detail);
    if (state) listener(state);
  };
  target.addEventListener(ANDROID_TV_UPDATE_EVENT, handleUpdate);
  return () => target.removeEventListener(ANDROID_TV_UPDATE_EVENT, handleUpdate);
}
