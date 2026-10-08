/**
 * A one-value external store for the work a preview should show right now.
 *
 * The library's left preview must follow the remote's focus within a frame, while the page's heavier
 * selection-driven work (backdrop art, prefetch) stays debounced. Only the preview subscribes here, so a key
 * press re-renders just that small component and never the grid.
 */
export interface PreviewStore<T> {
  get(): T | null;
  /** Shows `value` (or lets the preview fall back to the page's own selection when `null`). */
  set(value: T | null): void;
  subscribe(listener: () => void): () => void;
}

export function createPreviewStore<T>(): PreviewStore<T> {
  let current: T | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(value) {
      if (value === current) return;
      current = value;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
