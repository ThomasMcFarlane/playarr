import { useCallback, useEffect, useState } from "react";
import type { CalendarFeedCreated, CalendarFeedStatus } from "@playarr-tv/api-client";
import { describeApiError } from "@playarr-tv/api-client";
import { QrCode } from "./QrCode";
import { useApiClient } from "../lib/ApiClientProvider";
import { useLanguage } from "../lib/i18n/LanguageProvider";

type Confirming = "regenerate" | "revoke" | null;

function formatInstant(value: string | null | undefined, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/**
 * Management of the external iCal subscription. The URL (and token) is only
 * ever returned by the create/regenerate call, so it is held in component
 * state, shown once with a copy action and a warning, and discarded when the
 * component unmounts.
 */
export function CalendarSubscription({ localeTag }: { localeTag: string }) {
  const { t } = useLanguage();
  const client = useApiClient();
  const [status, setStatus] = useState<CalendarFeedStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [created, setCreated] = useState<CalendarFeedCreated | null>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const load = useCallback(() => {
    let cancelled = false;
    setLoadError(null);
    client
      .getCalendarFeed()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(describeApiError(error));
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => load(), [load]);

  async function create() {
    setBusy(true);
    setActionError(null);
    setCopyState("idle");
    try {
      const next = await client.createCalendarFeed();
      setCreated(next);
      setStatus({ active: true, created_at: next.created_at, last_used_at: null });
      setConfirming(null);
    } catch (error) {
      setActionError(describeApiError(error));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setActionError(null);
    try {
      await client.revokeCalendarFeed();
      setCreated(null);
      setStatus({ active: false, created_at: null, last_used_at: null });
      setConfirming(null);
    } catch (error) {
      setActionError(describeApiError(error));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  const createdAt = formatInstant(status?.created_at, localeTag);
  const lastUsed = formatInstant(status?.last_used_at, localeTag);

  return (
    <section className="calendar-subscription" aria-labelledby="calendar-subscription-title">
      <h2 id="calendar-subscription-title">{t("pages.calendar.subscription.title")}</h2>
      <p className="muted">{t("pages.calendar.subscription.description")}</p>
      <h3 className="calendar-subscription-howto">{t("pages.calendar.subscription.instructionsTitle")}</h3>
      <ul className="calendar-subscription-instructions">
        <li>{t("pages.calendar.subscription.instructionGoogle")}</li>
        <li>{t("pages.calendar.subscription.instructionApple")}</li>
        <li>{t("pages.calendar.subscription.instructionOutlook")}</li>
      </ul>

      {loadError ? (
        <p className="error-text" role="alert">
          {t("pages.calendar.subscription.loadError", { reason: loadError })}{" "}
          <button type="button" className="btn btn-secondary" onClick={() => load()}>
            {t("pages.calendar.retry")}
          </button>
        </p>
      ) : status === null ? (
        <p className="muted" role="status">
          {t("pages.calendar.subscription.loading")}
        </p>
      ) : (
        <>
          <p className="calendar-subscription-status" role="status">
            <strong>
              {status.active
                ? t("pages.calendar.subscription.statusActive")
                : t("pages.calendar.subscription.statusInactive")}
            </strong>
            {status.active && createdAt ? (
              <span> · {t("pages.calendar.subscription.createdAt", { date: createdAt })}</span>
            ) : null}
            {status.active ? (
              <span>
                {" · "}
                {lastUsed
                  ? t("pages.calendar.subscription.lastUsed", { date: lastUsed })
                  : t("pages.calendar.subscription.neverUsed")}
              </span>
            ) : null}
          </p>

          {created ? (
            <div className="calendar-subscription-secret">
              <p className="calendar-subscription-warning" role="alert">
                {t("pages.calendar.subscription.shownOnce")}
              </p>
              <input
                type="text"
                readOnly
                className="calendar-subscription-url"
                value={created.url}
                aria-label={t("pages.calendar.subscription.urlLabel")}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button type="button" className="btn btn-primary" onClick={() => void copy()}>
                {copyState === "copied"
                  ? t("pages.calendar.subscription.copied")
                  : t("pages.calendar.subscription.copy")}
              </button>
              <QrCode value={created.url} size={168} label={t("pages.calendar.subscription.qrLabel")} />
              {copyState === "failed" ? (
                <p className="error-text" role="alert">
                  {t("pages.calendar.subscription.copyFailed")}
                </p>
              ) : null}
            </div>
          ) : null}

          {confirming ? (
            <div className="calendar-subscription-confirm" role="alertdialog" aria-labelledby="calendar-confirm-text">
              <p id="calendar-confirm-text">
                {confirming === "regenerate"
                  ? t("pages.calendar.subscription.confirmRegenerate")
                  : t("pages.calendar.subscription.confirmRevoke")}
              </p>
              <div className="calendar-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  autoFocus
                  onClick={() => void (confirming === "regenerate" ? create() : revoke())}
                >
                  {confirming === "regenerate"
                    ? t("pages.calendar.subscription.regenerate")
                    : t("pages.calendar.subscription.revoke")}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => setConfirming(null)}
                >
                  {t("pages.calendar.subscription.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <div className="calendar-actions">
              {status.active ? (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => setConfirming("regenerate")}
                  >
                    {t("pages.calendar.subscription.regenerate")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => setConfirming("revoke")}
                  >
                    {t("pages.calendar.subscription.revoke")}
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void create()}>
                  {busy ? t("pages.calendar.subscription.working") : t("pages.calendar.subscription.create")}
                </button>
              )}
            </div>
          )}
          {status.active && !created && !confirming ? (
            <p className="hint">{t("pages.calendar.subscription.urlHidden")}</p>
          ) : null}
          {actionError ? (
            <p className="error-text" role="alert">
              {t("pages.calendar.subscription.actionError", { reason: actionError })}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
