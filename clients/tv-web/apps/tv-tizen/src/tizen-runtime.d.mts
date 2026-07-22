export const TIZEN_REMOTE_KEYS: readonly string[];
export function mediaKeyForTizenCode(keyCode: number): string | undefined;
export function tizenDisplayRectForBounds(
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
  viewportWidth: number,
  viewportHeight: number
): { x: number; y: number; width: number; height: number } | undefined;
export function applyTizenAvplayObjectBounds(
  element: HTMLElement | null | undefined,
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">
): boolean;
export function isTizenRootLocation(location: Pick<Location, "hash" | "pathname">): boolean;
export function hasTizenBackBlockingSurface(documentObject: Document): boolean;
export function loadPackagedConfig(options?: {
  fetchImpl?: typeof fetch;
  configUrl?: string;
  windowObject?: Window;
}): Promise<{ apiBaseUrl: string } | undefined>;
export function installTizenPlatformRuntime(options?: {
  windowObject?: Window;
  documentObject?: Document;
  tizenObject?: unknown;
  webapisObject?: unknown;
}): () => void;
