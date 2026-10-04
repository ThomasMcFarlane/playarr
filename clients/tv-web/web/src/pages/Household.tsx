import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  describeApiError,
  type HouseholdApproval,
  type HouseholdStatus,
} from "@playarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useLiveSubscription } from "../lib/liveEvents";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";

function kindLabelKey(kind: HouseholdApproval["kind"]) {
  switch (kind) {
    case "purchase":
      return "household.kind.purchase" as const;
    case "install":
      return "household.kind.install" as const;
    case "content":
      return "household.kind.content" as const;
    default:
      return "household.kind.time" as const;
  }
}

function statusLabelKey(status: HouseholdApproval["status"]) {
  switch (status) {
    case "approved":
      return "household.status.approved" as const;
    case "denied":
      return "household.status.denied" as const;
    default:
      return "household.status.pending" as const;
  }
}

/**
 * Household page: a guardian approves or denies requests from the profiles
 * they look after (with their own PIN), and every profile sees the state of
 * its own requests.
 */
export function HouseholdPage() {
  const { t } = useLanguage();
  useDocumentTitle(t("household.page.title"));
  const client = useApiClient();
  const [status, setStatus] = useState<HouseholdStatus | null>(null);
  const [approvals, setApprovals] = useState<HouseholdApproval[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [pin, setPin] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextStatus, nextApprovals, profiles] = await Promise.all([
        client.getHouseholdStatus(),
        client.listHouseholdApprovals(),
        client.listAvailableProfiles().catch(() => []),
      ]);
      setStatus(nextStatus);
      setApprovals(nextApprovals);
      setNames(Object.fromEntries(profiles.map((profile) => [profile.id, profile.display_name])));
      setError(null);
    } catch (err) {
      setError(describeApiError(err));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);
  const liveHousehold = useLiveSubscription({ areas: ["household", "account"] });
  useEffect(() => liveHousehold(() => void load()), [liveHousehold, load]);

  async function decide(approval: HouseholdApproval, approve: boolean) {
    if (approve && !/^\d{4}$/.test(pin)) {
      setError(t("household.page.pinRequired"));
      return;
    }
    setBusyId(approval.id);
    setError(null);
    try {
      await client.decideHouseholdApproval(approval.id, {
        approve,
        pin: approve ? pin : undefined,
      });
      setPin("");
      await load();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusyId(null);
    }
  }

  const guarded = new Set(status?.guardian_for ?? []);
  const toDecide = (approvals ?? []).filter(
    (item) => guarded.has(item.profile_user_id) && item.status === "pending"
  );
  const own = (approvals ?? []).filter((item) => !guarded.has(item.profile_user_id));

  return (
    <div className="page household-page">
      <h1>{t("household.page.title")}</h1>
      {error && <p className="household-blocked-error">{error}</p>}

      {status?.restricted && (
        <p className="household-page-summary">
          {status.state === "allowed" && status.remaining_seconds != null
            ? t("household.remaining", { minutes: String(Math.ceil(status.remaining_seconds / 60)) })
            : null}
        </p>
      )}

      {toDecide.length > 0 && (
        <section>
          <h2>{t("household.page.toApprove")}</h2>
          <label htmlFor="household-pin">{t("household.page.pinLabel")}</label>
          <input
            id="household-pin"
            className="household-pin-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
          />
          <ul className="household-list">
            {toDecide.map((item) => (
              <li key={item.id}>
                <span>
                  {names[item.profile_user_id] ?? t("household.page.unknownProfile")} {" - "}
                  {t(kindLabelKey(item.kind))}
                  {item.note ? ` (${item.note})` : ""}
                </span>
                <span className="household-list-actions">
                  <button disabled={busyId === item.id} onClick={() => void decide(item, true)}>
                    {t("household.page.approve")}
                  </button>
                  <button disabled={busyId === item.id} onClick={() => void decide(item, false)}>
                    {t("household.page.deny")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="household-page-hint">{t("household.page.needsPin")}</p>
        </section>
      )}

      <section>
        <h2>{t("household.page.requests")}</h2>
        {approvals !== null && own.length === 0 && <p>{t("household.page.noRequests")}</p>}
        <ul className="household-list">
          {own.map((item) => (
            <li key={item.id}>
              <span>{t(kindLabelKey(item.kind))}</span>
              <span>{t(statusLabelKey(item.status))}</span>
            </li>
          ))}
        </ul>
      </section>
      <Link to="/profiles">{t("household.page.back")}</Link>
    </div>
  );
}
