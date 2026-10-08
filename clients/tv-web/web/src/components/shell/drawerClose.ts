/**
 * Closing animation for the shared {@link Drawer}.
 *
 * React removes a drawer from the tree the moment its page stops rendering it (the Close button, Back or
 * Escape, the scrim, the launcher toggle and a route change all end up here), so the slide-out cannot be a
 * CSS transition on the live node. Instead, when a drawer unmounts, a frozen inert copy of it is placed
 * over the page and plays the exact reverse of the opening animation (`drawer-out` is `tv-filter-drawer-in`
 * run backwards, same duration, mirrored easing). The copy is removed on `animationend`, with a timer as the
 * fallback, and `onDone` then returns focus to the launcher.
 */

export const DRAWER_CLOSING_CLASS = "is-closing";
/** Safety margin added to the computed animation duration before the timer fallback removes the copy. */
export const DRAWER_CLOSE_SLACK_MS = 160;
/** Used when the animation duration cannot be read (no layout engine). */
export const DRAWER_CLOSE_DEFAULT_MS = 600;

/** The scrim wrapper some drawers (media and playlist context menus) are rendered inside. */
const SCRIM_CLASS = "media-context-backdrop";

export interface DrawerCloseEnv {
  document: Document;
  /** True when `prefers-reduced-motion: reduce` is set; the drawer then closes without an animation. */
  reducedMotion: () => boolean;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export function browserDrawerCloseEnv(): DrawerCloseEnv {
  return {
    document,
    reducedMotion: () =>
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  };
}

/** Milliseconds a CSS `<time>` list such as `360ms` or `0.24s, 1s` takes; the longest entry wins. */
export function longestCssTime(value: string | null | undefined): number {
  if (!value) return 0;
  let longest = 0;
  for (const part of value.split(",")) {
    const match = /^\s*(-?\d*\.?\d+)(ms|s)\s*$/.exec(part);
    if (!match) continue;
    const ms = Number(match[1]) * (match[2] === "s" ? 1000 : 1);
    if (ms > longest) longest = ms;
  }
  return longest;
}

export interface DrawerCloseSnapshot {
  /** The element placed over the page: the drawer itself, or its scrim wrapper. */
  ghost: HTMLElement;
  /** The drawer inside `ghost` that carries the animation. */
  panel: HTMLElement;
}

/**
 * Copies a mounted drawer (and its scrim wrapper, if any) into a frozen, inert, fixed-position ghost.
 * Must run while the drawer is still attached, because it measures the live node.
 */
export function snapshotDrawer(node: HTMLElement): DrawerCloseSnapshot {
  const parent = node.parentElement;
  const scrim = parent !== null && parent.classList.contains(SCRIM_CLASS) ? parent : null;
  const source = scrim ?? node;
  const ghost = source.cloneNode(true) as HTMLElement;
  const panel = (scrim ? ghost.querySelector(".drawer") : ghost) as HTMLElement;

  for (const element of [ghost, ...Array.from(ghost.querySelectorAll<HTMLElement>("[id]"))]) {
    element.removeAttribute("id");
  }
  ghost.setAttribute("aria-hidden", "true");
  ghost.setAttribute("inert", "");
  ghost.removeAttribute("role");
  panel.removeAttribute("role");
  panel.removeAttribute("aria-modal");
  ghost.setAttribute("data-drawer-ghost", "");
  ghost.style.pointerEvents = "none";

  if (!scrim) {
    const rect = node.getBoundingClientRect();
    ghost.style.position = "fixed";
    ghost.style.top = `${rect.top}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.right = "auto";
    ghost.style.bottom = "auto";
    ghost.style.margin = "0";
    ghost.style.minWidth = "0";
    ghost.style.boxSizing = "border-box";
  }
  panel.classList.add(DRAWER_CLOSING_CLASS);
  return { ghost, panel };
}

/**
 * Places a ghost and resolves when its closing animation has finished (`animationend`, or the timer
 * fallback). Returns a cancel function. With reduced motion there is no ghost and `onDone` runs at once.
 */
export function playDrawerClose(
  snapshot: DrawerCloseSnapshot,
  env: DrawerCloseEnv,
  onDone: () => void,
  getComputedStyleFn: (element: Element) => { animationDuration: string; animationDelay: string } | null = (element) =>
    typeof getComputedStyle === "function" ? getComputedStyle(element) : null
): () => void {
  if (env.reducedMotion()) {
    onDone();
    return () => undefined;
  }
  const { ghost, panel } = snapshot;
  env.document.body.appendChild(ghost);

  let finished = false;
  let timer: unknown;
  const finish = () => {
    if (finished) return;
    finished = true;
    env.clearTimeout(timer);
    panel.removeEventListener("animationend", onEnd);
    ghost.remove();
    onDone();
  };
  const onEnd = (event: Event) => {
    if (event.target === panel) finish();
  };
  panel.addEventListener("animationend", onEnd);

  const style = getComputedStyleFn(panel);
  const measured = style ? longestCssTime(style.animationDuration) + longestCssTime(style.animationDelay) : 0;
  timer = env.setTimeout(finish, (measured || DRAWER_CLOSE_DEFAULT_MS - DRAWER_CLOSE_SLACK_MS) + DRAWER_CLOSE_SLACK_MS);
  return finish;
}

/** Focus goes back to the launcher once the drawer is gone, unless something else has taken it meanwhile. */
export function restoreOpenerFocus(opener: HTMLElement | null, doc: Document): void {
  if (!opener || !doc.contains(opener)) return;
  const active = doc.activeElement;
  if (active && active !== doc.body && active !== doc.documentElement) return;
  opener.focus({ preventScroll: true });
}
