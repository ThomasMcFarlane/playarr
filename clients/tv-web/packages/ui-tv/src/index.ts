/**
 * @streamarr-tv/ui-tv
 *
 * Shared TV screen/component skeletons, built on @streamarr-tv/spatial-nav
 * for d-pad/remote focus navigation. Consumed by all three TV app shells
 * (webOS, Tizen, VIDAA fallback); the web app has its own routed pages
 * (`web/src/pages`) since mouse/keyboard navigation doesn't need spatial-nav.
 */

export { SpatialNavProvider, useSpatialNav, useFocusable } from "./SpatialNavContext";
export type { SpatialNavProviderProps, UseFocusableResult } from "./SpatialNavContext";

export { BrowseScreen } from "./screens/BrowseScreen";
export type { BrowseScreenProps, BrowseRow } from "./screens/BrowseScreen";

export { DetailScreen } from "./screens/DetailScreen";
export type { DetailScreenProps } from "./screens/DetailScreen";

export { PlayerScreen } from "./screens/PlayerScreen";
export type { PlayerScreenProps } from "./screens/PlayerScreen";
