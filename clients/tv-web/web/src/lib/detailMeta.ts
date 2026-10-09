import type { WorkDetail } from "@playarr-tv/api-client";
import type { TranslationKey } from "./i18n/translations";

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** A movie's runtime as "1h 42m" / "95 min" from its detail, or `null` while the detail has none. */
export function runtimeLabel(detail: WorkDetail | undefined, t: Translate): string | null {
  const ms = detail?.runtime_ms;
  if (!ms || ms <= 0) return null;
  const total = Math.max(1, Math.round(ms / 60_000));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours <= 0) return t("pages.workDetail.runtimeMinutes", { minutes });
  return minutes > 0
    ? t("pages.workDetail.runtimeHoursMinutes", { hours, minutes })
    : t("pages.workDetail.runtimeHours", { hours });
}
