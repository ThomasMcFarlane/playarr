/**
 * Watch-progress / lifecycle-event reporting for the active cast session.
 * The receiver owns this entirely while a cast is active (Ground Truth: the
 * sender only ever sends intent, never raw position writes, once a cast has
 * taken over).
 *
 * - A heartbeat fires roughly every 10s while the player is PLAYING or
 *   BUFFERING (mirrors `usePlaybackEngine.ts`'s own 10s heartbeat cadence).
 * - A terminal flush (`stop` or `error`) fires on ended/error/`session.end`,
 *   deduplicated per session id so a flush is never sent twice for the same
 *   session (e.g. an `ended` event immediately followed by an explicit
 *   `session.end`).
 * - Positions are ALWAYS `engineTimeMs + sourceOffsetMs` -- never raw engine
 *   time -- since an on-demand HLS session's engine time starts back at
 *   zero every time it's re-negotiated (see `negotiation.ts`).
 */
import type { PlaybackEventKind } from "@playarr-tv/api-client";
import type { PlayarrCastStopReason } from "@playarr-tv/cast-protocol";

/** The one `ApiClient` method this module needs. */
export interface ProgressReporterClient {
  recordPlaybackEvent(sessionId: string, event: PlaybackEventKind): Promise<void>;
}

/** The subset of CAF player states this module cares about driving the heartbeat/terminal-flush state machine. */
export type PlayerActivityState = "playing" | "buffering" | "paused" | "ended" | "error" | "idle";

export interface ProgressReporterOptions {
  /** Defaults to 10 seconds. */
  heartbeatIntervalMs?: number;
  setIntervalFn?: (handler: () => void, intervalMs: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;

export type TerminalOutcome =
  | { kind: "stop"; reason: PlayarrCastStopReason }
  | { kind: "error"; message: string };

export class ProgressReporter {
  private readonly client: ProgressReporterClient;
  private readonly heartbeatIntervalMs: number;
  private readonly setIntervalFn: NonNullable<ProgressReporterOptions["setIntervalFn"]>;
  private readonly clearIntervalFn: NonNullable<ProgressReporterOptions["clearIntervalFn"]>;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sessionId: string | null = null;
  private engineTimeMs = 0;
  private sourceOffsetMs = 0;
  private readonly flushedSessionIds = new Set<string>();

  constructor(client: ProgressReporterClient, options: ProgressReporterOptions = {}) {
    this.client = client;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.setIntervalFn = options.setIntervalFn ?? ((handler, ms) => setInterval(handler, ms));
    this.clearIntervalFn = options.clearIntervalFn ?? ((handle) => clearInterval(handle));
  }

  /** Absolute source-timeline position in ms -- ALWAYS engine time + source offset, never raw engine time. */
  get positionMs(): number {
    return Math.max(0, Math.round(this.engineTimeMs + this.sourceOffsetMs));
  }

  get activeSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Adopts a freshly (re)negotiated session. Does NOT itself flush the
   * previous session -- `negotiation.ts` already closes the superseded
   * server session as part of negotiating the new one; this only updates
   * what heartbeats/terminal flushes report against from now on.
   */
  setSession(sessionId: string, sourceOffsetMs: number): void {
    this.sessionId = sessionId;
    this.sourceOffsetMs = sourceOffsetMs;
  }

  /** Call on every engine time update (e.g. CAF's `TIME_UPDATE` event), independent of play state. */
  setEngineTimeMs(engineTimeMs: number): void {
    this.engineTimeMs = engineTimeMs;
  }

  /** Drives the heartbeat on/off as the player's activity state changes, and triggers a terminal flush on `ended`/`error`. */
  onStateChange(state: PlayerActivityState): void {
    if (state === "playing" || state === "buffering") {
      this.startHeartbeat();
    } else {
      this.stopHeartbeat();
    }

    if (state === "ended") {
      void this.flushTerminal({ kind: "stop", reason: "completed" });
    } else if (state === "error") {
      void this.flushTerminal({ kind: "error", message: "Player entered a terminal error state" });
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = this.setIntervalFn(() => {
      void this.sendHeartbeat();
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    this.clearIntervalFn(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async sendHeartbeat(): Promise<void> {
    const sessionId = this.sessionId;
    if (!sessionId) return;
    await this.client
      .recordPlaybackEvent(sessionId, { kind: "heartbeat", position_ms: this.positionMs })
      .catch(() => {
        // Analytics must never interrupt playback -- the next heartbeat or terminal flush retries.
      });
  }

  /**
   * Terminal flush on ended/error/`session.end`. Deduplicated per session
   * id: a second call for the same (already-flushed) session id is a
   * silent no-op, so `ended` immediately followed by an explicit
   * `session.end` (or any other double-trigger) never double-fires.
   */
  async flushTerminal(outcome: TerminalOutcome): Promise<void> {
    const sessionId = this.sessionId;
    if (!sessionId || this.flushedSessionIds.has(sessionId)) return;
    this.flushedSessionIds.add(sessionId);
    this.stopHeartbeat();

    const event: PlaybackEventKind =
      outcome.kind === "stop"
        ? { kind: "stop", reason: outcome.reason, position_ms: this.positionMs }
        : { kind: "error", message: outcome.message };
    await this.client.recordPlaybackEvent(sessionId, event).catch(() => {
      // Best-effort -- teardown must never throw.
    });
  }

  /** Stops any running heartbeat. Call on receiver shutdown. */
  dispose(): void {
    this.stopHeartbeat();
  }
}
