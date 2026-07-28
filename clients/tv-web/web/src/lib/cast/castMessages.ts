/**
 * Playarr Cast custom-channel messaging: subscribing, sending, and a small
 * "wait for the first message matching a predicate" helper used to give a
 * fast-failing receiver a chance to surface through the same "connect"
 * attempt a viewer just triggered.
 */
import {
  PLAYARR_CAST_NAMESPACE,
  encodePlayarrCastMessage,
  parsePlayarrCastMessage,
  type PlayarrCastMessage,
  type PlayarrCastSenderMessage,
} from "@streamarr-tv/cast-protocol";

type PlayarrCastMessageListener = (namespace: string, message: string) => void;

/**
 * Narrow structural slice of `cast.framework.CastSession` this module
 * actually needs -- a plain object literal satisfies this in tests without
 * constructing (or mocking the whole shape of) the real CAF class; a real
 * `CastSession` instance satisfies it too, with no cast needed.
 */
export interface PlayarrCastSessionLike {
  sendMessage(namespace: string, data: unknown): Promise<chrome.cast.ErrorCode | undefined>;
  addMessageListener(namespace: string, listener: PlayarrCastMessageListener): void;
  removeMessageListener(namespace: string, listener: PlayarrCastMessageListener): void;
}

/**
 * Subscribes to the Playarr Cast namespace on `session`. The `message`
 * argument `addMessageListener` delivers is always a STRING -- even though
 * `sendPlayarrCastMessage` below hands `sendMessage` a plain object, the
 * SDK JSON-encodes it in transit and every *received* message comes back
 * as JSON text -- so this always routes it through `parsePlayarrCastMessage`
 * rather than assuming it is already a parsed object. Anything that fails
 * to parse (or parses but isn't a recognized message) is silently dropped;
 * `onMessage` is only ever called with a real, typed `PlayarrCastMessage`.
 * Returns an unsubscribe function.
 */
export function subscribeToPlayarrCastMessages(
  session: PlayarrCastSessionLike,
  onMessage: (message: PlayarrCastMessage) => void
): () => void {
  const listener: PlayarrCastMessageListener = (_namespace, message) => {
    const parsed = parsePlayarrCastMessage(message);
    if (parsed) onMessage(parsed);
  };
  session.addMessageListener(PLAYARR_CAST_NAMESPACE, listener);
  return () => session.removeMessageListener(PLAYARR_CAST_NAMESPACE, listener);
}

/**
 * Sends a sender -> receiver message. `CastSession.sendMessage` itself
 * accepts a plain object (the SDK JSON-encodes it for the wire) -- this
 * still runs `message` through `encodePlayarrCastMessage` first purely for
 * its 64KB size guard (it throws a `RangeError` past that cap; the encoded
 * string itself is discarded, `sendMessage` gets the original object, per
 * that method's own expected `data` shape).
 */
export async function sendPlayarrCastMessage(
  session: PlayarrCastSessionLike,
  message: PlayarrCastSenderMessage
): Promise<void> {
  encodePlayarrCastMessage(message);
  const errorCode = await session.sendMessage(PLAYARR_CAST_NAMESPACE, message);
  if (errorCode !== undefined) {
    throw new Error(`Failed to send a Playarr Cast message: ${errorCode}`);
  }
}

export interface WaitForPlayarrCastMessageOptions {
  /** Defaults to 4s. */
  timeoutMs?: number;
}

/**
 * Resolves with the first message matching `predicate`, or `undefined`
 * once `timeoutMs` elapses with no match. Used right after issuing a load
 * request to give a receiver-side failure that surfaces quickly (e.g. an
 * `error` message with code `insecure_server`) a real chance to be caught
 * by the same attempt that triggered it, instead of only ever appearing
 * later, disconnected from the viewer's own action.
 */
export function waitForFirstPlayarrCastMessage(
  session: PlayarrCastSessionLike,
  predicate: (message: PlayarrCastMessage) => boolean,
  options: WaitForPlayarrCastMessageOptions = {}
): Promise<PlayarrCastMessage | undefined> {
  const timeoutMs = options.timeoutMs ?? 4000;
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const unsubscribe = subscribeToPlayarrCastMessages(session, (message) => {
      if (settled || !predicate(message)) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(message);
    });

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(undefined);
    }, timeoutMs);
  });
}
