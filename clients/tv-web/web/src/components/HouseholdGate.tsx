import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { describeApiError, type ApiClient, type HouseholdStatus } from "@playarr-tv/api-client";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import {
  approvalSubjectFor,
  householdBlockFromStatus,
  remainingMinutes,
} from "../lib/householdState";
import { TvEmptyState } from "./tv/TvEmptyState";

const POLL_MS = 30_000;

/**
 * The signed-in profile's household state, refreshed every 30 s, when the tab
 * becomes visible, and on demand. The server decides everything; this only
 * lets the app show "not right now" before a request fails. A failed fetch
 * keeps the last known state (the server still enforces regardless).
 */
export function useHouseholdStatus(
  client: ApiClient,
  enabled: boolean,
  refreshKey: string
): { status: HouseholdStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<HouseholdStatus | null>(null);

  const refresh = useCallback(() => {
    if (!enabled) return;
    client
      .getHouseholdStatus()
      .then(setStatus)
      .catch(() => undefined);
  }, [client, enabled]);

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      return;
    }
    refresh();
    const interval = window.setInterval(refresh, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, refresh]);

  // Route changes re-check promptly so a spent budget is noticed on the
  // next navigation rather than up to 30 s later.
  useEffect(refresh, [refresh, refreshKey]);

  return { status, refresh };
}

function formatUntil(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

/** Full-page state shown instead of the app while the profile is blocked. */
export function HouseholdBlockedScreen({
  client,
  status,
  onSwitchProfile,
}: {
  client: ApiClient;
  status: HouseholdStatus;
  onSwitchProfile: () => void;
}) {
  const { t } = useLanguage();
  const block = householdBlockFromStatus(status);
  const [requestState, setRequestState] = useState<
    { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  if (!block) return null;
  const until = formatUntil(block.until);
  const title =
    block.kind === "outside_schedule"
      ? t("household.blocked.scheduleTitle")
      : t("household.blocked.budgetTitle");
  const description =
    block.kind === "outside_schedule"
      ? until
        ? t("household.blocked.scheduleDescription", { time: until })
        : t("household.blocked.scheduleDescriptionNoTime")
      : until
        ? t("household.blocked.budgetDescription", { time: until })
        : t("household.blocked.budgetDescriptionNoTime");

  async function askGuardian() {
    if (!block) return;
    setRequestState({ kind: "sending" });
    try {
      await client.createHouseholdApproval({
        kind: "time",
        subject: approvalSubjectFor(block.kind),
      });
      setRequestState({ kind: "sent" });
    } catch (error) {
      setRequestState({ kind: "error", message: describeApiError(error) });
    }
  }

  return (
    <div className="page tv-state-page household-blocked" role="alert">
      <TvEmptyState graphic="details" variant="page" title={title} description={description} />
      <div className="household-blocked-actions">
        <button
          type="button"
          className="household-blocked-button"
          disabled={requestState.kind === "sending" || requestState.kind === "sent"}
          onClick={() => void askGuardian()}
        >
          {t("household.blocked.askGuardian")}
        </button>
        <button type="button" className="household-blocked-button" onClick={onSwitchProfile}>
          {t("household.blocked.switchProfile")}
        </button>
      </div>
      {requestState.kind === "sent" && (
        <p className="household-blocked-note">{t("household.blocked.requestSent")}</p>
      )}
      {requestState.kind === "error" && (
        <p className="household-blocked-note household-blocked-error">{requestState.message}</p>
      )}
    </div>
  );
}

/** "N min left" warning in the last hour of a budget or schedule window. */
export function HouseholdRemainingChip({
  status,
  now,
}: {
  status: HouseholdStatus | null;
  now: Date;
}) {
  const { t } = useLanguage();
  const minutes = remainingMinutes(status, now);
  if (minutes === null) return null;
  return (
    <Link
      to="/household"
      className="household-remaining-chip"
      aria-label={t("household.remaining", { minutes: String(minutes) })}
    >
      {t("household.remaining", { minutes: String(minutes) })}
    </Link>
  );
}
