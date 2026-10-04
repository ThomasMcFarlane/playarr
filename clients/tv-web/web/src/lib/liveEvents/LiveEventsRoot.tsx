import type { ReactNode } from "react";
import { useApiBaseUrl, useAuth, usePrimaryApiClient } from "../ApiClientProvider";
import { IS_TV } from "../clientPlatform";
import { LiveEventsProvider } from "./LiveEventsProvider";

/** Fallback poll cadence while the stream is down (docs/architecture/live-events.md). */
const POLL_FOREGROUND_MS = 30_000;
const POLL_TV_MS = 60_000;

/** App-root wiring: one live stream while signed in and visible. */
export function LiveEventsRoot({ children }: { children: ReactNode }) {
  const client = usePrimaryApiClient();
  const { currentUserId, authFailed } = useAuth();
  const [apiBaseUrl] = useApiBaseUrl();
  return (
    <LiveEventsProvider
      client={client}
      signedInKey={currentUserId && !authFailed ? currentUserId : undefined}
      serverKey={apiBaseUrl}
      pollIntervalMs={IS_TV ? POLL_TV_MS : POLL_FOREGROUND_MS}
    >
      {children}
    </LiveEventsProvider>
  );
}
