// DEBUG BUILD ONLY. See src/debug/mirror.ts. Pure DOM helpers, kept separate so they unit-test.

export interface FocusInfo {
  selector: string;
  text: string;
  bbox: { x: number; y: number; w: number; h: number } | null;
}

/** A short, stable-ish CSS path for an element (tag, id, data-testid, classes), up to 5 levels. */
export function selectorFor(el: Element | null): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && parts.length < 5) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`${part}#${node.id}`);
      break;
    }
    const testId = node.getAttribute("data-testid");
    if (testId) part += `[data-testid="${testId}"]`;
    const cls = typeof node.className === "string" ? node.className.trim().split(/\s+/).slice(0, 2) : [];
    if (cls.length && cls[0]) part += "." + cls.join(".");
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(" > ");
}

export function focusInfo(doc: Document = document): FocusInfo | null {
  const el = doc.activeElement;
  if (!el || el === doc.body || el === doc.documentElement) return null;
  const r = el.getBoundingClientRect();
  return {
    selector: selectorFor(el),
    text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    bbox: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
  };
}

/** Text of every text node whose box intersects the viewport, in document order. */
export function visibleText(doc: Document = document, limit = 6000): string {
  const win = doc.defaultView;
  if (!win) return "";
  const out: string[] = [];
  let size = 0;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  for (let n = walker.nextNode(); n && size < limit; n = walker.nextNode()) {
    const t = (n.nodeValue ?? "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    const parent = (n as Text).parentElement;
    if (!parent || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(parent.tagName)) continue;
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right < 0 || r.bottom < 0 || r.left > win.innerWidth || r.top > win.innerHeight) continue;
    const style = win.getComputedStyle(parent);
    if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;
    out.push(t);
    size += t.length + 1;
  }
  return out.join("\n");
}
