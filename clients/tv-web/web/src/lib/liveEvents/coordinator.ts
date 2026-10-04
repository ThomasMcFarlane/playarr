import type { LiveChangeEvent, LiveReadyEvent } from "@playarr-tv/api-client";
import { mapChangeToInvalidations } from "./mapping";
import type { LiveRegistry } from "./registry";
import { createSseParser } from "./sse";

export type LiveStreamStatus =
  /** Not running: signed out, hidden or stopped. */
  | "paused"
  | "connecting"
  | "live"
  /** Reconnect pending after an error. */
  | "down"
  /** Server has no (usable) event stream; polling only until the next foreground/sign-in/server change. */
  | "unsupported";

export interface LiveCoordinatorOptions {
  registry: LiveRegistry;
  /** Opens `GET /api/v1/events`; must honour `signal` and send `Last-Event-ID` when given. */
  open: (options: { lastEventId?: string; signal: AbortSignal }) => Promise<Response>;
  /** Fallback poll interval while the stream is not live (30 s; 60 s on TV). */
  pollIntervalMs?: number;
  now?: () => number;
  random?: () => number;
  onStatus?: (status: LiveStreamStatus) => void;
}

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const STABLE_AFTER_MS = 60_000;
const DEFAULT_RETENTION_MS = 10 * 60_000;
const DEFAULT_HEARTBEAT_MS = 15_000;

/** Pure: 1 s, 2 s, 4 s ... capped at 30 s, plus up to 25 % jitter (still capped). */
export function backoffDelayMs(attempt: number, random: number): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
  return Math.min(BACKOFF_MAX_MS, Math.round(base + random * base * 0.25));
}

/** Pure: is this response a usable live stream? */
export function isEventStreamResponse(response: Pick<Response, "status" | "headers">): boolean {
  return response.status === 200 && /^\s*text\/event-stream\b/i.test(response.headers.get("content-type") ?? "");
}

/** Transient server states keep retrying; anything else that is not a stream means "older server". */
function isTransientStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 408 || status === 425 || status === 429 || status >= 500;
}

export interface LiveCoordinator {
  /** Foreground and signed in (true) or hidden/signed out (false). */
  setActive(active: boolean): void;
  /** New account or server: forget the cursor and any "unsupported" verdict. */
  reset(): void;
  status(): LiveStreamStatus;
  dispose(): void;
}

export function createLiveCoordinator(options: LiveCoordinatorOptions): LiveCoordinator {
  const { registry, open } = options;
  const pollIntervalMs = options.pollIntervalMs ?? 30_000;
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;

  let status: LiveStreamStatus = "paused";
  let active = false;
  let disposed = false;
  let lastEventId: string | undefined;
  let retentionMs = DEFAULT_RETENTION_MS;
  let heartbeatMs = DEFAULT_HEARTBEAT_MS;
  let clockOffsetMs = 0;
  let hiddenAt: number | null = null;
  let attempt = 0;
  let liveSince = 0;
  let gap = false;
  let abort: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const setStatus = (next: LiveStreamStatus) => {
    if (status === next) return;
    status = next;
    syncPolling();
    options.onStatus?.(next);
  };

  function syncPolling() {
    const wanted = active && status !== "live";
    if (wanted && pollTimer === null) {
      pollTimer = setInterval(() => registry.refetchAll(), pollIntervalMs);
    } else if (!wanted && pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  const clearReconnect = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };
  const clearWatchdog = () => {
    if (watchdog !== null) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  };

  function armWatchdog(controller: AbortController) {
    clearWatchdog();
    // Heartbeats arrive every `heartbeatMs`; silence for three of them is a dead socket.
    watchdog = setTimeout(() => {
      onDisconnected(false, controller);
      controller.abort();
    }, Math.max(heartbeatMs * 3, 5_000));
  }

  const scheduleReconnect = (delayMs: number) => {
    clearReconnect();
    if (!active || disposed) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delayMs);
  };

  /** Connection ended (error or server close): decide how soon to come back. */
  function onDisconnected(cleanClose: boolean, controller: AbortController) {
    clearWatchdog();
    if (abort !== controller || !active || disposed) return;
    abort = null;
    const wasLive = liveSince > 0;
    const stable = wasLive && now() - liveSince >= STABLE_AFTER_MS;
    liveSince = 0;
    if (stable) attempt = 0;
    if (cleanClose && wasLive && stable) {
      // The server's ~5 minute close: resume straight away with Last-Event-ID.
      setStatus("connecting");
      scheduleReconnect(0);
      return;
    }
    gap = true;
    setStatus("down");
    scheduleReconnect(backoffDelayMs(attempt, random()));
    attempt += 1;
  }

  async function connect() {
    if (!active || disposed || abort) return;
    const controller = new AbortController();
    abort = controller;
    setStatus("connecting");
    let response: Response;
    try {
      response = await open({ lastEventId, signal: controller.signal });
    } catch {
      onDisconnected(false, controller);
      return;
    }
    if (abort !== controller) {
      void response.body?.cancel().catch(() => undefined);
      return;
    }
    if (!isEventStreamResponse(response)) {
      void response.body?.cancel().catch(() => undefined);
      if (isTransientStatus(response.status)) {
        onDisconnected(false, controller);
      } else {
        abort = null;
        setStatus("unsupported");
      }
      return;
    }
    const body = response.body;
    if (!body) {
      onDisconnected(false, controller);
      return;
    }

    const parser = createSseParser({
      onComment: () => armWatchdog(controller),
      onFrame: (frame) => {
        armWatchdog(controller);
        if (abort !== controller) return;
        if (frame.id !== undefined && frame.id !== "") lastEventId = frame.id;
        let payload: unknown;
        try {
          payload = JSON.parse(frame.data);
        } catch {
          return;
        }
        if (frame.event === "ready") {
          const ready = payload as Partial<LiveReadyEvent>;
          if (typeof ready.retention_ms === "number" && ready.retention_ms > 0) retentionMs = ready.retention_ms;
          if (typeof ready.heartbeat_ms === "number" && ready.heartbeat_ms > 0) heartbeatMs = ready.heartbeat_ms;
          if (typeof ready.server_time_ms === "number") clockOffsetMs = now() - ready.server_time_ms;
          liveSince = now();
          setStatus("live");
          armWatchdog(controller);
          if (gap) {
            gap = false;
            registry.refetchAll();
          }
        } else if (frame.event === "change") {
          const change = payload as LiveChangeEvent;
          if (typeof change?.type !== "string") return;
          const at = typeof change.at === "number" ? change.at + clockOffsetMs : undefined;
          registry.invalidate(mapChange(change), at);
        } else if (frame.event === "resync") {
          registry.refetchAll();
        }
      },
    });

    const reader = body.getReader();
    const decoder = new TextDecoder();
    armWatchdog(controller);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (abort !== controller) return;
        parser.push(decoder.decode(value, { stream: true }));
      }
      onDisconnected(true, controller);
    } catch {
      onDisconnected(false, controller);
    }
  }

  const stopConnection = () => {
    clearReconnect();
    clearWatchdog();
    const controller = abort;
    abort = null;
    liveSince = 0;
    controller?.abort();
  };

  return {
    setActive(next) {
      if (disposed || next === active) return;
      active = next;
      if (!next) {
        stopConnection();
        hiddenAt = now();
        setStatus("paused");
        syncPolling();
        return;
      }
      if (hiddenAt !== null) {
        // The server only replays `retention_ms`; beyond that, treat everything as stale.
        if (now() - hiddenAt > retentionMs) {
          lastEventId = undefined;
          registry.refetchAll();
        }
        hiddenAt = null;
      }
      // A foreground retries a stream an older server could not provide.
      attempt = 0;
      setStatus("connecting");
      void connect();
    },
    reset() {
      stopConnection();
      lastEventId = undefined;
      retentionMs = DEFAULT_RETENTION_MS;
      attempt = 0;
      gap = false;
      hiddenAt = null;
      if (active) {
        setStatus("connecting");
        void connect();
      } else {
        setStatus("paused");
      }
    },
    status: () => status,
    dispose() {
      disposed = true;
      active = false;
      stopConnection();
      syncPolling();
    },
  };
}

function mapChange(change: LiveChangeEvent) {
  return mapChangeToInvalidations({
    type: change.type,
    entity: change.entity,
    id: change.id,
    changed: Array.isArray(change.changed) ? change.changed : [],
  });
}
