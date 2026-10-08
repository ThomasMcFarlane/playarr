import { isBackKey } from "../../lib/backKey";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RemoteTarget } from "@playarr-tv/api-client";
import { usePrimaryApiClient } from "../../lib/ApiClientProvider";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import { HandoffFailure, handOffPlayback, type HandoffProgress } from "../../lib/remote/handoff";
import { getRemotePlayer } from "../../lib/remote/playerBridge";
import { Button } from "../ui";

type Phase =
  | { kind: "choose" }
  | { kind: "busy"; target: RemoteTarget; progress: HandoffProgress }
  | { kind: "done"; target: RemoteTarget }
  | { kind: "error"; message: string };

/** "Play on another device": moves the current title to a paired device of this account. */
export function PlayOnDeviceDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const client = usePrimaryApiClient();
  const [targets, setTargets] = useState<RemoteTarget[] | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "choose" });
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // This device registers as a handoff-capable target a moment after
      // playback starts; retry briefly rather than failing the first open.
      for (let attempt = 0; attempt < 5 && !cancelled; attempt += 1) {
        try {
          const list = await client.listRemoteTargets();
          const me = list.find((target) => target.is_self);
          if (me || attempt === 4) {
            if (!cancelled) {
              setSelfId(me?.device_id ?? null);
              setTargets(list);
            }
            return;
          }
        } catch {
          if (attempt === 4 && !cancelled) setTargets([]);
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true });
  }, [targets]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isBackKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const start = useCallback(
    async (target: RemoteTarget) => {
      const player = getRemotePlayer();
      if (!player || !selfId) {
        setPhase({ kind: "error", message: t("remote.playOn.notReady") });
        return;
      }
      const snap = player.snapshot();
      setPhase({ kind: "busy", target, progress: { stage: "offering" } });
      try {
        await handOffPlayback(client, {
          sourceDeviceId: selfId,
          destinationDeviceId: target.device_id,
          mediaFileId: player.mediaFileId,
          snapshot: {
            position_ms: snap.positionMs,
            duration_ms: snap.durationMs,
            paused: snap.paused,
          },
          controllerName: t("remote.playOn.controllerName"),
          onProgress: (progress) => setPhase({ kind: "busy", target, progress }),
        });
        setPhase({ kind: "done", target });
      } catch (error) {
        const reason = error instanceof HandoffFailure ? error.message : t("remote.playOn.unknown");
        setPhase({ kind: "error", message: t("remote.playOn.failed", { reason }) });
      }
    },
    [client, selfId, t]
  );

  const candidates = (targets ?? []).filter(
    (target) => !target.is_self && target.online && target.capabilities.includes("handoff")
  );

  return (
    <div className="server-choice-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="server-choice-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="play-on-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="play-on-title">{t("remote.playOn.title")}</h2>
        {phase.kind === "choose" && (
          <>
            {targets === null ? <p className="muted">{t("remote.playOn.loading")}</p> : null}
            {targets !== null && candidates.length === 0 ? (
              <p className="muted">{t("remote.playOn.none")}</p>
            ) : null}
            <div className="server-choice-options">
              {candidates.map((target, index) => (
                <button
                  key={target.device_id}
                  ref={index === 0 ? firstRef : undefined}
                  type="button"
                  className="server-choice-option"
                  onClick={() => void start(target)}
                >
                  <strong>{target.name}</strong>
                  <span>{target.platform}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {phase.kind === "busy" && (
          <p className="muted" role="status">
            {phase.progress.stage === "pairing"
              ? t("remote.playOn.pairing", {
                  name: phase.target.name,
                  code: phase.progress.verificationCode ?? "",
                })
              : phase.progress.stage === "waiting"
                ? t("remote.playOn.waiting", { name: phase.target.name })
                : t("remote.playOn.offering", { name: phase.target.name })}
          </p>
        )}
        {phase.kind === "done" && (
          <p role="status">{t("remote.playOn.done", { name: phase.target.name })}</p>
        )}
        {phase.kind === "error" && (
          <p className="error-text" role="alert">
            {phase.message}
          </p>
        )}
        <Button type="button" onClick={onClose}>
          {t("remote.playOn.close")}
        </Button>
      </section>
    </div>
  );
}
