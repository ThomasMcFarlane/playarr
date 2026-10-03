import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import type { PairingRequest } from "../../lib/remote/targetHost";

/**
 * Explicit on-device approval for a phone-remote pairing. Pairing alone grants
 * nothing: the person at this screen must allow it, and compares the code.
 */
export function RemotePairingPrompt({
  request,
  onAllow,
  onDeny,
}: {
  request: PairingRequest;
  onAllow: () => Promise<void>;
  onDeny: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const allowRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    allowRef.current?.focus({ preventScroll: true });
  }, [request.pairingId]);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(t("remote.prompt.failed"));
      setBusy(false);
    }
  };

  return (
    <div className="server-choice-backdrop" role="presentation">
      <section
        className="server-choice-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="remote-prompt-title"
      >
        <p className="page-kicker">{t("remote.prompt.kicker")}</p>
        <h2 id="remote-prompt-title">
          {t("remote.prompt.title", { name: request.controllerName || t("remote.prompt.unnamed") })}
        </h2>
        <p className="remote-code" aria-label={t("remote.prompt.code", { code: request.verificationCode })}>
          {request.verificationCode}
        </p>
        <p className="muted">{t("remote.prompt.hint")}</p>
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
        <div className="server-choice-options">
          <button
            ref={allowRef}
            type="button"
            className="server-choice-option"
            disabled={busy}
            onClick={() => void run(onAllow)}
          >
            <strong>{t("remote.prompt.allow")}</strong>
          </button>
          <button
            type="button"
            className="server-choice-option"
            disabled={busy}
            onClick={() => void run(onDeny)}
          >
            <strong>{t("remote.prompt.deny")}</strong>
          </button>
        </div>
      </section>
    </div>
  );
}
