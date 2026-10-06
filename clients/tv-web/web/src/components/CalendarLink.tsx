import { useCallback, useEffect, useState } from "react";
import { useApiClient } from "../lib/ApiClientProvider";
import {
  classifyCalendarLinkError,
  loadStoredCalendarLink,
  openCalendarLink,
  resetCalendarLink,
  storeCalendarLink,
  type CalendarLinkFailure,
} from "../lib/calendarLink";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { TranslationKey } from "../lib/i18n/translations";
import { QrCode } from "./QrCode";
import { Button } from "./ui";

const FAILURE_KEYS: Record<CalendarLinkFailure, TranslationKey> = {
  unreachable: "pages.calendar.link.errorUnreachable",
  unsupported: "pages.calendar.link.errorUnsupported",
  signin: "pages.calendar.link.errorSignin",
  other: "pages.calendar.link.errorOther",
};

/**
 * The viewer's personal calendar (iCal) link: one call shows the existing link
 * (or creates the first one), with Copy, QR and Google/Apple/Outlook
 * instructions. Only the secondary "Reset link", after a confirmation,
 * replaces it (`rotate`).
 */
export function CalendarLink() {
  const { t } = useLanguage();
  const client = useApiClient();
  const [url, setUrl] = useState<string | null>(() => loadStoredCalendarLink());
  const [needsReset, setNeedsReset] = useState(false);
  const [failure, setFailure] = useState<CalendarLinkFailure | null>(null);
  const [busy, setBusy] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const show = useCallback(
    (link: string) => {
      storeCalendarLink(link);
      setUrl(link);
      setNeedsReset(false);
      setConfirming(false);
      setCopyState("idle");
    },
    []
  );

  const open = useCallback(async () => {
    setBusy(true);
    setFailure(null);
    try {
      const state = await openCalendarLink(client, loadStoredCalendarLink());
      if (state.kind === "link") show(state.url);
      else setNeedsReset(true);
    } catch (error) {
      setFailure(classifyCalendarLinkError(error));
    } finally {
      setBusy(false);
    }
  }, [client, show]);

  const reset = useCallback(async () => {
    setBusy(true);
    setFailure(null);
    try {
      show(await resetCalendarLink(client));
    } catch (error) {
      setFailure(classifyCalendarLinkError(error));
    } finally {
      setBusy(false);
    }
  }, [client, show]);

  useEffect(() => {
    void open();
  }, [open]);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section className="calendar-link" aria-labelledby="calendar-link-title">
      <h2 id="calendar-link-title">{t("pages.calendar.subscription.title")}</h2>
      <p className="muted">{t("pages.calendar.subscription.description")}</p>

      {failure ? (
        <p className="error-text" role="alert">
          {t(FAILURE_KEYS[failure])}{" "}
          <Button variant="secondary" size="sm" onClick={() => void open()}>
            {t("pages.calendar.retry")}
          </Button>
        </p>
      ) : null}

      {busy && !url ? (
        <p className="muted" role="status">
          {t("pages.calendar.link.preparing")}
        </p>
      ) : null}

      {url ? (
        <div className="calendar-link-secret">
          <input
            type="text"
            readOnly
            className="calendar-subscription-url"
            value={url}
            aria-label={t("pages.calendar.subscription.urlLabel")}
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button variant="primary" onClick={() => void copy()}>
            {copyState === "copied" ? t("pages.calendar.subscription.copied") : t("pages.calendar.subscription.copy")}
          </Button>
          {copyState === "failed" ? (
            <p className="error-text" role="alert">
              {t("pages.calendar.subscription.copyFailed")}
            </p>
          ) : null}
          <QrCode value={url} size={168} label={t("pages.calendar.subscription.qrLabel")} />
        </div>
      ) : null}

      {needsReset && !url ? <p className="hint">{t("pages.calendar.link.otherDevice")}</p> : null}

      <h3 className="calendar-subscription-howto">{t("pages.calendar.subscription.instructionsTitle")}</h3>
      <ul className="calendar-subscription-instructions">
        <li>{t("pages.calendar.subscription.instructionGoogle")}</li>
        <li>{t("pages.calendar.subscription.instructionApple")}</li>
        <li>{t("pages.calendar.subscription.instructionOutlook")}</li>
      </ul>

      {confirming ? (
        <div className="calendar-subscription-confirm" role="alertdialog" aria-labelledby="calendar-reset-text">
          <p id="calendar-reset-text">{t("pages.calendar.subscription.confirmRegenerate")}</p>
          <div className="calendar-actions">
            <Button variant="primary" disabled={busy} autoFocus onClick={() => void reset()}>
              {t("pages.calendar.subscription.regenerate")}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
              {t("pages.calendar.subscription.cancel")}
            </Button>
          </div>
        </div>
      ) : url || needsReset ? (
        <div className="calendar-actions">
          <Button variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
            {t("pages.calendar.subscription.regenerate")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
