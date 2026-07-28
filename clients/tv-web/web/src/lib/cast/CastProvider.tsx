import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CAST_RECEIVER_APP_ID,
  CastUnavailableError,
  classifyRequestSessionFailure,
  isCastEnvironmentSupported,
  loadCastSdk,
} from "./castSdk";

export interface CastContextValue {
  /**
   * True once the Cast Sender SDK has loaded *and* at least one receiver is
   * on the network -- the same signal Google's own `<google-cast-launcher>`
   * uses to decide whether to render itself at all. Firefox/Safari/iOS
   * Chrome, an insecure context, or simply "no Chromecast nearby yet" all
   * collapse to the same `false` here; `CastButton` renders nothing for any
   * of them, matching the real cast button's own behaviour.
   */
  available: boolean;
  castState: cast.framework.CastState | null;
  session: cast.framework.CastSession | null;
  /**
   * Resolves once a session exists, or resolves to `null` if the viewer
   * dismissed the device picker (`chrome.cast.ErrorCode.CANCEL` -- not a
   * real error, never thrown for it). Throws a plain `Error` for every
   * other failure. Some CAF sender builds resolve `requestSession()` with
   * the `ErrorCode` instead of rejecting with it; both shapes are handled
   * the same way here so callers only ever need one try/catch.
   */
  requestSession: () => Promise<cast.framework.CastSession | null>;
  endSession: () => void;
}

const CastReactContext = createContext<CastContextValue | null>(null);

export interface CastProviderProps {
  children: ReactNode;
  /** Overridable for tests; defaults to the registered Playarr Cast receiver. */
  receiverApplicationId?: string;
}

/**
 * React context around `cast.framework.CastContext`. Per this project's
 * "derive, don't sync" rule: `setOptions()` (called exactly once per loaded
 * SDK instance) is the one legitimate synchronize-with-an-external-system
 * effect below -- it loads the script, wires the two event listeners
 * `CastContext` offers, and stores their *raw* payloads
 * (`castState`/`session`) in state. `available` is never separately
 * store-and-synced; it's computed from that raw state during every render.
 */
export function CastProvider({
  children,
  receiverApplicationId = CAST_RECEIVER_APP_ID,
}: CastProviderProps) {
  const environmentSupported = useMemo(
    () => typeof window !== "undefined" && isCastEnvironmentSupported(window, navigator),
    []
  );
  const [sdk, setSdk] = useState<typeof cast | null>(null);
  const [castState, setCastState] = useState<cast.framework.CastState | null>(null);
  const [session, setSession] = useState<cast.framework.CastSession | null>(null);
  const unsubscribeRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    if (!environmentSupported) return;
    let cancelled = false;

    void loadCastSdk()
      .then((castApi) => {
        if (cancelled) return;
        const context = castApi.framework.CastContext.getInstance();
        context.setOptions({
          receiverApplicationId,
          autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        });

        const handleCastStateChanged = (event: cast.framework.CastStateEventData) => {
          setCastState(event.castState);
        };
        const handleSessionStateChanged = () => {
          setSession(context.getCurrentSession());
        };
        context.addEventListener(
          castApi.framework.CastContextEventType.CAST_STATE_CHANGED,
          handleCastStateChanged
        );
        context.addEventListener(
          castApi.framework.CastContextEventType.SESSION_STATE_CHANGED,
          handleSessionStateChanged
        );
        unsubscribeRef.current = () => {
          context.removeEventListener(
            castApi.framework.CastContextEventType.CAST_STATE_CHANGED,
            handleCastStateChanged
          );
          context.removeEventListener(
            castApi.framework.CastContextEventType.SESSION_STATE_CHANGED,
            handleSessionStateChanged
          );
        };

        setSdk(castApi);
        setCastState(context.getCastState());
        setSession(context.getCurrentSession());
      })
      .catch(() => {
        // Cast is categorically unavailable in this runtime (script
        // blocked by the network/an extension, timed out, or the callback
        // reported `available: false`) -- `available` below stays `false`
        // forever for this mount, `CastButton` renders nothing.
      });

    return () => {
      cancelled = true;
      unsubscribeRef.current?.();
      unsubscribeRef.current = undefined;
    };
  }, [environmentSupported, receiverApplicationId]);

  const available =
    sdk !== null && castState !== null && castState !== sdk.framework.CastState.NO_DEVICES_AVAILABLE;

  const requestSession = useCallback(async (): Promise<cast.framework.CastSession | null> => {
    if (!sdk) {
      throw new Error("Cast Sender SDK is not loaded yet.");
    }
    const context = sdk.framework.CastContext.getInstance();

    const handleFailure = (raw: unknown): null => {
      const code = typeof raw === "string" ? raw : undefined;
      if (code === chrome.cast.ErrorCode.CANCEL) {
        // The viewer dismissed the device picker -- not a real error.
        return null;
      }
      if (code !== undefined) {
        const reason = classifyRequestSessionFailure(code);
        throw reason
          ? new CastUnavailableError(reason, `Cast session request failed: ${code}`)
          : new Error(`Cast session request failed: ${code}`);
      }
      throw raw instanceof Error ? raw : new Error(String(raw));
    };

    let cancelledByUser = false;
    try {
      // Some CAF builds resolve this promise WITH the `ErrorCode` instead
      // of rejecting -- handled in both places so either behaviour works.
      const resolvedCode = await context.requestSession();
      if (resolvedCode !== undefined) {
        cancelledByUser = handleFailure(resolvedCode) === null;
      }
    } catch (caught: unknown) {
      cancelledByUser = handleFailure(caught) === null;
    }

    if (cancelledByUser) return null;
    return context.getCurrentSession();
  }, [sdk]);

  const endSession = useCallback(() => {
    sdk?.framework.CastContext.getInstance().endCurrentSession(true);
  }, [sdk]);

  const value = useMemo<CastContextValue>(
    () => ({ available, castState, session, requestSession, endSession }),
    [available, castState, session, requestSession, endSession]
  );

  return <CastReactContext.Provider value={value}>{children}</CastReactContext.Provider>;
}

export function useCast(): CastContextValue {
  const value = useContext(CastReactContext);
  if (!value) {
    throw new Error("useCast() must be called within a <CastProvider>.");
  }
  return value;
}
