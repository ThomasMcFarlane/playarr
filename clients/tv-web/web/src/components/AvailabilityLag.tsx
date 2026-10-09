import type { AvailabilityLag } from "@playarr-tv/api-client";
import { useAsyncData } from "@playarr-tv/api-client/react";
import { useApiClient } from "../lib/ApiClientProvider";
import { formatHumanDuration } from "../lib/calendar";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import { localeTagFor } from "../lib/i18n/languages";

type TFunction = ReturnType<typeof useLanguage>["t"];

/** The lines shown for a lag statistic; separated from the fetch so they can be tested. */
export function availabilityLagLines(
  lag: AvailabilityLag,
  t: TFunction,
  locale: string
): { primary: string; secondary: string | null } {
  const primary =
    lag.average_seconds === null
      ? t("pages.workDetail.availabilityLagNoData")
      : t("pages.workDetail.availabilityLag", {
          duration: formatHumanDuration(lag.average_seconds, locale),
        });
  const parts: string[] = [];
  if (lag.average_seconds !== null) {
    parts.push(t("pages.workDetail.availabilityLagSamples", { count: lag.sample_count }));
  }
  if (lag.backfill_count > 0) {
    parts.push(
      t("pages.workDetail.availabilityLagBackfill", {
        count: lag.backfill_count,
        days: lag.backfill_threshold_days,
      })
    );
  }
  if (lag.unknown_count > 0) {
    parts.push(t("pages.workDetail.availabilityLagUnknown", { count: lag.unknown_count }));
  }
  return { primary, secondary: parts.length > 0 ? parts.join(" · ") : null };
}

/** "Usually available about X after release" for a series; renders nothing on error or while loading. */
export function AvailabilityLagNote({ workId }: { workId: string }) {
  const client = useApiClient();
  const { t, language } = useLanguage();
  const state = useAsyncData(() => client.getAvailabilityLag(workId), [client, workId]);
  if (state.status !== "ready") return null;
  const lines = availabilityLagLines(state.data, t, localeTagFor(language));
  return (
    <p className="availability-lag" data-testid="availability-lag">
      <span className="availability-lag-primary">{lines.primary}</span>
      {lines.secondary ? <span className="availability-lag-secondary">{lines.secondary}</span> : null}
    </p>
  );
}
