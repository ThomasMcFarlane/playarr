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
import { usePrimaryApiClient, useCurrentUserId } from "../ApiClientProvider";
import { IS_TV, PLAYARR_CLIENT_PLATFORM } from "../clientPlatform";
import type { ActivePlayerSession } from "../playerSession";
import {
  applyTextCommand,
  defaultDeviceName,
  executePlaybackCommand,
  navigationKeyFor,
  parseTextArgs,
  WEB_HANDOFF_ONLY_CAPABILITIES,
  WEB_TARGET_CAPABILITIES,
  type RemoteCommandOutcome,
} from "./commands";
import { getRemotePlayer, subscribeRemotePlayer } from "./playerBridge";
import {
  RemoteTargetHost,
  type HandoffOffer,
  type HandoffResult,
  type PairingRequest,
} from "./targetHost";
import { RemotePairingPrompt } from "../../components/remote/RemotePairingPrompt";

const HOST_STORAGE_KEY = "playarr.remote.hostEnabled.v1";
const HANDOFF_START_TIMEOUT_MS = 40_000;
const CATCH_UP_THRESHOLD_MS = 1_500;

function readHostEnabled(): boolean {
  try {
    const stored = window.localStorage.getItem(HOST_STORAGE_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // Storage unavailable: fall through to the platform default.
  }
  return IS_TV;
}

interface RemoteContextValue {
  hostEnabled: boolean;
  setHostEnabled: (enabled: boolean) => void;
}

const RemoteContext = createContext<RemoteContextValue>({
  hostEnabled: false,
  setHostEnabled: () => undefined,
});

export function useRemoteHost(): RemoteContextValue {
  return useContext(RemoteContext);
}

/** Dispatches a synthetic key the app's global spatial navigation already understands. */
function dispatchKey(key: string, keyCode: number): void {
  const target: EventTarget = document.activeElement ?? window;
  for (const type of ["keydown", "keyup"] as const) {
    target.dispatchEvent(
      new KeyboardEvent(type, { key, keyCode, which: keyCode, bubbles: true, cancelable: true })
    );
  }
}

function executeNavigate(
  args: Record<string, unknown>,
  goHome: () => void
): RemoteCommandOutcome {
  const key = String(args.key ?? "");
  if (key === "select") {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
      active.click();
      return { status: "ok" };
    }
    return { status: "failed", detail: "nothing focused" };
  }
  if (key === "home") {
    goHome();
    return { status: "ok" };
  }
  const mapped = navigationKeyFor(key);
  if (!mapped) return { status: "unsupported", detail: "unsupported key" };
  dispatchKey(mapped.key, mapped.keyCode);
  return { status: "ok" };
}

function executeText(args: Record<string, unknown>): RemoteCommandOutcome {
  const field = document.activeElement;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
    return { status: "failed", detail: "no text field is focused" };
  }
  const text = parseTextArgs(args);
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  const next = applyTextCommand(field.value, start, end, text);
  // React controlled inputs only notice changes made through the native setter.
  const proto = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, next.value);
  try {
    field.setSelectionRange(next.caret, next.caret);
  } catch {
    // Some input types (email, number) do not support selection ranges.
  }
  field.dispatchEvent(new Event("input", { bubbles: true }));
  if (text.submit) {
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })
    );
    field.form?.requestSubmit();
  }
  return { status: "ok" };
}

export function RemoteProvider({
  children,
  playerActive,
  startPlayerSession,
  goHome,
}: {
  children: ReactNode;
  /** True while a player session exists, so the title can be handed off. */
  playerActive: boolean;
  startPlayerSession: (session: ActivePlayerSession) => void;
  goHome: () => void;
}) {
  const client = usePrimaryApiClient();
  const userId = useCurrentUserId();
  const [hostEnabled, setHostEnabledState] = useState(readHostEnabled);
  const [prompts, setPrompts] = useState<PairingRequest[]>([]);
  const startRef = useRef(startPlayerSession);
  startRef.current = startPlayerSession;
  const goHomeRef = useRef(goHome);
  goHomeRef.current = goHome;

  const setHostEnabled = useCallback((enabled: boolean) => {
    setHostEnabledState(enabled);
    try {
      window.localStorage.setItem(HOST_STORAGE_KEY, enabled ? "1" : "0");
    } catch {
      // Not persisted; applies for this session only.
    }
  }, []);

  const active = Boolean(userId) && (hostEnabled || playerActive);
  const capabilities = hostEnabled
    ? [...WEB_TARGET_CAPABILITIES]
    : [...WEB_HANDOFF_ONLY_CAPABILITIES];
  const capabilityKey = capabilities.join(",");

  useEffect(() => {
    if (!active) return;
    const waitForPlayer = (offer: HandoffOffer): Promise<HandoffResult> =>
      new Promise((resolve) => {
        const received = Date.now();
        const deadline = received + HANDOFF_START_TIMEOUT_MS;
        let compensated = offer.paused;
        const check = () => {
          const player = getRemotePlayer();
          if (player && player.mediaFileId === offer.mediaFileId && player.hasStarted()) {
            if (!compensated) {
              // The source kept playing while this device prepared; catch up once so the
              // acknowledged position is where the source would be now.
              const behindMs = Date.now() - received;
              compensated = true;
              if (behindMs > CATCH_UP_THRESHOLD_MS) {
                player.seekToMs(offer.positionMs + behindMs);
                window.setTimeout(check, 500);
                return;
              }
            }
            if (offer.paused) player.pause();
            else player.play();
            // Give the engine a beat so the acknowledged position is the started one.
            window.setTimeout(
              () => resolve({ status: "playing", positionMs: player.snapshot().positionMs }),
              300
            );
            return;
          }
          if (Date.now() > deadline) {
            resolve({ status: "failed", reason: "playback did not start in time" });
            return;
          }
          window.setTimeout(check, 250);
        };
        check();
      });

    const host = new RemoteTargetHost(
      client,
      {
        onPairingRequest: (request) =>
          setPrompts((current) =>
            current.some((p) => p.pairingId === request.pairingId) ? current : [...current, request]
          ),
        onPairingRevoked: (pairingId) =>
          setPrompts((current) => current.filter((p) => p.pairingId !== pairingId)),
        execute: (kind, args) => {
          switch (kind) {
            case "navigate":
              return executeNavigate(args, () => goHomeRef.current());
            case "text":
              return executeText(args);
            case "playback":
              return executePlaybackCommand(getRemotePlayer(), args);
            default:
              return { status: "unsupported", detail: "capability not available" };
          }
        },
        onHandoffOffer: (offer) => {
          startRef.current({
            mediaFileId: offer.mediaFileId,
            locationState: { startPositionSeconds: offer.positionMs / 1000 },
          });
          return waitForPlayer(offer);
        },
        onHandoffStop: () => getRemotePlayer()?.stop(),
        currentState: () => {
          const player = getRemotePlayer();
          if (!player || !player.isReady()) return null;
          const snap = player.snapshot();
          return {
            media_file_id: player.mediaFileId,
            position_ms: snap.positionMs,
            duration_ms: snap.durationMs,
            paused: snap.paused,
          };
        },
      },
      {
        name: defaultDeviceName(PLAYARR_CLIENT_PLATFORM, IS_TV),
        platform: PLAYARR_CLIENT_PLATFORM,
        capabilities,
      }
    );
    host.start();
    const unsubscribe = subscribeRemotePlayer(() => void host.reportState());
    return () => {
      unsubscribe();
      host.stop();
    };
    // `capabilityKey` stands in for the capabilities array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, capabilityKey, client]);

  const value = useMemo(() => ({ hostEnabled, setHostEnabled }), [hostEnabled, setHostEnabled]);
  const first = prompts[0];

  return (
    <RemoteContext.Provider value={value}>
      {children}
      {first ? (
        <RemotePairingPrompt
          request={first}
          onAllow={async () => {
            await client.approveRemotePairing(first.pairingId);
            setPrompts((current) => current.filter((p) => p.pairingId !== first.pairingId));
          }}
          onDeny={async () => {
            await client.denyRemotePairing(first.pairingId).catch(() => undefined);
            setPrompts((current) => current.filter((p) => p.pairingId !== first.pairingId));
          }}
        />
      ) : null}
    </RemoteContext.Provider>
  );
}
