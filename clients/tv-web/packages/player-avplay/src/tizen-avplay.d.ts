/**
 * Minimal local declaration of the Tizen AVPlay Web API surface used by
 * this adapter, hand-written against Samsung's published AVPlay API
 * reference:
 * https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html
 *
 * There is no Tizen Studio SDK / TV Simulator available in this
 * environment, so this stands in for `@types/tizen-tv-webapis` (or the
 * SDK's own `tizen-web-device-api.d.ts`) purely for local typechecking.
 * Only the members `src/index.ts` actually calls are declared here --
 * extend as real usage grows. This is a global ambient declaration file
 * (no imports/exports), matching how the real Tizen SDK ships its types.
 */

type AVPlayState = "NONE" | "IDLE" | "READY" | "PLAYING" | "PAUSED";

type AVPlayDisplayMethod =
  | "PLAYER_DISPLAY_MODE_LETTER_BOX"
  | "PLAYER_DISPLAY_MODE_FULL_SCREEN"
  | "PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO";

type AVPlayDrmType = "PLAYREADY" | "WIDEVINE_CDM" | "VERIMATRIX";

interface AVPlayListener {
  onbufferingstart?: () => void;
  onbufferingprogress?: (percent: number) => void;
  onbufferingcomplete?: () => void;
  onstreamcompleted?: () => void;
  oncurrentplaytime?: (currentTime: number) => void;
  onerror?: (eventType: string) => void;
  onevent?: (eventType: string, eventData?: string) => void;
  onsubtitlechange?: (duration: number, text: string, data3: string, data4: string) => void;
  ondrmevent?: (drmEvent: string, drmData: string) => void;
}

/** Known `setStreamingProperty`/`getStreamingProperty` param names this adapter uses. */
interface AVPlayStreamingPropertyMap {
  ADAPTIVE_INFO: string;
  COOKIE: string;
  USER_AGENT: string;
  WIDEVINE_LICENSE_SERVER_URL: string;
  PLAYREADY_LICENSE_SERVER_URL: string;
}

interface AVPlayApi {
  open(url: string): void;
  close(): void;
  prepare(): void;
  prepareAsync(successCallback?: () => void, errorCallback?: (error: unknown) => void): void;
  play(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  seekTo(
    millisecond: number,
    successCallback?: () => void,
    errorCallback?: (error: unknown) => void
  ): void;
  jumpForward(
    millisecond: number,
    successCallback?: () => void,
    errorCallback?: (error: unknown) => void
  ): void;
  jumpBackward(
    millisecond: number,
    successCallback?: () => void,
    errorCallback?: (error: unknown) => void
  ): void;
  setDisplayRect(x: number, y: number, width: number, height: number): void;
  setDisplayMethod(method: AVPlayDisplayMethod): void;
  setTimeoutForBuffering(seconds: number): void;
  setListener(listener: AVPlayListener): void;
  setStreamingProperty<K extends keyof AVPlayStreamingPropertyMap>(
    param: K,
    value: AVPlayStreamingPropertyMap[K]
  ): void;
  getStreamingProperty<K extends keyof AVPlayStreamingPropertyMap>(
    param: K
  ): AVPlayStreamingPropertyMap[K];
  setDrm(drmType: AVPlayDrmType, param: string): void;
  getState(): AVPlayState;
  getDuration(): number;
  getCurrentTime(): number;
}

interface TizenWebApis {
  avplay: AVPlayApi;
}

/** Injected by the Tizen TV runtime; absent everywhere else (including this dev environment). */
declare const webapis: TizenWebApis;
