/**
 * The one scroll-edge fade, framework-free core. `attachScrollEdges` tags a scroller with `data-fade-axis` (x or y)
 * and `data-fade-start` / `data-fade-end` on the sides where content continues; the single mask in `page-layout.css`
 * ("Scroll edge fade") does the rest. `useScrollEdges` wraps it for components; `installScrollEdgeFades` attaches it
 * to every remaining `[data-tv-scroll-container]` (drawers, dialogs, menus, panels) so no scroller lacks the fade.
 *
 * Attributes are written straight to the DOM (no React state, no re-render), and the first measure is synchronous,
 * so the fade is present from the first paint of the scroller.
 */
export type FadeAxis = "horizontal" | "vertical";

const EDGE_TOLERANCE_PX = 3;
const MANAGED = "fadeManaged";

export function measureScrollEdges(element: HTMLElement, axis: FadeAxis): void {
  const horizontal = axis === "horizontal";
  const position = horizontal ? element.scrollLeft : element.scrollTop;
  const viewport = horizontal ? element.clientWidth : element.clientHeight;
  const extent = horizontal ? element.scrollWidth : element.scrollHeight;
  element.dataset.fadeAxis = horizontal ? "x" : "y";
  if (position > EDGE_TOLERANCE_PX) element.dataset.fadeStart = "";
  else delete element.dataset.fadeStart;
  if (position + viewport < extent - EDGE_TOLERANCE_PX) element.dataset.fadeEnd = "";
  else delete element.dataset.fadeEnd;
}

/** Measure now (before paint), then keep the fade current on scroll, resize and content changes. Returns the detach. */
export function attachScrollEdges(element: HTMLElement, axis: FadeAxis): () => void {
  let frame: number | null = null;
  let stopped = false;
  const measure = () => measureScrollEdges(element, axis);
  const schedule = () => {
    if (stopped || frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      measure();
    });
  };

  measure();

  const resizeObserver = new ResizeObserver(schedule);
  // The scroller, plus its wrapper when it has a single child (settings sections, lists), which is what grows.
  resizeObserver.observe(element);
  if (element.childElementCount === 1) resizeObserver.observe(element.firstElementChild as Element);
  const mutationObserver = new MutationObserver(() => {
    if (element.childElementCount === 1) resizeObserver.observe(element.firstElementChild as Element);
    // Content arrived: measure in this microtask so the fade is there for the very next paint.
    measure();
    schedule();
  });
  mutationObserver.observe(element, { childList: true });
  element.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });

  return () => {
    stopped = true;
    if (frame !== null) window.cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    element.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    delete element.dataset.fadeStart;
    delete element.dataset.fadeEnd;
  };
}

export function markFadeManaged(element: HTMLElement): void {
  element.dataset[MANAGED] = "";
}

export function unmarkFadeManaged(element: HTMLElement): void {
  delete element.dataset[MANAGED];
}

const SELECTOR = "[data-tv-scroll-container]:not([data-fade-managed]):not([data-fade='off'])";

function axisOf(element: HTMLElement): FadeAxis {
  const declared = element.dataset.tvScrollAxis;
  return declared === "horizontal" || declared === "x" ? "horizontal" : "vertical";
}

/**
 * Attach the fade to every scroll container no component manages. The page root and the player are opted out with
 * `data-fade="off"` (the page root's pages own `ScrollArea`s; the player has its own chrome).
 */
export function installScrollEdgeFades(root: Document = document): () => void {
  const attached = new Map<HTMLElement, () => void>();
  const attach = (element: HTMLElement) => {
    if (attached.has(element) || element.dataset.fadeAxis !== undefined) return;
    attached.set(element, attachScrollEdges(element, axisOf(element)));
  };
  const scan = (node: Node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(SELECTOR)) attach(node);
    node.querySelectorAll<HTMLElement>(SELECTOR).forEach(attach);
  };
  const release = () => {
    for (const [element, detach] of attached) {
      if (element.isConnected) continue;
      detach();
      attached.delete(element);
    }
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach(scan);
    if (records.some((record) => record.removedNodes.length > 0)) release();
  });
  scan(root.body);
  observer.observe(root.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    attached.forEach((detach) => detach());
    attached.clear();
  };
}
