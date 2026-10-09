/**
 * Passes a value on only once it has stopped changing for `delayMs`: every `push` restarts the wait,
 * so a burst (a held key repeating) produces one `commit` with the last value.
 */
export function createSettled<T>(delayMs: number, commit: (value: T) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    push(value: T) {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        commit(value);
      }, delayMs);
    },
    cancel,
  };
}
