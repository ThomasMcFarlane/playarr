/**
 * Custom-channel ("urn:x-cast:app.playarr.cast.v1") plumbing: registers the
 * one raw-message listener CAF gives us, parses + dispatches it to a typed
 * per-message-type callback, and provides the receiver -> sender send paths
 * (a throttled state broadcast, request/ack correlation, and error
 * emission).
 *
 * `CastMessageChannel` is a minimal, hand-rolled interface over
 * `CastReceiverContext.addCustomMessageListener`/`.sendCustomMessage` --
 * see `capabilities.ts`'s `CastCapabilityProbe` doc comment for why this
 * codebase abstracts the ambient CAF SDK this way: it keeps this dispatch
 * logic testable against a fake channel under plain vitest, with no real
 * `cast` global required.
 */
import {
  PLAYARR_CAST_PROTOCOL_VERSION,
  isPlayarrCastSenderMessage,
  parsePlayarrCastMessage,
  type PlayarrCastAckMessage,
  type PlayarrCastAuthUpdateMessage,
  type PlayarrCastEndSessionMessage,
  type PlayarrCastErrorCode,
  type PlayarrCastErrorMessage,
  type PlayarrCastPlayNextMessage,
  type PlayarrCastReceiverMessage,
  type PlayarrCastRequestStateMessage,
  type PlayarrCastSelectQualityMessage,
  type PlayarrCastSelectTracksMessage,
  type PlayarrCastSetQueueMessage,
  type PlayarrCastStateMessage,
} from "@playarr-tv/cast-protocol";

export interface CastMessageChannel {
  /** Registers the single handler CAF invokes for every message on this namespace. `CastMessageBus` calls this exactly once, from its constructor. */
  addListener(handler: (senderId: string, raw: unknown) => void): void;
  /** Sends to one sender, or every connected sender when `senderId` is `undefined` (broadcast). */
  send(senderId: string | undefined, message: PlayarrCastReceiverMessage): void;
}

export interface CastMessageHandlers {
  onAuthUpdate?: (message: PlayarrCastAuthUpdateMessage, senderId: string) => void;
  onSelectTracks?: (message: PlayarrCastSelectTracksMessage, senderId: string) => void;
  onSelectQuality?: (message: PlayarrCastSelectQualityMessage, senderId: string) => void;
  onSetQueue?: (message: PlayarrCastSetQueueMessage, senderId: string) => void;
  onPlayNext?: (message: PlayarrCastPlayNextMessage, senderId: string) => void;
  onStateRequest?: (message: PlayarrCastRequestStateMessage, senderId: string) => void;
  onEndSession?: (message: PlayarrCastEndSessionMessage, senderId: string) => void;
  /** Anything that arrives on the namespace but isn't a recognized, valid sender message (parse failure, protocol version mismatch, or a receiver-only message type echoed back). */
  onUnrecognized?: (raw: unknown, senderId: string) => void;
}

const STATE_BROADCAST_MIN_INTERVAL_MS = 1000;

export interface CastMessageBusOptions {
  now?: () => number;
  setTimeoutFn?: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}

export class CastMessageBus {
  private readonly channel: CastMessageChannel;
  private readonly now: () => number;
  private readonly setTimeoutFn: NonNullable<CastMessageBusOptions["setTimeoutFn"]>;
  private readonly clearTimeoutFn: NonNullable<CastMessageBusOptions["clearTimeoutFn"]>;

  private handlers: CastMessageHandlers = {};
  private lastStateBroadcastAt = -Infinity;
  private pendingStateMessage: PlayarrCastStateMessage | null = null;
  private pendingStateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(channel: CastMessageChannel, options: CastMessageBusOptions = {}) {
    this.channel = channel;
    this.now = options.now ?? (() => Date.now());
    this.setTimeoutFn = options.setTimeoutFn ?? ((handler, ms) => setTimeout(handler, ms));
    this.clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle));
    this.channel.addListener((senderId, raw) => this.dispatch(senderId, raw));
  }

  setHandlers(handlers: CastMessageHandlers): void {
    this.handlers = handlers;
  }

  private dispatch(senderId: string, raw: unknown): void {
    const parsed = parsePlayarrCastMessage(raw);
    if (!parsed || !isPlayarrCastSenderMessage(parsed)) {
      this.handlers.onUnrecognized?.(raw, senderId);
      return;
    }

    switch (parsed.type) {
      case "auth.update":
        this.handlers.onAuthUpdate?.(parsed, senderId);
        return;
      case "tracks.select":
        this.handlers.onSelectTracks?.(parsed, senderId);
        return;
      case "quality.select":
        this.handlers.onSelectQuality?.(parsed, senderId);
        return;
      case "queue.set":
        this.handlers.onSetQueue?.(parsed, senderId);
        return;
      case "queue.playNext":
        this.handlers.onPlayNext?.(parsed, senderId);
        return;
      case "state.request":
        this.handlers.onStateRequest?.(parsed, senderId);
        return;
      case "session.end":
        this.handlers.onEndSession?.(parsed, senderId);
        return;
      default: {
        // Exhaustiveness guard: every `PlayarrCastSenderMessage` variant is
        // handled above: if a new one is ever added to the shared protocol
        // package without a matching case here, this is a compile error.
        const unreachable: never = parsed;
        this.handlers.onUnrecognized?.(unreachable, senderId);
      }
    }
  }

  /**
   * Throttled to at most one send per second: an immediate send if the
   * 1-second window has elapsed since the last broadcast, otherwise the
   * LATEST state wins and is sent exactly once at the next allowed instant
   * (trailing edge), superseding any state a still-pending earlier call
   * queued.
   */
  broadcastState(state: PlayarrCastStateMessage): void {
    const elapsed = this.now() - this.lastStateBroadcastAt;
    if (elapsed >= STATE_BROADCAST_MIN_INTERVAL_MS) {
      this.sendStateNow(state);
      return;
    }

    this.pendingStateMessage = state;
    if (this.pendingStateTimer) return;
    const delay = STATE_BROADCAST_MIN_INTERVAL_MS - elapsed;
    this.pendingStateTimer = this.setTimeoutFn(() => {
      this.pendingStateTimer = null;
      const next = this.pendingStateMessage;
      this.pendingStateMessage = null;
      if (next) this.sendStateNow(next);
    }, delay);
  }

  private sendStateNow(state: PlayarrCastStateMessage): void {
    this.lastStateBroadcastAt = this.now();
    this.channel.send(undefined, state);
  }

  /** Acknowledges one sender-originated request (its `requestId`, if it had one). */
  sendAck(senderId: string, requestId: string, ok: boolean, code?: PlayarrCastErrorCode, message?: string): void {
    const ack: PlayarrCastAckMessage = {
      protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
      type: "ack",
      requestId,
      ok,
      ...(code ? { code } : {}),
      ...(message ? { message } : {}),
    };
    this.channel.send(senderId, ack);
  }

  /** Sends (or broadcasts, with `senderId: undefined`) a `PlayarrCastErrorMessage`. */
  sendError(
    senderId: string | undefined,
    code: PlayarrCastErrorCode,
    message: string,
    options: { requestId?: string; apiStatus?: number; retryable?: boolean } = {}
  ): void {
    const error: PlayarrCastErrorMessage = {
      protocolVersion: PLAYARR_CAST_PROTOCOL_VERSION,
      type: "error",
      code,
      message,
      retryable: options.retryable ?? false,
      ...(options.requestId ? { requestId: options.requestId } : {}),
      ...(options.apiStatus !== undefined ? { apiStatus: options.apiStatus } : {}),
    };
    this.channel.send(senderId, error);
  }

  /** Cancels any pending throttled state broadcast. Call on receiver shutdown. */
  dispose(): void {
    if (this.pendingStateTimer) {
      this.clearTimeoutFn(this.pendingStateTimer);
      this.pendingStateTimer = null;
    }
  }
}
