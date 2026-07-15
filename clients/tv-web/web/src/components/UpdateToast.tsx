import type { AppUpdateState } from "../lib/appUpdate";

export interface UpdateToastProps {
  state: AppUpdateState;
}

/**
 * The dismissible "Update available" toast for the Web app's OTA flow (see
 * `lib/appUpdate.ts`). Renders nothing once dismissed or when there is
 * nothing to report. The forced-reload case (`state.mustReload`) doesn't
 * need its own UI here -- `useAppUpdate` triggers that reload itself as
 * soon as it's detected, so by the time this would render, the page is
 * already on its way to a fresh reload.
 */
export function UpdateToast({ state }: UpdateToastProps) {
  if (!state.updateAvailable) return null;

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        bottom: "1.5rem",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.75rem 1rem",
        borderRadius: 8,
        backgroundColor: "#1e1e1e",
        border: "1px solid #2a2a2a",
        color: "#ffffff",
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
      }}
    >
      <span>A new version of Streamarr is available.</span>
      <button
        type="button"
        onClick={state.reloadNow}
        style={{
          padding: "0.35rem 0.9rem",
          borderRadius: 6,
          border: "none",
          background: "#e50914",
          color: "#ffffff",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Reload
      </button>
      <button
        type="button"
        onClick={state.dismiss}
        aria-label="Dismiss"
        style={{
          background: "none",
          border: "none",
          color: "#a0a0a0",
          cursor: "pointer",
          fontSize: "1rem",
          padding: "0 0.25rem",
        }}
      >
        &times;
      </button>
    </div>
  );
}
