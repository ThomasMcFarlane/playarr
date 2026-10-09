import { useEffect, useRef, type RefObject } from "react";

/**
 * Calls `onMarked` with each card the remote's virtual focus marker (`data-remote-active`) lands on inside
 * `rootRef`, in the same frame the key was handled. In remote mode real DOM focus trails the marker by its settle
 * time (320 ms), so anything that must follow what the viewer is looking at (a preview panel, centring a rail)
 * reads the marker instead of waiting for `focus`. Shared by the library grid and Home's rails.
 */
export function useRemoteMarkerFollow(
  rootRef: RefObject<HTMLElement | null>,
  onMarked: (card: HTMLElement) => void,
  /** Re-attaches the observer when the root element is replaced (for example once a list has loaded). */
  active: boolean
): void {
  const handler = useRef(onMarked);
  handler.current = onMarked;
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !active) return;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const card = record.target as HTMLElement;
        if (card.hasAttribute("data-remote-active")) handler.current(card);
      }
    });
    observer.observe(root, { subtree: true, attributes: true, attributeFilter: ["data-remote-active"] });
    return () => observer.disconnect();
  }, [rootRef, active]);
}
