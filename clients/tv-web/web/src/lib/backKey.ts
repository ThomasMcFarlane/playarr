/**
 * The one BACK-key predicate for the whole web client.
 *
 * Covers Escape, Backspace, BrowserBack, GoBack, Tizen 10009 and webOS/VIDAA
 * 461. Backspace is ignored while the user types in a text field, so deleting
 * a character never navigates. Every handler (pages, dialogs, drawers, the
 * player) imports this instead of re-listing key names.
 */
export type BackKeyEvent = {
  key: string;
  keyCode?: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  target?: unknown;
};

function isTypingTarget(target: unknown): boolean {
  if (target == null || typeof target !== "object") return false;
  const node = target as { tagName?: string; type?: string; isContentEditable?: boolean };
  if (node.isContentEditable) return true;
  const tag = node.tagName?.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (node.type ?? "text").toLowerCase();
    return !["button", "checkbox", "radio", "range", "submit", "reset", "image", "file"].includes(
      type
    );
  }
  return false;
}

export function isBackKey(event: BackKeyEvent): boolean {
  if (event.keyCode === 10009 || event.keyCode === 461) return true;
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  switch (event.key) {
    case "Escape":
    case "BrowserBack":
    case "GoBack":
      return true;
    case "Backspace":
      return !isTypingTarget(event.target);
    default:
      return false;
  }
}

/** Open layers that own the next Back press: dialogs, drawers, modal panels and menus. */
export const BACK_LAYER_SELECTOR = '[role="dialog"], [aria-modal="true"], [role="menu"]';

/**
 * True while a layer above the page is open. A global Back handler (the minimised player) must leave the
 * press to that layer, so Back closes one level at a time, top first (owner rule, audit A5).
 */
export function hasOpenBackLayer(doc: { querySelector(selector: string): unknown }): boolean {
  return doc.querySelector(BACK_LAYER_SELECTOR) !== null;
}
