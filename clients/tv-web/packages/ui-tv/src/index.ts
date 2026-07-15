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

export { VersionBanner } from "./screens/VersionBanner";
export type { VersionBannerProps } from "./screens/VersionBanner";

export { PlayerScreen } from "./screens/PlayerScreen";
export type { PlayerScreenProps } from "./screens/PlayerScreen";

export { PairingScreen } from "./screens/PairingScreen";
export type { PairingScreenProps } from "./screens/PairingScreen";

// Data-wired screen containers: fetch from the real API via `@streamarr-tv/api-client`
// (and drive the real RFC 8628 flow via `@streamarr-tv/device-auth`), then render the
// presentational screens above with real loading/empty/error state handling.
export { PairingScreenContainer } from "./screens/PairingScreenContainer";
export type { PairingScreenContainerProps } from "./screens/PairingScreenContainer";

export { BrowseScreenContainer } from "./screens/BrowseScreenContainer";
export type { BrowseScreenContainerProps } from "./screens/BrowseScreenContainer";

export { DetailScreenContainer } from "./screens/DetailScreenContainer";
export type { DetailScreenContainerProps } from "./screens/DetailScreenContainer";

export { PlayerScreenContainer } from "./screens/PlayerScreenContainer";
export type { PlayerScreenContainerProps } from "./screens/PlayerScreenContainer";

export { TvApp } from "./TvApp";
export type { TvAppProps } from "./TvApp";

export { AsyncStateMessage } from "./lib/AsyncStateMessage";
export type { AsyncStateMessageProps } from "./lib/AsyncStateMessage";

export { pickImage } from "./lib/images";
export { mimeTypeForPlaybackMode } from "./lib/playback";
