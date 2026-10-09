import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import { CastUnavailableError } from "../../lib/cast/castSdk";

export interface CastButtonProps {
  /** Hidden entirely (renders nothing) whenever this is false -- matches `<google-cast-launcher>`'s own behaviour of disappearing rather than showing a disabled state. */
  available: boolean;
  connected: boolean;
  deviceName?: string | null;
  /**
   * Starts or ends a cast session, depending on `connected`. `CastButton`
   * tracks its own transient "connecting" state around the returned
   * promise, and shows a caught failure inline -- callers don't need to
   * thread any extra pending/error props through for that.
   */
  onToggleCast: () => Promise<void>;
}

/** How long a failed cast attempt keeps its message on screen. */
export const CAST_ERROR_VISIBLE_MS = 6000;

/**
 * The pending state must not use the `disabled` attribute: a disabled button drops D-pad focus to the body for
 * the whole wait (audit P15). `aria-disabled` keeps focus; clicks are ignored in the handler.
 */
export function castPendingAttributes(pending: boolean): { "aria-disabled"?: true; "aria-busy"?: true } {
  return pending ? { "aria-disabled": true, "aria-busy": true } : {};
}

function CastIcon({ className, connected }: { className?: string; connected: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="3" y="4" width="18" height="13" rx="1.5" />
      <path d="M3 12.5a7.5 7.5 0 0 1 7.5 7.5" />
      <path d="M3 8.5a11.5 11.5 0 0 1 11.5 11.5" />
      <circle cx="4.6" cy="19.4" r="1.7" fill={connected ? "currentColor" : "none"} stroke={connected ? "none" : "currentColor"} />
    </svg>
  );
}

/**
 * Custom "cast to Chromecast" button -- deliberately not the native
 * `<google-cast-launcher>` element, to match Playarr's own player chrome
 * (see the other buttons in `PlayerControls.tsx`). Forwards its ref to the
 * underlying `<button>` so `PlayerControls` can include it in the same
 * D-pad left/right row-navigation array every other control button is
 * already part of.
 */
export const CastButton = forwardRef<HTMLButtonElement, CastButtonProps>(function CastButton(
  { available, connected, deviceName, onToggleCast },
  ref
) {
  const { t } = useLanguage();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const mountedRef = useRef(true);
  const errorTimerRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.clearTimeout(errorTimerRef.current);
    };
  }, []);

  const handleClick = useCallback(() => {
    if (pending) return;
    window.clearTimeout(errorTimerRef.current);
    setErrorMessage(undefined);
    setPending(true);
    onToggleCast()
      .catch((error: unknown) => {
        const message =
          error instanceof CastUnavailableError
            ? t(
                error.reason === "insecure-server"
                  ? "components.player.cast.unavailableInsecureServer"
                  : "components.player.cast.unavailableBrowser"
              )
            : t("components.player.cast.error");
        if (!mountedRef.current) return;
        setErrorMessage(message);
        errorTimerRef.current = window.setTimeout(() => {
          if (mountedRef.current) setErrorMessage(undefined);
        }, CAST_ERROR_VISIBLE_MS);
      })
      .finally(() => {
        if (mountedRef.current) setPending(false);
      });
  }, [onToggleCast, pending, t]);

  if (!available) return null;

  const label = connected
    ? t("components.player.cast.disconnect")
    : pending
      ? t("components.player.cast.connecting")
      : t("components.player.cast.button");
  const title =
    connected && deviceName ? t("components.player.cast.playingOn", { device: deviceName }) : undefined;

  return (
    <div className="player-quality">
      {errorMessage ? (
        <p className="player-quality-error" role="status">
          {errorMessage}
        </p>
      ) : null}
      <button
        ref={ref}
        type="button"
        className={`player-btn player-tool-button${pending ? " is-busy" : ""}`}
        aria-label={label}
        aria-pressed={connected}
        title={title}
        {...castPendingAttributes(pending)}
        onClick={handleClick}
      >
        <CastIcon connected={connected} />
        {pending ? <span className="player-tool-pending" aria-hidden="true" /> : null}
      </button>
    </div>
  );
});
