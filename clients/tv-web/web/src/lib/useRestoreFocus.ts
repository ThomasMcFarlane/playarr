import { useEffect } from "react";

/**
 * Whether closing a dialog should hand focus back to the control that opened it: the opener must still be on
 * the page, and focus must have fallen to the body (the dialog's own controls just unmounted). Focus the viewer
 * has already moved elsewhere is left alone.
 */
export function shouldRestoreFocus(input: {
  openerConnected: boolean;
  activeIsBody: boolean;
  activeIsOpener: boolean;
}): boolean {
  return input.openerConnected && input.activeIsBody && !input.activeIsOpener;
}

/**
 * Remembers the control focused when a modal mounts and returns focus to it when the modal unmounts (audit
 * A10). Call it before any effect that moves focus into the dialog, so the opener is captured first.
 */
export function useRestoreFocusOnClose(): void {
  useEffect(() => {
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    return () => {
      if (!opener) return;
      const current = document.activeElement;
      if (
        shouldRestoreFocus({
          openerConnected: opener.isConnected,
          activeIsBody: current === null || current === document.body,
          activeIsOpener: current === opener,
        })
      ) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);
}
