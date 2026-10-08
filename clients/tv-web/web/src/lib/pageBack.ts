import { useEffect, useRef } from "react";

/**
 * A page that has its own idea of "up one level" (nested Folders, a playlist's
 * detail) registers it here. The remote BACK key and the on-screen Back button
 * then run the same code. The handler returns true when it handled the press;
 * false lets the route-based default run.
 */
type PageBack = () => boolean;

let current: PageBack | null = null;

export function registerPageBack(handler: PageBack | null): (() => void) | null {
  current = handler;
  if (!handler) return null;
  return () => {
    if (current === handler) current = null;
  };
}

export function runPageBack(): boolean {
  return current ? current() : false;
}

export function usePageBack(handler: PageBack | null): void {
  const ref = useRef(handler);
  ref.current = handler;
  const active = handler !== null;
  useEffect(() => {
    if (!active) return undefined;
    return registerPageBack(() => ref.current?.() ?? false) ?? undefined;
  }, [active]);
}
