export function matchesRelative(element: Element, relative: string): boolean;
export function updateHasAttributes(
  documentObject: Document,
  definitions: Map<string, { anchor: string; relative: string }>
): void;
export function installLegacyHas(options?: { windowObject?: Window; documentObject?: Document }): () => void;
