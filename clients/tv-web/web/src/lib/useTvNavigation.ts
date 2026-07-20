import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { NavigationOrigin } from "./navigationLayer";
import {
  formControlDescriptor,
  shouldNavigateFromFormControl,
} from "./arrowNavigationPolicy";
import { findClosestItemInNextTrack } from "./trackNavigation";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type Direction = "up" | "down" | "left" | "right";

function visibleFocusables(requestedScope?: Document | HTMLElement): HTMLElement[] {
  const modal = document.querySelector<HTMLElement>('[aria-modal="true"]');
  const scope: Document | HTMLElement = modal ?? requestedScope ?? document;
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      !element.closest('[aria-hidden="true"]')
    );
  });
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

function visibleOnPerpendicularAxis(element: HTMLElement, direction: Direction): boolean {
  const container = element.closest<HTMLElement>("[data-tv-scroll-axis]");
  if (!container) return true;

  const axis = container.dataset.tvScrollAxis;
  const rect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  if ((direction === "up" || direction === "down") && axis === "horizontal") {
    return rect.right > containerRect.left + 2 && rect.left < containerRect.right - 2;
  }
  if ((direction === "left" || direction === "right") && axis === "vertical") {
    return rect.bottom > containerRect.top + 2 && rect.top < containerRect.bottom - 2;
  }
  return true;
}

function centre(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function scoreCandidate(from: DOMRect, to: DOMRect, direction: Direction): number | null {
  const a = centre(from);
  const b = centre(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const isVertical = direction === "up" || direction === "down";
  const forward =
    direction === "up"
      ? dy < -2
      : direction === "down"
        ? dy > 2
        : direction === "left"
          ? dx < -2
          : dx > 2;
  if (!forward) return null;

  const primary = Math.abs(isVertical ? dy : dx);
  const lateral = Math.abs(isVertical ? dx : dy);
  const overlap =
    isVertical
      ? Math.max(0, Math.min(from.right, to.right) - Math.max(from.left, to.left))
      : Math.max(0, Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top));

  // A directional press must remain primarily directional. Without this
  // cone, an element far to the right but a few pixels lower can win an
  // ArrowDown search simply because no perfectly aligned item is nearby.
  // Cross-axis overlap identifies the same visual row/column; otherwise
  // reject targets whose diagonal drift is larger than their forward move.
  const crossAxisSize = isVertical
    ? Math.min(from.width, to.width)
    : Math.min(from.height, to.height);
  const coneAllowance = primary * 0.85 + crossAxisSize * 0.2;
  if (overlap <= 0 && lateral > coneAllowance) return null;

  return primary + lateral * 4 - Math.min(overlap, 180) * 0.55;
}

function focusWithinScrollContainer(
  current: HTMLElement,
  direction: Direction
): boolean {
  if (direction !== "left" && direction !== "right") return false;
  const container = current.closest<HTMLElement>('[data-tv-scroll-axis="horizontal"]');
  if (!container) return false;

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
  revealFullyWithinHorizontalContainer(container, next);
  if (pageScroller && pageScrollTop !== undefined) {
    pageScroller.scrollTop = pageScrollTop;
    pageScroller.scrollLeft = pageScrollLeft ?? 0;
  }
  return true;
}

function closestItemInAdjacentTrack(
  current: HTMLElement,
  direction: Direction,
  nodes: HTMLElement[]
): HTMLElement | undefined {
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
    nodes
      .filter((node) => track.contains(node))
      .map((node) => ({
        value: node,
        centreX: centre(node.getBoundingClientRect()).x,
      }))
  );

  return findClosestItemInNextTrack(
    itemsByTrack,
    currentTrackIndex,
    centre(current.getBoundingClientRect()).x,
    direction
  );
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
    target.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
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
  container.scrollTo({
    left: targetScrollLeft,
    behavior: "smooth",
  });
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
  if (!container) return false;

  const target = directionalVerticalScrollTop({
    clientHeight: container.clientHeight,
    direction,
    scrollHeight: container.scrollHeight,
    scrollTop: container.scrollTop,
  });
  if (Math.abs(target - container.scrollTop) < 1) return false;
  container.scrollTo({ top: target, behavior: "smooth" });
  return true;
}

function focusActiveAlphabet(current: HTMLElement, direction: Direction): boolean {
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

  const currentRect = current.getBoundingClientRect();
  const hasCardToRight = Array.from(
    grid.querySelectorAll<HTMLElement>(".tv-title-card")
  ).some((card) => {
    if (card === current) return false;
    const rect = card.getBoundingClientRect();
    const verticalOverlap = Math.max(
      0,
      Math.min(currentRect.bottom, rect.bottom) - Math.max(currentRect.top, rect.top)
    );
    return (
      centre(rect).x > centre(currentRect).x + 2 &&
      verticalOverlap >= Math.min(currentRect.height, rect.height) * 0.45
    );
  });
  if (hasCardToRight) return false;

  activeLetter.focus({ preventScroll: true });
  return true;
}

function moveFocus(direction: Direction): void {
  const nodes = visibleFocusables();
  if (nodes.length === 0) return;

  const current =
    document.activeElement instanceof HTMLElement && nodes.includes(document.activeElement)
      ? document.activeElement
      : null;
  if (!current) {
    (nodes.find((node) => node.hasAttribute("data-tv-focus-default")) ?? nodes[0])?.focus({
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

  if (focusExplicitEdgeTarget(current, direction)) return;
  if (focusActiveAlphabet(current, direction)) return;
  if (focusWithinScrollContainer(current, direction)) return;

  const currentRect = current.getBoundingClientRect();
  const candidates = nodes.filter((node) => !node.closest(".app-user-identity"));
  const next =
    closestItemInAdjacentTrack(current, direction, candidates) ??
    candidates
      .filter((node) => node !== current && visibleOnPerpendicularAxis(node, direction))
      .map((node) => ({
        node,
        score: scoreCandidate(currentRect, node.getBoundingClientRect(), direction),
      }))
      .filter(
        (candidate): candidate is { node: HTMLElement; score: number } =>
          candidate.score !== null
      )
      .sort((a, b) => a.score - b.score)[0]?.node;

  if (next) {
    const homeMove = Boolean(current.closest(".tv-home") || next.closest(".tv-home"));
    const pageScroller = homeMove
      ? document.querySelector<HTMLElement>(".app-main")
      : null;
    const pageScrollTop = pageScroller?.scrollTop;
    const pageScrollLeft = pageScroller?.scrollLeft;
    next.focus({ preventScroll: true });
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
        scrollContainer.scrollTo({
          left: scrollContainer.scrollLeft + horizontalDelta,
          top: scrollContainer.scrollTop + verticalDelta,
          behavior: "smooth",
        });
      }
    } else if (!homeMove) {
      next.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
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

function handleDirectionalKeyDown(event: KeyboardEvent): boolean {
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
  document.body.dataset.inputMode = "remote";
  moveFocus(direction);
  return true;
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

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointer, { passive: true });
    return () => {
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
        event.preventDefault();
        if (navigationOrigin) {
          navigate(-1);
        } else {
          navigate(parentRoute(routeKey, requestedBackTo));
        }
      }
    };

    const handlePointer = () => {
      userInteracted = true;
      document.body.dataset.inputMode = "pointer";
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointer, { passive: true });
    const defaultFocusObserver = new MutationObserver(focusViewDefault);
    defaultFocusObserver.observe(view, {
      attributes: true,
      attributeFilter: ["data-tv-focus-default"],
      childList: true,
      subtree: true,
    });
    const initialFocus = window.setTimeout(focusViewDefault, 80);

    return () => {
      window.clearTimeout(initialFocus);
      defaultFocusObserver.disconnect();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointer);
    };
  }, [routeKey, disabled, navigate, navigationOrigin, requestedBackTo]);
}
