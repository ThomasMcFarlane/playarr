/**
 * Lets the Library page tell the navigation code how to mount a card that virtualisation has not rendered yet.
 * A typed registry keyed by the grid element replaces an ad hoc property written onto the DOM node (audit A15).
 */
export type EnsureLibraryIndexFn = (index: number) => void;

const registry = new WeakMap<HTMLElement, EnsureLibraryIndexFn>();

/** Registers the mount function for a grid; the returned function removes it again. */
export function registerEnsureLibraryIndex(grid: HTMLElement, ensure: EnsureLibraryIndexFn): () => void {
  registry.set(grid, ensure);
  return () => {
    if (registry.get(grid) === ensure) registry.delete(grid);
  };
}

export function ensureLibraryIndex(grid: HTMLElement | null | undefined, index: number): void {
  if (grid) registry.get(grid)?.(index);
}
