import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { NavigationOrigin } from "./navigationLayer";
import {
  formControlDescriptor,
  shouldNavigateFromFormControl,
} from "./arrowNavigationPolicy";
import {
  findClosestItemInNextTrack,
  pickNearestCardByCentre,
} from "./trackNavigation";
import { noteNavigationKey } from "./navigationActivity";
import { smoothScrollTo } from "./smoothScroll";
import {
  type Direction,
  type FocusRect,
  detectEqualRowColumns,
  focusCentre,
  focusRectFromDOMRect,
  hasHorizontalNeighbourToRight,
  pickBestDirectionalTarget,
  titleGridNeighbourIndex,
} from "./focusGeometry";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Element list may be reused until the DOM structure changes. */
const FOCUSABLE_LIST_TTL_MS = 2_000;

interface FocusableEntry {
  element: HTMLElement;
  rect: FocusRect;
}

interface FocusableSnapshot {
  scopeKey: Document | HTMLElement;
  listBuiltAt: number;
  elements: HTMLElement[];
  rectsDirty: boolean;
  entries: FocusableEntry[] | null;
  rectByElement: WeakMap<HTMLElement, FocusRect>;
}

let focusableSnapshot: FocusableSnapshot | null = null;
let cacheInvalidationInstalled = false;

function invalidateFocusableSnapshot(): void {
  focusableSnapshot = null;
}

function markFocusableRectsDirty(): void {
  if (focusableSnapshot) focusableSnapshot.rectsDirty = true;
}

/**
 * Structure changes drop the element list. Scroll only dirties rects so dense
 * libraries do not re-query the whole document on every remote press.
 */
function ensureFocusableCacheInvalidation(): void {
  if (cacheInvalidationInstalled || typeof window === "undefined") return;
  cacheInvalidationInstalled = true;

  let structureFrame = 0;
  const invalidateStructure = () => {
    if (structureFrame) return;
    structureFrame = window.requestAnimationFrame(() => {
      structureFrame = 0;
      invalidateFocusableSnapshot();
    });
  };
  window.addEventListener("scroll", markFocusableRectsDirty, {
    capture: true,
    passive: true,
  });
  window.addEventListener("resize", markFocusableRectsDirty, { passive: true });

  if (typeof MutationObserver !== "undefined" && document.body) {
    // Do NOT watch `class` / `style`: is-selected toggles and artwork loads
    // would thrash the list cache on every focus under dense catalogues.
    new MutationObserver(invalidateStructure).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "tabindex", "aria-hidden", "aria-modal", "hidden"],
    });
  }
}

/**
 * Visibility without per-element getComputedStyle (forced style recalc).
 * Zero-size covers display:none; aria-hidden is filtered when collecting.
 */
function isFocusableVisible(_element: HTMLElement, rect: FocusRect): boolean {
  return rect.width > 0 && rect.height > 0;
}

function rebuildElementList(scope: Document | HTMLElement): HTMLElement[] {
  const nodes = scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  const elements: HTMLElement[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const element = nodes[index]!;
    if (element.closest('[aria-hidden="true"]')) continue;
    elements.push(element);
  }
  return elements;
}

function refreshRects(elements: HTMLElement[]): {
  entries: FocusableEntry[];
  rectByElement: WeakMap<HTMLElement, FocusRect>;
} {
  const entries: FocusableEntry[] = [];
  const rectByElement = new WeakMap<HTMLElement, FocusRect>();
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (!element.isConnected) continue;
    const rect = focusRectFromDOMRect(element.getBoundingClientRect());
    if (!isFocusableVisible(element, rect)) continue;
    entries.push({ element, rect });
    rectByElement.set(element, rect);
  }
  return { entries, rectByElement };
}

function collectVisibleFocusables(
  requestedScope?: Document | HTMLElement
): FocusableEntry[] {
  ensureFocusableCacheInvalidation();
  const modal = document.querySelector<HTMLElement>('[aria-modal="true"]');
  const scope: Document | HTMLElement = modal ?? requestedScope ?? document;
  const now =
    typeof performance !== "undefined" ? performance.now() : Date.now();

  if (
    !focusableSnapshot ||
    focusableSnapshot.scopeKey !== scope ||
    now - focusableSnapshot.listBuiltAt >= FOCUSABLE_LIST_TTL_MS
  ) {
    const elements = rebuildElementList(scope);
    const { entries, rectByElement } = refreshRects(elements);
    focusableSnapshot = {
      scopeKey: scope,
      listBuiltAt: now,
      elements,
      rectsDirty: false,
      entries,
      rectByElement,
    };
    return entries;
  }

  if (focusableSnapshot.rectsDirty || !focusableSnapshot.entries) {
    const { entries, rectByElement } = refreshRects(focusableSnapshot.elements);
    focusableSnapshot.entries = entries;
    focusableSnapshot.rectByElement = rectByElement;
    focusableSnapshot.rectsDirty = false;
  }

  return focusableSnapshot.entries;
}

function visibleFocusables(requestedScope?: Document | HTMLElement): HTMLElement[] {
  return collectVisibleFocusables(requestedScope).map((entry) => entry.element);
}

function rectFor(
  element: HTMLElement,
  rectByElement?: WeakMap<HTMLElement, FocusRect>
): FocusRect {
  const cached = rectByElement?.get(element);
  if (cached) return cached;
  return focusRectFromDOMRect(element.getBoundingClientRect());
}

type EnsureLibraryIndexFn = (index: number) => void;

function ensureLibraryIndexMounted(
  grid: HTMLElement,
  index: number
): HTMLElement | null {
  const existing = grid.querySelector<HTMLElement>(
    `[data-library-index="${index}"]`
  );
  if (existing) return existing;
  // Only flushSync-expand when the target card is not in the DOM. Pre-warming
  // headroom on every key remounts large prefixes and dominates 50× throttle.
  const ensure = (
    grid as HTMLElement & { __tvEnsureLibraryIndex?: EnsureLibraryIndexFn }
  ).__tvEnsureLibraryIndex;
  ensure?.(index);
  return grid.querySelector<HTMLElement>(`[data-library-index="${index}"]`);
}

/**
 * In-memory library focus for O(1) neighbour steps.
 * Under remote: skip native focus() mid-hold (dominant Vidaa lag source —
 * style/layout + React onFocus). Mark with data-remote-active and commit
 * focus only after the hold settles so Enter/OK and stage selection still work.
 */
let remoteFocusElement: HTMLElement | null = null;
let remoteFocusIndex = -1;
let remoteFocusGrid: HTMLElement | null = null;
let remoteFocusSettleTimer = 0;
let remoteCachedCols = 0;
let remoteCachedRowHeight = 0;
let remoteCachedClientHeight = 0;
let remoteCachedGrid: HTMLElement | null = null;

function readLibraryGridMetrics(grid: HTMLElement): {
  cols: number;
  rowHeight: number;
  clientHeight: number;
} {
  if (remoteCachedGrid === grid && remoteCachedCols > 0) {
    return {
      cols: remoteCachedCols,
      rowHeight: remoteCachedRowHeight,
      clientHeight: remoteCachedClientHeight,
    };
  }
  const cols = Number.parseInt(grid.dataset.libraryCols ?? "", 10);
  const rowHeight = Number.parseInt(grid.dataset.libraryRowHeight ?? "", 10);
  remoteCachedGrid = grid;
  remoteCachedCols = Number.isFinite(cols) && cols > 0 ? cols : 1;
  remoteCachedRowHeight =
    Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 0;
  remoteCachedClientHeight = grid.clientHeight;
  return {
    cols: remoteCachedCols,
    rowHeight: remoteCachedRowHeight,
    clientHeight: remoteCachedClientHeight,
  };
}

/**
 * Element currently carrying `data-remote-active` (may lag `remoteFocusElement`
 * within a frame). An attribute, not a class: React owns `className` and would
 * wipe an imperative class whenever the card re-renders (e.g. `is-selected`).
 */
let markedElement: HTMLElement | null = null;
/** Last-wins DOM application for the virtual focus moved this frame. */
let pendingApply: (() => void) | null = null;

function setRemoteActiveMarker(element: HTMLElement | null): void {
  if (markedElement && markedElement !== element && markedElement.isConnected) {
    markedElement.removeAttribute("data-remote-active");
  }
  if (element && element !== markedElement) element.setAttribute("data-remote-active", "");
  markedElement = element;
}

function runPendingApply(): void {
  const apply = pendingApply;
  pendingApply = null;
  apply?.();
}

function armRemoteFocusSettle(element: HTMLElement): void {
  window.clearTimeout(remoteFocusSettleTimer);
  remoteFocusSettleTimer = window.setTimeout(() => {
    if (document.body.dataset.inputMode !== "remote") return;
    if (!element.isConnected) return;
    element.focus({ preventScroll: true });
  }, 320);
}

/**
 * Virtual remote focus. Logical state moves immediately (so queued keys chain
 * correctly) but the DOM write (marker class, scroll, settle timer) is deferred
 * to `runPendingApply`, which runs once per frame regardless of how many keys
 * were queued behind a busy main thread.
 */
function markRemoteLibraryFocus(
  grid: HTMLElement,
  element: HTMLElement,
  index: number,
  apply: () => void
): void {
  remoteFocusElement = element;
  remoteFocusIndex = index;
  remoteFocusGrid = grid;
  pendingApply = () => {
    apply();
    if (document.body.dataset.inputMode !== "remote") {
      setRemoteActiveMarker(null);
      window.clearTimeout(remoteFocusSettleTimer);
      element.focus({ preventScroll: true });
      return;
    }
    setRemoteActiveMarker(element);
    armRemoteFocusSettle(element);
  };
}

function clearRemoteLibraryFocus(): void {
  window.clearTimeout(remoteFocusSettleTimer);
  pendingApply = null;
  setRemoteActiveMarker(null);
  remoteFocusElement = null;
  remoteFocusIndex = -1;
  remoteFocusGrid = null;
  remoteCachedGrid = null;
  remoteCachedCols = 0;
  remoteCachedRowHeight = 0;
  remoteCachedClientHeight = 0;
}

function isConfirmKey(event: KeyboardEvent): boolean {
  return (
    event.key === "Enter" ||
    event.key === " " ||
    event.key === "Spacebar" ||
    event.key === "Accept" ||
    event.keyCode === 13 ||
    event.keyCode === 23 // Android TV DPAD_CENTER / common OK
  );
}

/**
 * Capture-phase guard for OK/Enter. Native focus trails the virtual remote
 * focus (it settles after the hold), so a confirm pressed right after a move
 * would be dispatched to -- and handled by -- the previously focused card.
 * Commit focus to the card the user sees and re-dispatch the key to it, so
 * every handler (Link activation, long-press context menu) acts on the right
 * title. The matching keyup then goes to the newly focused element.
 */
function commitVirtualFocusBeforeConfirm(event: KeyboardEvent): void {
  if (!isConfirmKey(event) || event.defaultPrevented) return;
  flushQueuedMoves();
  const virtual = remoteFocusElement;
  if (!virtual?.isConnected || document.activeElement === virtual) return;
  if (document.body.dataset.inputMode !== "remote") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  window.clearTimeout(remoteFocusSettleTimer);
  virtual.focus({ preventScroll: true });
  const redispatched = new KeyboardEvent("keydown", {
    key: event.key,
    code: event.code,
    repeat: event.repeat,
    bubbles: true,
    cancelable: true,
  });
  // keyCode is read-only on the constructor; TV handlers still consult it.
  Object.defineProperty(redispatched, "keyCode", { value: event.keyCode });
  virtual.dispatchEvent(redispatched);
}

let confirmCommitUsers = 0;
/** Install the confirm guard once for all mounted navigation hooks. */
function acquireConfirmCommit(): () => void {
  if (confirmCommitUsers === 0) {
    window.addEventListener("keydown", commitVirtualFocusBeforeConfirm, true);
  }
  confirmCommitUsers += 1;
  return () => {
    confirmCommitUsers -= 1;
    if (confirmCommitUsers === 0) {
      window.removeEventListener("keydown", commitVirtualFocusBeforeConfirm, true);
    }
  };
}

function libraryCardAt(
  grid: HTMLElement,
  index: number,
  from: HTMLElement | null,
  fromIndex: number
): HTMLElement | null {
  // Prefer sibling walks for left/right — no querySelector on the hot path.
  if (from && from.isConnected) {
    if (index === fromIndex + 1) {
      const sibling = from.nextElementSibling;
      if (
        sibling instanceof HTMLElement &&
        sibling.dataset.libraryIndex === String(index)
      ) {
        return sibling;
      }
    }
    if (index === fromIndex - 1) {
      const sibling = from.previousElementSibling;
      if (
        sibling instanceof HTMLElement &&
        sibling.dataset.libraryIndex === String(index)
      ) {
        return sibling;
      }
    }
  }
  return grid.querySelector<HTMLElement>(`[data-library-index="${index}"]`);
}

function titleGridColumns(grid: HTMLElement): number {
  const fromData = Number.parseInt(grid.dataset.libraryCols ?? "", 10);
  if (Number.isFinite(fromData) && fromData > 0) return fromData;
  const content =
    grid.querySelector<HTMLElement>(".tv-title-grid-content") ?? grid;
  const cards = content.querySelectorAll<HTMLElement>(".tv-title-card");
  if (cards.length === 0) return 1;
  const tops: number[] = [];
  const firstTop = cards[0]!.offsetTop;
  for (let index = 0; index < cards.length; index += 1) {
    const top = cards[index]!.offsetTop;
    if (index > 0 && top > firstTop + 2) break;
    tops.push(top);
  }
  return detectEqualRowColumns(tops);
}

/**
 * O(1) neighbour step on dense Movies/Series/Sites/Music title grids.
 * Avoids whole-document focus scans on the hot library path.
 */
function focusWithinTitleGrid(
  current: HTMLElement,
  direction: Direction
): boolean {
  // Prefer in-memory remote focus; fall back to the event target card.
  let grid =
    remoteFocusGrid && remoteFocusGrid.isConnected
      ? remoteFocusGrid
      : current.closest<HTMLElement>(".tv-title-grid");
  if (!grid) return false;
  // Cover-flow uses the horizontal rail path instead.
  if (grid.dataset.tvScrollAxis === "horizontal") return false;

  let index = remoteFocusGrid === grid && remoteFocusIndex >= 0
    ? remoteFocusIndex
    : Number.parseInt(current.dataset.libraryIndex ?? "", 10);
  if (!Number.isFinite(index) || index < 0) {
    if (!current.matches(".tv-title-card")) return false;
    index = Number.parseInt(current.dataset.libraryIndex ?? "", 10);
  }
  if (!Number.isFinite(index) || index < 0) return false;

  const length = Number.parseInt(grid.dataset.libraryCount ?? "", 10);
  if (!Number.isFinite(length) || length <= 0) return false;
  const metrics = readLibraryGridMetrics(grid);
  const columns =
    metrics.cols > 1 ? metrics.cols : titleGridColumns(grid);
  if (columns !== metrics.cols) {
    remoteCachedCols = columns;
  }

  const nextIndex = titleGridNeighbourIndex(index, length, columns, direction);

  if (nextIndex === null) {
    clearRemoteLibraryFocus();
    if (direction === "right") {
      const activeLetter =
        document.querySelector<HTMLElement>(".tv-alphabet button.is-active") ??
        document.querySelector<HTMLElement>(".tv-alphabet button");
      if (activeLetter) {
        activeLetter.focus({ preventScroll: true });
        return true;
      }
    }
    if (direction === "left") {
      const navItems = document.querySelectorAll<HTMLElement>(".app-nav-link");
      const currentNav =
        document.querySelector<HTMLElement>(".app-nav-link[aria-current='page']") ??
        navItems.item(0);
      if (currentNav) {
        currentNav.focus({ preventScroll: true });
        return true;
      }
    }
    return false;
  }

  const fromEl =
    remoteFocusElement && remoteFocusElement.isConnected
      ? remoteFocusElement
      : current.matches(".tv-title-card")
        ? current
        : null;
  let next = libraryCardAt(grid, nextIndex, fromEl, index);
  if (!next) {
    next = ensureLibraryIndexMounted(grid, nextIndex);
  }
  if (!next) return false;

  markRemoteLibraryFocus(grid, next, nextIndex, () => {
    // One pair of rect reads per frame (layout is clean at rAF start), then a
    // single scroll write that keeps the card inside the safe viewport band.
    const gridRect = grid.getBoundingClientRect();
    const cardRect = next.getBoundingClientRect();
    const inset = Math.min(40, Math.max(24, gridRect.height * 0.05));
    if (cardRect.top < gridRect.top + inset) {
      grid.scrollTop += cardRect.top - (gridRect.top + inset);
    } else if (cardRect.bottom > gridRect.bottom - inset) {
      grid.scrollTop += cardRect.bottom - (gridRect.bottom - inset);
    }
  });
  return true;
}


const uniformGridColumnCache = new WeakMap<
  HTMLElement,
  { cols: number; width: number; count: number }
>();

/** Columns of a DOM-ordered uniform grid, re-measured only when width or item count changes. */
function uniformGridColumns(container: HTMLElement): number {
  const width = container.clientWidth;
  const count = container.children.length;
  const cached = uniformGridColumnCache.get(container);
  if (cached && cached.width === width && cached.count === count) return cached.cols;
  const first = container.firstElementChild;
  if (!(first instanceof HTMLElement)) return 1;
  const top = first.offsetTop;
  let cols = 0;
  for (let i = 0; i < container.children.length; i += 1) {
    const child = container.children[i];
    if (!(child instanceof HTMLElement) || child.offsetTop !== top) break;
    cols += 1;
  }
  cols = Math.max(1, cols);
  uniformGridColumnCache.set(container, { cols, width, count });
  return cols;
}

/** Scroll the nearest vertical scroller just enough to keep `element` inside its safe band. */
function revealInVerticalScroller(element: HTMLElement): void {
  const scroller = element.closest<HTMLElement>(
    '[data-tv-scroll-container][data-tv-scroll-axis="vertical"]'
  );
  if (!scroller) return;
  const scrollerRect = scroller.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const inset = Math.min(40, Math.max(24, scrollerRect.height * 0.05));
  if (rect.top < scrollerRect.top + inset) {
    scroller.scrollTop += rect.top - (scrollerRect.top + inset);
  } else if (rect.bottom > scrollerRect.bottom - inset) {
    scroller.scrollTop += rect.bottom - (scrollerRect.bottom - inset);
  }
}

/**
 * O(1) neighbour step for any DOM-ordered, equal-cell grid marked
 * `data-tv-grid` (Search results). `data-tv-grid-edge-left` names a selector
 * to focus when Left leaves the first column.
 */
function focusWithinUniformGrid(
  current: HTMLElement,
  direction: Direction
): boolean {
  const container =
    remoteFocusGrid?.isConnected && remoteFocusGrid.hasAttribute("data-tv-grid")
      ? remoteFocusGrid
      : current.closest<HTMLElement>("[data-tv-grid]");
  if (!container) return false;

  let index = remoteFocusGrid === container ? remoteFocusIndex : -1;
  if (index < 0) {
    let cell: HTMLElement | null = current;
    while (cell && cell.parentElement !== container) cell = cell.parentElement;
    if (!cell) return false;
    index = Array.prototype.indexOf.call(container.children, cell);
    if (index < 0) return false;
  }
  const columns = uniformGridColumns(container);
  const nextIndex = titleGridNeighbourIndex(
    index,
    container.children.length,
    columns,
    direction
  );
  if (nextIndex === null) {
    const edgeSelector =
      direction === "left" && index % columns === 0
        ? container.dataset.tvGridEdgeLeft
        : undefined;
    const edgeTarget = edgeSelector
      ? document.querySelector<HTMLElement>(edgeSelector)
      : null;
    if (edgeTarget) {
      clearRemoteLibraryFocus();
      edgeTarget.focus({ preventScroll: true });
      return true;
    }
    return false;
  }
  const next = container.children[nextIndex];
  if (!(next instanceof HTMLElement)) return false;
  markRemoteLibraryFocus(container, next, nextIndex, () => revealInVerticalScroller(next));
  return true;
}

function remoteScrollBehavior(): ScrollBehavior {
  return document.body.dataset.inputMode === "remote" ? "auto" : "smooth";
}

export function shouldAutoFocusViewDefault({
  activeElementAllowsViewFocus,
  defaultTargetAvailable,
  focusHandled,
  userInteracted,
}: {
  activeElementAllowsViewFocus: boolean;
  defaultTargetAvailable: boolean;
  focusHandled: boolean;
  userInteracted: boolean;
}): boolean {
  return (
    activeElementAllowsViewFocus &&
    defaultTargetAvailable &&
    !focusHandled &&
    !userInteracted
  );
}

function visibleOnPerpendicularAxis(
  element: HTMLElement,
  direction: Direction,
  elementRect: FocusRect
): boolean {
  const container = element.closest<HTMLElement>("[data-tv-scroll-axis]");
  if (!container) return true;

  const axis = container.dataset.tvScrollAxis;
  const containerRect = focusRectFromDOMRect(container.getBoundingClientRect());

  if ((direction === "up" || direction === "down") && axis === "horizontal") {
    return (
      elementRect.right > containerRect.left + 2 &&
      elementRect.left < containerRect.right - 2
    );
  }
  if ((direction === "left" || direction === "right") && axis === "vertical") {
    return (
      elementRect.bottom > containerRect.top + 2 &&
      elementRect.top < containerRect.bottom - 2
    );
  }
  return true;
}

function focusWithinScrollContainer(
  current: HTMLElement,
  direction: Direction
): boolean {
  if (direction !== "left" && direction !== "right") return false;
  const container = current.closest<HTMLElement>('[data-tv-scroll-axis="horizontal"]');
  if (!container) return false;

  // Local rail scan: only focusables inside this track, not the whole page.
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (node) => !node.hasAttribute("disabled")
  );
  const currentIndex = nodes.indexOf(current);
  if (currentIndex < 0) return false;
  const nextIndex = currentIndex + (direction === "right" ? 1 : -1);
  const next = nodes[nextIndex];
  if (!next) {
    if (direction === "right") {
      const targetSelector = container.dataset.tvEdgeTargetRight;
      const edgeTarget = targetSelector
        ? document.querySelector<HTMLElement>(targetSelector)
        : null;
      if (edgeTarget) {
        edgeTarget.focus({ preventScroll: true });
        return true;
      }
    }
    // Right at the end of a horizontal rail is a hard boundary. Returning
    // handled here prevents the page-wide geometric fallback from selecting
    // a diagonally positioned card in the next rail. Left at the first item
    // deliberately remains unhandled so it can return focus to the main nav.
    return direction === "right";
  }

  // Focus must move immediately for responsive remote input, while the rail
  // glides to reveal the new card. `preventScroll` keeps the browser from
  // snapping an ancestor before our targeted rail animation starts.
  const pageScroller = document.querySelector<HTMLElement>(".app-main");
  const pageScrollTop = pageScroller?.scrollTop;
  const pageScrollLeft = pageScroller?.scrollLeft;
  next.focus({ preventScroll: true });
  markFocusableRectsDirty();
  revealFullyWithinHorizontalContainer(container, next);
  if (pageScroller && pageScrollTop !== undefined) {
    pageScroller.scrollTop = pageScrollTop;
    pageScroller.scrollLeft = pageScrollLeft ?? 0;
  }
  return true;
}

interface VerticalTrackNavigation {
  currentTrack: HTMLElement;
  surface: HTMLElement;
  target?: HTMLElement;
}

function navigationWithinVerticalTracks(
  current: HTMLElement,
  direction: Direction,
  entries: FocusableEntry[],
  rectByElement: WeakMap<HTMLElement, FocusRect>
): VerticalTrackNavigation | undefined {
  if (direction !== "up" && direction !== "down") return undefined;

  const currentTrack = current.closest<HTMLElement>(".tv-media-track");
  const surface = currentTrack?.parentElement;
  if (!currentTrack || !surface?.matches(".tv-rail-surface.is-vertical-tracks")) {
    return undefined;
  }

  const tracks = Array.from(surface.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.matches(".tv-media-track")
  );
  const currentTrackIndex = tracks.indexOf(currentTrack);
  if (currentTrackIndex < 0) return undefined;

  const itemsByTrack = tracks.map((track) =>
    entries
      .filter((entry) => track.contains(entry.element))
      .map((entry) => ({
        value: entry.element,
        centreX: focusCentre(entry.rect).x,
      }))
  );

  return {
    currentTrack,
    surface,
    target: findClosestItemInNextTrack(
      itemsByTrack,
      currentTrackIndex,
      focusCentre(rectFor(current, rectByElement)).x,
      direction
    ),
  };
}

export function centredVerticalTrackScrollTop({
  clientHeight,
  containerTop,
  scrollHeight,
  scrollTop,
  trackHeight,
  trackTop,
}: {
  clientHeight: number;
  containerTop: number;
  scrollHeight: number;
  scrollTop: number;
  trackHeight: number;
  trackTop: number;
}): number {
  const maximum = Math.max(0, scrollHeight - clientHeight);
  const target =
    scrollTop + trackTop + trackHeight / 2 - (containerTop + clientHeight / 2);
  return Math.max(0, Math.min(maximum, target));
}

function snapToVerticalTrackBoundary({
  currentTrack,
  surface,
}: VerticalTrackNavigation): void {
  const surfaceRect = surface.getBoundingClientRect();
  const trackRect = currentTrack.getBoundingClientRect();
  smoothScrollTo(surface, {
    top: centredVerticalTrackScrollTop({
      clientHeight: surface.clientHeight,
      containerTop: surfaceRect.top,
      scrollHeight: surface.scrollHeight,
      scrollTop: surface.scrollTop,
      trackHeight: trackRect.height,
      trackTop: trackRect.top,
    }),
  });
}

function focusExplicitEdgeTarget(
  current: HTMLElement,
  direction: Direction
): boolean {
  const attribute = `data-tv-edge-target-${direction}`;
  const selector = current.getAttribute(attribute);
  if (!selector) {
    return current.hasAttribute(`data-tv-edge-stop-${direction}`);
  }
  const target = document.querySelector<HTMLElement>(selector);
  if (!target) return false;
  target.focus({ preventScroll: true });
  const horizontalContainer = target.closest<HTMLElement>(
    '[data-tv-scroll-axis="horizontal"]'
  );
  if (horizontalContainer) {
    revealFullyWithinHorizontalContainer(horizontalContainer, target);
  } else if (target.closest<HTMLElement>('[data-tv-scroll-axis="vertical"]')) {
    target.scrollIntoView({
      behavior: remoteScrollBehavior(),
      block: "nearest",
      inline: "nearest",
    });
  }
  return true;
}

export function horizontalRevealDelta({
  containerLeft,
  containerRight,
  elementLeft,
  elementRight,
  scrollPaddingLeft = 0,
  scrollPaddingRight = 0,
}: {
  containerLeft: number;
  containerRight: number;
  elementLeft: number;
  elementRight: number;
  scrollPaddingLeft?: number;
  scrollPaddingRight?: number;
}): number {
  const visibleLeft = containerLeft + Math.max(0, scrollPaddingLeft);
  const visibleRight = containerRight - Math.max(0, scrollPaddingRight);
  if (elementLeft < visibleLeft) return elementLeft - visibleLeft;
  if (elementRight > visibleRight) return elementRight - visibleRight;
  return 0;
}

function revealFullyWithinHorizontalContainer(
  container: HTMLElement,
  element: HTMLElement
): void {
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const style = window.getComputedStyle(container);
  const startInset = parsePixelValue(style.scrollPaddingLeft);
  const endInset = parsePixelValue(style.scrollPaddingRight);
  const delta = horizontalRevealDelta({
    containerLeft: containerRect.left,
    containerRight: containerRect.right,
    elementLeft: elementRect.left,
    elementRight: elementRect.right,
    scrollPaddingLeft: startInset,
    scrollPaddingRight: endInset,
  });

  if (Math.abs(delta) < 0.5) return;

  const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
  const targetScrollLeft = Math.max(0, Math.min(maxScrollLeft, container.scrollLeft + delta));
  smoothScrollTo(container, { left: targetScrollLeft });
}

function parsePixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function directionalVerticalScrollTop({
  clientHeight,
  direction,
  scrollHeight,
  scrollTop,
}: {
  clientHeight: number;
  direction: "up" | "down";
  scrollHeight: number;
  scrollTop: number;
}): number {
  const maximum = Math.max(0, scrollHeight - clientHeight);
  const distance = Math.max(160, clientHeight * 0.72);
  return Math.max(
    0,
    Math.min(maximum, scrollTop + (direction === "down" ? distance : -distance))
  );
}

function scrollVerticalContainer(
  current: HTMLElement,
  direction: Direction
): boolean {
  if (direction !== "up" && direction !== "down") return false;
  const container =
    current.closest<HTMLElement>(
      '[data-tv-scroll-container][data-tv-scroll-axis="vertical"]'
    ) ??
    document.querySelector<HTMLElement>(
      '[data-tv-scroll-container][data-tv-scroll-axis="vertical"]'
    );

  // A marked container that has handed its real overflow off to the document
  // (see useNativeScrollRoot) reports no internal scroll room of its own;
  // document.scrollingElement is where that page's actual overflow lives.
  const candidates = [container, document.scrollingElement as HTMLElement | null].filter(
    (element): element is HTMLElement => element !== null
  );

  for (const element of candidates) {
    const target = directionalVerticalScrollTop({
      clientHeight: element.clientHeight,
      direction,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    });
    if (Math.abs(target - element.scrollTop) < 1) continue;
    smoothScrollTo(element, { top: target });
    return true;
  }
  return false;
}

function focusActiveAlphabet(
  current: HTMLElement,
  direction: Direction,
  currentRect: FocusRect
): boolean {
  const activeLetter =
    document.querySelector<HTMLElement>(".tv-alphabet button.is-active") ??
    document.querySelector<HTMLElement>(".tv-alphabet button");
  if (!activeLetter) return false;

  if (current.matches(".tv-filter-launcher") && direction === "down") {
    activeLetter.focus({ preventScroll: true });
    return true;
  }

  const grid = current.closest<HTMLElement>(".tv-title-grid");
  if (!grid || direction !== "right") return false;

  // Cheap same-row check: only measure cards until one neighbour is found.
  const cards = grid.querySelectorAll<HTMLElement>(".tv-title-card");
  const neighbourRects: FocusRect[] = [];
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index]!;
    if (card === current) continue;
    const rect = focusRectFromDOMRect(card.getBoundingClientRect());
    const verticalOverlap = Math.max(
      0,
      Math.min(currentRect.bottom, rect.bottom) - Math.max(currentRect.top, rect.top)
    );
    if (verticalOverlap < Math.min(currentRect.height, rect.height) * 0.45) continue;
    neighbourRects.push(rect);
    if (hasHorizontalNeighbourToRight(currentRect, neighbourRects)) return false;
  }

  activeLetter.focus({ preventScroll: true });
  return true;
}

/**
 * Home-rail step: sibling L/R, adjacent-rail U/D.
 * Under remote: same deferred-focus path as the library grid.
 */
function focusWithinHomeRails(
  current: HTMLElement,
  direction: Direction
): boolean {
  const card =
    remoteFocusElement?.isConnected &&
    remoteFocusElement.classList.contains("tv-home-card")
      ? remoteFocusElement
      : current.classList.contains("tv-home-card")
        ? current
        : current.closest<HTMLElement>(".tv-home-card");
  if (!card) return false;
  const home = card.closest<HTMLElement>(".tv-home");
  if (!home) return false;
  const remote = document.body.dataset.inputMode === "remote";

  const commit = (target: HTMLElement) => {
    remoteFocusElement = target;
    remoteFocusIndex = -1;
    remoteFocusGrid = null;
    const sideways = direction === "left" || direction === "right";
    pendingApply = () => {
      if (!remote) {
        setRemoteActiveMarker(null);
        window.clearTimeout(remoteFocusSettleTimer);
        target.focus({ preventScroll: true });
        return;
      }
      // Reads and scroll writes first, marker write last, so no forced style
      // recalc sits between them. Keep the virtual focus on screen: sideways
      // moves only scroll the rail; moves between rails scroll the page's
      // vertical track surface and reveal the card inside its own rail.
      const rail = target.closest<HTMLElement>('[data-tv-scroll-axis="horizontal"]');
      if (!sideways) revealInVerticalScroller(target);
      if (rail) revealFullyWithinHorizontalContainer(rail, target);
      setRemoteActiveMarker(target);
      armRemoteFocusSettle(target);
    };
  };

  if (direction === "left" || direction === "right") {
    const sibling =
      direction === "right"
        ? card.nextElementSibling
        : card.previousElementSibling;
    if (
      sibling instanceof HTMLElement &&
      sibling.classList.contains("tv-home-card")
    ) {
      commit(sibling);
      // Skip scrollLeft reads mid-hold under remote (layout thrash).
      if (!remote) {
        const rail = sibling.closest<HTMLElement>("[data-tv-scroll-container]");
        if (rail && rail.dataset.tvScrollAxis === "horizontal") {
          const targetLeft = Math.max(
            0,
            sibling.offsetLeft - Math.max(24, rail.clientWidth * 0.05)
          );
          const viewLeft = rail.scrollLeft;
          const viewRight = viewLeft + rail.clientWidth;
          if (
            sibling.offsetLeft < viewLeft + 24 ||
            sibling.offsetLeft + sibling.offsetWidth > viewRight - 24
          ) {
            rail.scrollLeft = targetLeft;
          }
        }
      }
      return true;
    }
    return false;
  }

  const currentRail = card.closest<HTMLElement>("[data-tv-scroll-container]");
  if (!currentRail) return false;
  const rails = home.querySelectorAll<HTMLElement>(
    '[data-tv-scroll-container][data-tv-scroll-axis="horizontal"]'
  );
  let railIndex = -1;
  for (let i = 0; i < rails.length; i += 1) {
    if (rails[i] === currentRail) {
      railIndex = i;
      break;
    }
  }
  if (railIndex < 0) return false;
  const nextRailIndex = direction === "down" ? railIndex + 1 : railIndex - 1;
  if (nextRailIndex < 0 || nextRailIndex >= rails.length) return false;
  const nextRail = rails[nextRailIndex]!;
  const cards = nextRail.querySelectorAll<HTMLElement>(".tv-home-card");
  if (cards.length === 0) return false;
  // Geometric, never by index: the card visually below/above wins, and the
  // target rail is only scrolled (by the reveal in `commit`) to unclip it.
  const cardRect = card.getBoundingClientRect();
  const railRect = nextRail.getBoundingClientRect();
  const target = pickNearestCardByCentre(
    Array.from(cards, (value) => {
      const rect = value.getBoundingClientRect();
      return { value, left: rect.left, right: rect.right };
    }),
    cardRect.left + cardRect.width / 2,
    railRect.left,
    railRect.right
  );
  if (!target) return false;
  commit(target);
  return true;
}

/**
 * The virtual focus only owns directional input while real focus is still in
 * the same region (or nowhere). If focus has moved elsewhere -- a context-menu
 * drawer, the nav rail, an input -- the marker is stale and must not steer
 * keys behind it.
 */
function dropStaleVirtualFocus(): void {
  const virtual = remoteFocusElement;
  if (!virtual) return;
  const active = document.activeElement;
  if (!virtual.isConnected) {
    clearRemoteLibraryFocus();
    return;
  }
  if (!active || active === document.body || active === virtual) return;
  const region = virtual.closest<HTMLElement>(
    ".tv-title-grid, [data-tv-grid], .tv-home-rails"
  );
  if (region?.contains(active)) return;
  clearRemoteLibraryFocus();
}

function moveFocus(direction: Direction): void {
  dropStaleVirtualFocus();
  // Fast path: library title grids never need a whole-document scan.
  // Prefer in-memory remote focus so holds never re-query the DOM.
  const active =
    (remoteFocusElement && remoteFocusElement.isConnected
      ? remoteFocusElement
      : null) ??
    (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  if (active && focusWithinTitleGrid(active, direction)) return;
  if (active && focusWithinUniformGrid(active, direction)) return;
  if (active && focusWithinHomeRails(active, direction)) return;

  // Leaving the O(1) paths: hand the virtual focus to the browser so the
  // geometric search starts from the card the user actually sees, and drop the
  // marker so it cannot linger on a card focus has left.
  if (remoteFocusElement) {
    const virtual = remoteFocusElement;
    clearRemoteLibraryFocus();
    if (virtual.isConnected) virtual.focus({ preventScroll: true });
    return moveFocus(direction);
  }

  const entries = collectVisibleFocusables();
  if (entries.length === 0) return;

  const rectByElement =
    focusableSnapshot?.rectByElement ?? new WeakMap<HTMLElement, FocusRect>();
  const nodes = entries.map((entry) => entry.element);

  const current =
    active && nodes.includes(active)
      ? active
      : null;
  if (!current) {
    (
      nodes.find((node) => node.hasAttribute("data-tv-focus-default")) ?? nodes[0]
    )?.focus({
      preventScroll: true,
    });
    return;
  }

  const mainNav = current.closest(".app-nav");
  const userControl = document.querySelector<HTMLElement>(".app-user-identity");
  if (mainNav && (direction === "up" || direction === "down")) {
    const navItems = Array.from(mainNav.querySelectorAll<HTMLElement>(".app-nav-link"));
    const currentIndex = navItems.indexOf(current);
    const nextIndex = currentIndex + (direction === "down" ? 1 : -1);
    const nextNavItem = navItems[nextIndex];
    if (nextNavItem) {
      nextNavItem.focus({ preventScroll: true });
      return;
    }
    if (direction === "down" && userControl) {
      userControl.focus({ preventScroll: true });
      return;
    }
  }
  if (current.closest(".app-user-identity") && direction === "up") {
    const navItems = document.querySelectorAll<HTMLElement>(".app-nav-link");
    navItems.item(navItems.length - 1)?.focus({ preventScroll: true });
    return;
  }

  const currentRect = rectFor(current, rectByElement);

  if (focusExplicitEdgeTarget(current, direction)) return;
  if (focusActiveAlphabet(current, direction, currentRect)) return;
  if (focusWithinScrollContainer(current, direction)) return;

  const candidateEntries = entries.filter(
    (entry) => !entry.element.closest(".app-user-identity")
  );
  const verticalTrackNavigation = navigationWithinVerticalTracks(
    current,
    direction,
    candidateEntries,
    rectByElement
  );
  if (verticalTrackNavigation && !verticalTrackNavigation.target) {
    snapToVerticalTrackBoundary(verticalTrackNavigation);
    return;
  }

  const geometricCandidates = candidateEntries
    .filter(
      (entry) =>
        entry.element !== current &&
        visibleOnPerpendicularAxis(entry.element, direction, entry.rect)
    )
    .map((entry) => ({ item: entry.element, rect: entry.rect }));

  const next =
    verticalTrackNavigation?.target ??
    pickBestDirectionalTarget(currentRect, geometricCandidates, direction);

  if (next) {
    const homeMove = Boolean(current.closest(".tv-home") || next.closest(".tv-home"));
    const pageScroller = homeMove
      ? document.querySelector<HTMLElement>(".app-main")
      : null;
    const pageScrollTop = pageScroller?.scrollTop;
    const pageScrollLeft = pageScroller?.scrollLeft;
    next.focus({ preventScroll: true });
    markFocusableRectsDirty();
    const scrollContainer = next.closest<HTMLElement>("[data-tv-scroll-container]");
    if (scrollContainer) {
      const isVerticalRail = scrollContainer.dataset.tvScrollAxis === "vertical";
      if (!isVerticalRail) {
        revealFullyWithinHorizontalContainer(scrollContainer, next);
        if (pageScroller && pageScrollTop !== undefined) {
          pageScroller.scrollTop = pageScrollTop;
          pageScroller.scrollLeft = pageScrollLeft ?? 0;
        }
        return;
      }

      const containerRect = scrollContainer.getBoundingClientRect();
      const nextRect = next.getBoundingClientRect();
      const horizontalInset = Math.min(56, Math.max(24, scrollContainer.clientWidth * 0.05));
      const verticalInset = Math.min(64, Math.max(36, scrollContainer.clientHeight * 0.08));
      const horizontalDelta =
        nextRect.left < containerRect.left + horizontalInset
          ? nextRect.left - (containerRect.left + horizontalInset)
          : nextRect.right > containerRect.right - horizontalInset
            ? nextRect.right - (containerRect.right - horizontalInset)
            : 0;
      const verticalDelta =
        nextRect.top < containerRect.top + verticalInset
          ? nextRect.top - (containerRect.top + verticalInset)
          : nextRect.bottom > containerRect.bottom - verticalInset
            ? nextRect.bottom - (containerRect.bottom - verticalInset)
            : 0;
      if (horizontalDelta !== 0 || verticalDelta !== 0) {
        // Directory rows should glide into their safe viewport area. Each
        // new key press retargets the native animation to the newly focused
        // card, avoiding the hard row-by-row jumps of a forced auto scroll.
        smoothScrollTo(scrollContainer, {
          left: scrollContainer.scrollLeft + horizontalDelta,
          top: scrollContainer.scrollTop + verticalDelta,
        });
      }
    } else if (!homeMove) {
      next.scrollIntoView({
        behavior: remoteScrollBehavior(),
        block: "nearest",
        inline: "nearest",
      });
    }
    if (pageScroller && pageScrollTop !== undefined) {
      pageScroller.scrollTop = pageScrollTop;
      pageScroller.scrollLeft = pageScrollLeft ?? 0;
    }
    return;
  }

  scrollVerticalContainer(current, direction);
}

export function parentRoute(pathname: string, requestedBackTo?: string): string {
  if (
    requestedBackTo === "/" ||
    requestedBackTo === "/series" ||
    requestedBackTo === "/movies" ||
    requestedBackTo === "/sites" ||
    requestedBackTo === "/music" ||
    requestedBackTo === "/profiles" ||
    requestedBackTo === "/settings" ||
    requestedBackTo === "/clients" ||
    (typeof requestedBackTo === "string" &&
      /^\/playlists(?:\?playlist=[^&]+(?:&.*)?)?$/.test(requestedBackTo)) ||
    (typeof requestedBackTo === "string" && /^\/search(?:\?.*)?$/.test(requestedBackTo))
  ) {
    return requestedBackTo;
  }
  if (/^\/search\/[^/]+$/.test(pathname)) return "/search";
  if (/^\/series\/[^/]+$/.test(pathname)) return "/series";
  if (/^\/movies\/[^/]+$/.test(pathname)) return "/movies";
  if (/^\/sites\/[^/]+$/.test(pathname)) return "/sites";
  if (/^\/music\/[^/]+$/.test(pathname)) return "/music";
  if (/^\/playlists\/[^/]+$/.test(pathname)) return "/playlists";
  if (/^\/settings\/[^/]+$/.test(pathname)) return "/settings";
  if (/^\/clients\/[^/]+$/.test(pathname)) return "/clients";
  if (
    pathname === "/search" ||
    pathname === "/series" ||
    pathname === "/movies" ||
    pathname === "/sites" ||
    pathname === "/music" ||
    pathname === "/profiles" ||
    pathname === "/settings" ||
    pathname === "/clients"
  ) {
    return "/";
  }
  return "/";
}

export function tvBackNavigationTarget(
  routeKey: string,
  requestedBackTo?: string,
  hasNavigationOrigin = false
): string | -1 | null {
  if (hasNavigationOrigin) return -1;
  const target = parentRoute(routeKey, requestedBackTo);
  return target === routeKey ? null : target;
}

/**
 * Directional keys are queued and applied once per animation frame. Under a
 * busy main thread several keydowns can pile up; applying them in one task
 * (index math only, a single DOM write) means the frame cost is paid once
 * instead of once per key, so a held remote button cannot build a backlog.
 */
const queuedMoves: Direction[] = [];
let moveFrame = 0;

function flushQueuedMoves(): void {
  if (moveFrame) {
    window.cancelAnimationFrame(moveFrame);
    moveFrame = 0;
  }
  if (queuedMoves.length === 0) return;
  const batch = queuedMoves.splice(0);
  for (const direction of batch) moveFocus(direction);
  runPendingApply();
}

function enqueueMove(direction: Direction): void {
  queuedMoves.push(direction);
  if (moveFrame) return;
  moveFrame = window.requestAnimationFrame(() => {
    moveFrame = 0;
    flushQueuedMoves();
  });
}

function handleDirectionalKeyDown(event: KeyboardEvent): boolean {
  // OK/Enter is handled by the focused element itself (the capture-phase guard
  // has already moved focus to the virtual target).
  if (isConfirmKey(event)) return false;

  const direction: Direction | undefined =
    event.key === "ArrowUp"
      ? "up"
      : event.key === "ArrowDown"
        ? "down"
        : event.key === "ArrowLeft"
          ? "left"
          : event.key === "ArrowRight"
            ? "right"
            : undefined;
  if (!direction) return false;

  const formControl = formControlDescriptor(event.target);
  if (formControl && !shouldNavigateFromFormControl(event.key, formControl)) {
    return false;
  }

  event.preventDefault();
  noteNavigationKey();
  if (document.body.dataset.inputMode !== "remote") {
    document.body.dataset.inputMode = "remote";
  }
  enqueueMove(direction);
  return true;
}

/**
 * Some TV browsers (e.g. sideloaded Android TV cursor browsers) only know how
 * to scroll the document itself — an edge-of-screen cursor gesture moves the
 * WebView's own root scroll offset, not an arbitrary nested overflow div.
 * Mount this on simple, self-contained pre-auth surfaces to hand their real
 * overflow to `document.scrollingElement` for the surface's lifetime; see
 * `.is-native-scroll-root` in global.css for the matching layout change.
 */
export function useNativeScrollRoot(): void {
  useEffect(() => {
    // Toggled on <html>, not <body>: document.scrollingElement is the root
    // <html> element in standards mode, and that's what scrollVerticalContainer
    // falls back to, so the class and the CSS it drives must live there too.
    document.documentElement.classList.add("is-native-scroll-root");
    return () => {
      document.documentElement.classList.remove("is-native-scroll-root");
    };
  }, []);
}

/** Directional focus bridge for pre-auth surfaces without route-back handling. */
export function useTvDirectionalNavigation(disabled = false): void {
  useEffect(() => {
    if (disabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      handleDirectionalKeyDown(event);
    };
    const handlePointer = () => {
      document.body.dataset.inputMode = "pointer";
    };

    const releaseConfirmCommit = acquireConfirmCommit();
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointer, { passive: true });
    return () => {
      releaseConfirmCommit();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointer);
    };
  }, [disabled]);
}

/**
 * Browser/remote bridge for the Playarr TV-style web surface. Arrow keys
 * move focus geometrically, while Escape and common TV back-key codes
 * behave like a remote's Back button.
 */
export function useTvNavigation(
  routeKey: string,
  disabled = false,
  requestedBackTo?: string,
  navigationOrigin?: NavigationOrigin | null
): void {
  const navigate = useNavigate();

  useEffect(() => {
    if (disabled) return;

    let focusHandled = false;
    let userInteracted = false;
    const view = document.querySelector<HTMLElement>(".app-main") ?? document;
    const focusViewDefault = () => {
      const activeElement = document.activeElement;
      const defaultTarget = visibleFocusables(view).find((node) =>
        node.hasAttribute("data-tv-focus-default")
      );
      if (
        !shouldAutoFocusViewDefault({
          activeElementAllowsViewFocus:
            activeElement === document.body ||
            (activeElement instanceof HTMLElement &&
              activeElement.closest(".app-nav") !== null),
          defaultTargetAvailable: defaultTarget !== undefined,
          focusHandled,
          userInteracted,
        })
      ) {
        return;
      }
      focusHandled = true;
      defaultTarget?.focus({ preventScroll: true });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      userInteracted = true;
      if (handleDirectionalKeyDown(event)) return;

      const isBack =
        event.key === "Escape" ||
        event.key === "BrowserBack" ||
        event.key === "GoBack" ||
        event.keyCode === 10009 ||
        event.keyCode === 461;
      if (isBack) {
        const target = tvBackNavigationTarget(
          routeKey,
          requestedBackTo,
          navigationOrigin != null
        );
        if (target === null) return;
        event.preventDefault();
        if (target === -1) navigate(-1);
        else navigate(target);
      }
    };

    const handlePointer = () => {
      userInteracted = true;
      flushQueuedMoves();
      document.body.dataset.inputMode = "pointer";
      // Commit deferred remote marker when leaving remote mode.
      if (remoteFocusElement) {
        const virtual = remoteFocusElement;
        clearRemoteLibraryFocus();
        if (virtual.isConnected) virtual.focus({ preventScroll: true });
      }
    };

    const releaseConfirmCommit = acquireConfirmCommit();
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointer, { passive: true });
    // Debounce default-focus scans. A raw childList observer on `.app-main`
    // re-ran full focusable collection on every artwork mount, which is the
    // dominant long-task source under 4K + CPU throttle while rails hydrate.
    let defaultFocusFrame = 0;
    const scheduleFocusViewDefault = () => {
      // Never re-scan defaults during a remote hold — DOM mutations from
      // virtualisation would schedule full focusable walks mid-key.
      if (document.body.dataset.inputMode === "remote") return;
      if (defaultFocusFrame) return;
      defaultFocusFrame = window.requestAnimationFrame(() => {
        defaultFocusFrame = 0;
        focusViewDefault();
      });
    };
    const defaultFocusObserver = new MutationObserver(scheduleFocusViewDefault);
    defaultFocusObserver.observe(view, {
      attributes: true,
      attributeFilter: ["data-tv-focus-default"],
      childList: true,
      subtree: true,
    });
    const initialFocus = window.setTimeout(focusViewDefault, 80);

    return () => {
      window.clearTimeout(initialFocus);
      if (defaultFocusFrame) window.cancelAnimationFrame(defaultFocusFrame);
      defaultFocusObserver.disconnect();
      releaseConfirmCommit();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointer);
    };
  }, [routeKey, disabled, navigate, navigationOrigin, requestedBackTo]);
}
