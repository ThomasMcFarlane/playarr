/**
 * Long-poll loop that makes this device a remote-control target
 * (docs/architecture/remote-control.md). Pure TypeScript over an injected
 * client so the protocol handling is testable without a browser or server.
 */
import type { RemoteInboxEvent } from "@playarr-tv/api-client";
import type { RemoteCommandOutcome } from "./commands";

export interface RemoteTargetClient {
  registerRemoteTarget(body: {
    name: string;
    platform?: string;
    capabilities: string[];
  }): Promise<unknown>;
  pollRemoteInbox(
    after: number,
    wait: number,
    signal?: AbortSignal
  ): Promise<{ events: RemoteInboxEvent[]; next: number }>;
  ackRemoteEvent(
    eventId: string,
    status: "ok" | "failed" | "unsupported",
    detail?: string
  ): Promise<void>;
  ackRemoteHandoff(
    id: string,
    body: { status: "playing" | "failed"; position_ms?: number; reason?: string }
  ): Promise<unknown>;
  reportRemoteState(state: Record<string, unknown>): Promise<void>;
}

export interface PairingRequest {
  pairingId: string;
  controllerName: string;
  verificationCode: string;
  scopes: string[];
}

export interface HandoffOffer {
  handoffId: string;
  mediaFileId: string;
  workId: string;
  positionMs: number;
  paused: boolean;
  audioLanguage?: string;
  subtitleLanguage?: string;
  expiresMs: number;
}

export type HandoffResult =
  | { status: "playing"; positionMs: number }
  | { status: "failed"; reason: string };

export interface TargetHandlers {
  onPairingRequest(request: PairingRequest): void;
  onPairingRevoked(pairingId: string): void;
  execute(kind: string, args: Record<string, unknown>): Promise<RemoteCommandOutcome> | RemoteCommandOutcome;
  onHandoffOffer(offer: HandoffOffer): Promise<HandoffResult>;
  onHandoffStop(handoffId: string): void;
  /** Current playback state to report for handoff, or `null` when idle. */
  currentState(): Record<string, unknown> | null;
}

export interface TargetHostOptions {
  name: string;
  platform: string;
  capabilities: string[];
  pollSeconds?: number;
  stateIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function parseHandoffOffer(payload: unknown): HandoffOffer | null {
  const p = record(payload);
  const snapshot = record(p.snapshot);
  if (typeof p.handoff_id !== "string" || typeof p.media_file_id !== "string") return null;
  return {
    handoffId: p.handoff_id,
    mediaFileId: p.media_file_id,
    workId: typeof p.work_id === "string" ? p.work_id : "",
    positionMs: typeof snapshot.position_ms === "number" ? snapshot.position_ms : 0,
    paused: snapshot.paused === true,
    audioLanguage: typeof snapshot.audio_language === "string" ? snapshot.audio_language : undefined,
    subtitleLanguage:
      typeof snapshot.subtitle_language === "string" ? snapshot.subtitle_language : undefined,
    expiresMs: typeof p.expires_ms === "number" ? p.expires_ms : 0,
  };
}

export class RemoteTargetHost {
  private running = false;
  private abort: AbortController | null = null;
  private stateTimer: ReturnType<typeof setInterval> | null = null;
  private lastStateJson = "";
  private lastStateSentAt = 0;
  private after = 0;

  constructor(
    private readonly client: RemoteTargetClient,
    private readonly handlers: TargetHandlers,
    private readonly options: TargetHostOptions
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.abort = new AbortController();
    void this.loop(this.abort.signal);
    this.stateTimer = setInterval(
      () => void this.reportState(),
      this.options.stateIntervalMs ?? 5_000
    );
  }

  stop(): void {
    this.running = false;
    this.abort?.abort();
    this.abort = null;
    if (this.stateTimer) clearInterval(this.stateTimer);
    this.stateTimer = null;
  }

  /** Report immediately (e.g. when playback starts/pauses) in addition to the interval. */
  async reportState(): Promise<void> {
    if (!this.running) return;
    const state = this.handlers.currentState();
    if (!state) return;
    const json = JSON.stringify(state);
    const now = Date.now();
    // Unchanged state is still re-sent every 15 s so the server's copy stays fresh.
    if (json === this.lastStateJson && now - this.lastStateSentAt < 15_000) return;
    try {
      await this.client.reportRemoteState(state);
      this.lastStateJson = json;
      this.lastStateSentAt = now;
    } catch {
      // Best effort: the next tick retries.
    }
  }

  private async loop(signal: AbortSignal): Promise<void> {
    const sleep = this.options.sleep ?? defaultSleep;
    let backoff = 1_000;
    let registered = false;
    while (this.running && !signal.aborted) {
      try {
        if (!registered) {
          await this.client.registerRemoteTarget({
            name: this.options.name,
            platform: this.options.platform,
            capabilities: this.options.capabilities,
          });
          registered = true;
        }
        const inbox = await this.client.pollRemoteInbox(
          this.after,
          this.options.pollSeconds ?? 25,
          signal
        );
        backoff = 1_000;
        for (const event of inbox.events) {
          await this.handle(event);
        }
        this.after = Math.max(this.after, inbox.next);
      } catch (error) {
        if (signal.aborted || !this.running) return;
        // A 404 means the server forgot this target; register again.
        if (record(error).status === 404) registered = false;
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 15_000);
      }
    }
  }

  async handle(event: RemoteInboxEvent): Promise<void> {
    const payload = record(event.payload);
    try {
      switch (event.kind) {
        case "pairing_request":
          this.handlers.onPairingRequest({
            pairingId: String(payload.pairing_id ?? event.pairing_id ?? ""),
            controllerName: String(payload.controller_name ?? ""),
            verificationCode: String(payload.verification_code ?? ""),
            scopes: Array.isArray(payload.scopes) ? payload.scopes.map(String) : [],
          });
          await this.ack(event.id, { status: "ok" });
          break;
        case "pairing_revoked":
          this.handlers.onPairingRevoked(String(payload.pairing_id ?? event.pairing_id ?? ""));
          await this.ack(event.id, { status: "ok" });
          break;
        case "command": {
          const outcome = await this.handlers.execute(
            String(payload.kind ?? ""),
            record(payload.args)
          );
          await this.ack(event.id, outcome);
          break;
        }
        case "handoff_offer": {
          const offer = parseHandoffOffer(event.payload);
          if (!offer) {
            await this.ack(event.id, { status: "failed", detail: "malformed offer" });
            break;
          }
          // Do not block the inbox while the destination starts playback.
          void this.runOffer(offer);
          await this.ack(event.id, { status: "ok" });
          break;
        }
        case "handoff_stop":
          this.handlers.onHandoffStop(String(payload.handoff_id ?? ""));
          await this.ack(event.id, { status: "ok" });
          break;
        default:
          await this.ack(event.id, { status: "unsupported", detail: "unknown event" });
      }
    } catch {
      await this.ack(event.id, { status: "failed", detail: "handler error" });
    }
  }

  private async runOffer(offer: HandoffOffer): Promise<void> {
    let result: HandoffResult;
    try {
      result = await this.handlers.onHandoffOffer(offer);
    } catch {
      result = { status: "failed", reason: "playback failed to start" };
    }
    try {
      await this.client.ackRemoteHandoff(
        offer.handoffId,
        result.status === "playing"
          ? { status: "playing", position_ms: Math.max(0, Math.round(result.positionMs)) }
          : { status: "failed", reason: result.reason }
      );
    } catch {
      // The offer expires server-side and the source keeps playing.
    }
  }

  private async ack(eventId: string, outcome: RemoteCommandOutcome): Promise<void> {
    try {
      await this.client.ackRemoteEvent(
        eventId,
        outcome.status,
        outcome.status === "ok" ? undefined : outcome.detail
      );
    } catch {
      // Already acknowledged or expired: nothing more to do.
    }
  }
}
