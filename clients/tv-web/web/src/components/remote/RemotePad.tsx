import { useCallback, useState } from "react";
import type { RemotePairing } from "@playarr-tv/api-client";
import { usePrimaryApiClient } from "../../lib/ApiClientProvider";
import { useLanguage } from "../../lib/i18n/LanguageProvider";

type Scope = "navigate" | "text" | "playback" | "input";

/** On-screen remote for one paired target: D-pad, text entry and transport controls. */
export function RemotePad({ pairing, targetName }: { pairing: RemotePairing; targetName: string }) {
  const { t } = useLanguage();
  const client = usePrimaryApiClient();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const has = (scope: Scope) => pairing.scopes.includes(scope);

  const send = useCallback(
    async (kind: Scope, payload: Record<string, unknown>) => {
      setError(null);
      try {
        const accepted = await client.sendRemoteCommand(pairing.id, { kind, payload });
        // Surface a failed execution (nothing focused, no text field) without blocking the pad.
        for (let attempt = 0; attempt < 6; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          const status = await client.getRemoteCommandStatus(accepted.command_id);
          if (status.status === "ok") return;
          if (["failed", "unsupported", "revoked", "expired"].includes(status.status)) {
            setError(status.detail ?? t("remote.pad.failed"));
            return;
          }
        }
      } catch (caught) {
        const code = (caught as { body?: { error?: string } }).body?.error;
        setError(code === "target_offline" ? t("remote.pad.offline") : t("remote.pad.failed"));
      }
    },
    [client, pairing.id, t]
  );

  const nav = (key: string, label: string) => (
    <button type="button" className="btn btn-secondary remote-pad-key" onClick={() => void send("navigate", { key })}>
      {label}
    </button>
  );
  const play = (action: string, label: string, extra: Record<string, unknown> = {}) => (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={() => void send("playback", { action, ...extra })}
    >
      {label}
    </button>
  );

  return (
    <section className="card settings-card settings-card-wide remote-pad" aria-label={t("remote.pad.title", { name: targetName })}>
      <h3>{t("remote.pad.title", { name: targetName })}</h3>
      {has("navigate") && (
        <div className="remote-pad-grid">
          <span />
          {nav("up", t("remote.pad.up"))}
          <span />
          {nav("left", t("remote.pad.left"))}
          {nav("select", t("remote.pad.select"))}
          {nav("right", t("remote.pad.right"))}
          {nav("back", t("remote.pad.back"))}
          {nav("down", t("remote.pad.down"))}
          {nav("home", t("remote.pad.home"))}
        </div>
      )}
      {has("playback") && (
        <div className="remote-pad-row">
          {play("seek_by", t("remote.pad.rewind"), { delta_ms: -10_000 })}
          {play("toggle", t("remote.pad.playPause"))}
          {play("seek_by", t("remote.pad.forward"), { delta_ms: 10_000 })}
          {play("stop", t("remote.pad.stop"))}
        </div>
      )}
      {has("text") && (
        <form
          className="remote-pad-row"
          onSubmit={(event) => {
            event.preventDefault();
            void send("text", { value: text, mode: "replace", submit: true }).then(() => setText(""));
          }}
        >
          <input
            className="input"
            value={text}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t("remote.pad.textPlaceholder")}
            onChange={(event) => {
              setText(event.target.value);
              // Mirror typing live so the TV field tracks the phone keyboard.
              void send("text", { value: event.target.value, mode: "replace" });
            }}
          />
          <button type="submit" className="btn">
            {t("remote.pad.enter")}
          </button>
        </form>
      )}
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
