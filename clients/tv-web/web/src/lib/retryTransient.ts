import { ApiError } from "@playarr-tv/api-client";

/** Waits between the attempts of `retryTransient`; the last wait is the longest. */
export const TRANSIENT_RETRY_DELAYS_MS: readonly number[] = [800, 2500];

/**
 * A failure that a second try can fix: the connection dropped or was reset (a thrown `TypeError` from `fetch`),
 * the request was cancelled underneath us, or the server or a proxy in front of it was busy (408, 425, 429, 5xx).
 * Anything else (401, 403, 404, 400) is final.
 */
export function isTransientFailure(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
  if (error instanceof Error) return error.name === "AbortError" || error.name === "TypeError";
  return false;
}

/**
 * Runs `load`, retrying transient failures after the given waits before giving up with the last error. A slow
 * server or a dropped connection then costs a longer skeleton instead of an error page.
 */
export async function retryTransient<T>(
  load: () => Promise<T>,
  delays: readonly number[] = TRANSIENT_RETRY_DELAYS_MS,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      const delay = delays[attempt];
      if (delay === undefined || !isTransientFailure(error)) throw error;
      await wait(delay);
    }
  }
}
