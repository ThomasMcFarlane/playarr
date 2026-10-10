import { SegmentedControl } from "./ui";
import type { DownloadKeepUntilPolicy } from "../lib/downloadsDb";
import { useLanguage } from "../lib/i18n/LanguageProvider";

export type KeepUntilKind = DownloadKeepUntilPolicy["type"];

export interface KeepUntilState {
  kind: KeepUntilKind;
  date: string;
  amount: number;
  unit: "days" | "weeks";
}

export function defaultKeepUntilDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

export function keepUntilStateFromPolicy(policy: DownloadKeepUntilPolicy): KeepUntilState {
  if (policy.type === "date") {
    return { kind: "date", date: policy.date.slice(0, 10), amount: 30, unit: "days" };
  }
  if (policy.type === "after-watched") {
    return { kind: "after-watched", date: defaultKeepUntilDate(), amount: policy.amount, unit: policy.unit };
  }
  return { kind: "forever", date: defaultKeepUntilDate(), amount: 30, unit: "days" };
}

export function keepUntilPolicyFromState(state: KeepUntilState): DownloadKeepUntilPolicy {
  if (state.kind === "forever") return { type: "forever" };
  if (state.kind === "date") return { type: "date", date: new Date(state.date).toISOString() };
  return { type: "after-watched", amount: Math.max(1, Math.round(state.amount)), unit: state.unit };
}

/**
 * The Keep-until radio group + conditional date/after-watched sub-fields,
 * factored out of `DownloadQualityDrawer` so `EditKeepUntilDrawer` (editing
 * an existing download's retention policy) can reuse the exact same UI
 * without duplicating it.
 */
export function KeepUntilPicker({
  state,
  onChange,
}: {
  state: KeepUntilState;
  onChange: (next: KeepUntilState) => void;
}) {
  const { t } = useLanguage();

  return (
    <section>
      <h3>{t("components.downloadQualityDrawer.keepUntilHeading")}</h3>
      <SegmentedControl
        ariaLabel={t("components.downloadQualityDrawer.keepUntilHeading")}
        value={state.kind}
        options={[
          { value: "forever", label: t("components.downloadQualityDrawer.keepForever") },
          { value: "date", label: t("components.downloadQualityDrawer.keepUntilDate") },
          { value: "after-watched", label: t("components.downloadQualityDrawer.keepUntilAfterWatched") },
        ]}
        onChange={(kind) => onChange({ ...state, kind })}
      />

      {state.kind === "date" ? (
        <label className="download-quality-drawer-field">
          <span>{t("components.downloadQualityDrawer.dateLabel")}</span>
          <input
            type="date"
            value={state.date}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(event) => onChange({ ...state, date: event.target.value })}
          />
        </label>
      ) : null}

      {state.kind === "after-watched" ? (
        <div className="download-quality-drawer-field download-quality-drawer-after-watched">
          <label>
            <span>{t("components.downloadQualityDrawer.amountLabel")}</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={state.amount}
              onChange={(event) => onChange({ ...state, amount: Number(event.target.value) || 1 })}
            />
          </label>
          <SegmentedControl
            ariaLabel={t("components.downloadQualityDrawer.amountLabel")}
            value={state.unit}
            options={[
              { value: "days", label: t("components.downloadQualityDrawer.unitDays") },
              { value: "weeks", label: t("components.downloadQualityDrawer.unitWeeks") },
            ]}
            onChange={(unit) => onChange({ ...state, unit })}
          />
          <p className="download-quality-drawer-hint">
            {t("components.downloadQualityDrawer.afterWatchedHint")}
          </p>
        </div>
      ) : null}
    </section>
  );
}
