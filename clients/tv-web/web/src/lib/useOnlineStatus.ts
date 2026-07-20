import { useEffect, useState } from "react";

/**
 * Live `navigator.onLine` state, kept in sync via the `online`/`offline`
 * window events. `navigator.onLine` itself is a coarse, best-effort signal
 * (true just means "has a network interface", not "can reach the server"),
 * but it's the same signal every browser download manager and PWA offline
 * banner uses, and it's enough to gate the offline-mode surfaces described
 * in the downloads feature: soft-gating pages, and skipping playback
 * negotiation in favour of a local copy.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
