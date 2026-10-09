/**
 * `Promise.all(items.map(fn))` with at most `limit` calls in flight, results in input order. Used for
 * fan-outs that would otherwise fire one request per item at once (a playlist directory resolving every
 * playlist and every work). A rejection rejects the whole call, like `Promise.all`; `fn` decides what to
 * swallow.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  shouldStop: () => boolean = () => false
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length && !shouldStop()) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
