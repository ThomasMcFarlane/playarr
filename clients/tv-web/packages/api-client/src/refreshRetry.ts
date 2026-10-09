/**
 * Silent retry for a background refresh. `start` runs it; if it rejects, it runs again after each of
 * `delaysMs` in turn (a backoff) and then gives up, leaving whatever was on screen untouched. A newer
 * `start` or a `cancel` ends the chain, so an older retry can never overwrite fresher data. Nothing here
 * is user-facing: a failed refresh never shows an error.
 */
export const REFRESH_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 15_000, 30_000, 60_000];

export function createRefreshRetry(run: () => Promise<unknown>, delaysMs: readonly number[] = REFRESH_RETRY_DELAYS_MS) {
  let epoch = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    epoch += 1;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const attempt = (index: number, mine: number) => {
    run().catch(() => {
      if (epoch !== mine || index >= delaysMs.length) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (epoch === mine) attempt(index + 1, mine);
      }, delaysMs[index]);
    });
  };

  return {
    start() {
      cancel();
      attempt(0, epoch);
    },
    cancel,
  };
}
