/**
 * Where focus starts on a page (web TV audit A8, R4, R10). Order: an explicit `data-tv-focus-default`, else the
 * first control in the page body, else the header Back. The nav rail is never a start target.
 */
export type FocusRegion = "nav" | "back" | "content";
export type FocusCandidate = { region: FocusRegion; explicit: boolean };
export type ViewDefaultKind = "explicit" | "content" | "back";

export function pickViewDefault(
  candidates: readonly FocusCandidate[]
): { index: number; kind: ViewDefaultKind } | null {
  const explicit = candidates.findIndex((candidate) => candidate.explicit && candidate.region !== "nav");
  if (explicit >= 0) return { index: explicit, kind: "explicit" };
  const content = candidates.findIndex((candidate) => candidate.region === "content");
  if (content >= 0) return { index: content, kind: "content" };
  const back = candidates.findIndex((candidate) => candidate.region === "back");
  if (back >= 0) return { index: back, kind: "back" };
  return null;
}

const RANK: Record<ViewDefaultKind, number> = { back: 0, content: 1, explicit: 2 };

/**
 * A page that opened on Back (or its first control) while loading moves focus to something better once that
 * renders, until the user acts. `autoKind` is what the page auto-focused and still holds focus, else null.
 */
export function shouldUpgradeFallbackFocus(options: {
  autoKind: ViewDefaultKind | null;
  bestKind: ViewDefaultKind | null;
  userInteracted: boolean;
}): boolean {
  if (options.userInteracted || options.autoKind === null || options.bestKind === null) return false;
  return RANK[options.bestKind] > RANK[options.autoKind];
}

export function regionOf(element: Element): FocusRegion {
  if (element.closest(".app-nav, .app-user-identity")) return "nav";
  if (element.closest(".tv-page-back")) return "back";
  return "content";
}

/**
 * Pages with the stage chrome (profile switcher, sign-in) carry theme and language selects at the top right. The
 * geometric search cannot reach them from the centred content, so UP from the content enters the controls and DOWN
 * from the controls returns to the page (audit R33).
 */
export function stageChromeBridge(options: {
  direction: "up" | "down" | "left" | "right";
  hasControls: boolean;
  inControls: boolean;
}): "controls" | "content" | null {
  if (!options.hasControls) return null;
  if (options.direction === "up" && !options.inControls) return "controls";
  if (options.direction === "down" && options.inControls) return "content";
  return null;
}
