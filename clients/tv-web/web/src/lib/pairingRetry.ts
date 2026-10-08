import { ApiError } from "@playarr-tv/api-client";

/**
 * QR sign-in needs no user action: an expired code is replaced and a network blip is retried quietly
 * (2 s doubling to 30 s, like Android's `QrPairingFlow`), keeping the current code while it is valid.
 * Only an explicit denial or an unexpected failure is shown, with Try again.
 */
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30_000;

export function pairingRetryDelayMs(attempt: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt));
}

export type PairingFailureKind = "expired" | "transient" | "fatal";

function isAbort(reason: unknown): boolean {
  return typeof reason === "object" && reason !== null && (reason as { name?: unknown }).name === "AbortError";
}

export function classifyPairingFailure(reason: unknown): PairingFailureKind {
  if (isAbort(reason)) return "fatal";
  if (reason instanceof ApiError) {
    return reason.status >= 500 || reason.status === 408 || reason.status === 429 ? "transient" : "fatal";
  }
  // A failed `fetch` (offline, DNS, connection reset) rejects with a TypeError.
  if (reason instanceof TypeError) return "transient";
  if (reason instanceof Error) {
    if (/\bexpired\b/i.test(reason.message)) return "expired";
    if (/\(HTTP (5\d\d|408|429)\)/.test(reason.message)) return "transient";
  }
  return "fatal";
}

export interface RetryTransientPairingOptions {
  signal?: AbortSignal;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

function defaultWait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

/** Runs `run` again after each transient failure; anything else (expiry, denial, abort) is thrown. */
export async function retryTransientPairing<T>(
  run: () => Promise<T>,
  options: RetryTransientPairingOptions = {}
): Promise<T> {
  const wait = options.wait ?? defaultWait;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (reason) {
      if (options.signal?.aborted || classifyPairingFailure(reason) !== "transient") throw reason;
      await wait(pairingRetryDelayMs(attempt), options.signal);
    }
  }
}
