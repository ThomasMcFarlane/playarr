import { useEffect, useState } from "react";
import { ApiError, type HttpRouteLatency } from "@playarr-tv/api-client";
import { usePrimaryApiClient } from "../../lib/ApiClientProvider";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import { EmptyState, ErrorState, SkeletonState } from "../../components/shell";
import { SettingsSectionLayout } from "./SettingsSectionLayout";

export type HttpLatencyState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string }
  | { status: "ready"; metrics: HttpRouteLatency[] };

function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}

/**
 * Loading/forbidden/error/table rendering, factored out of
 * `SettingsRequestLatencyPage` so it can be unit-tested against a fixed
 * `HttpLatencyState` without standing up an `<ApiClientProvider>` and a real
 * fetch round trip.
 */
export function RequestLatencyContent({ state, onRetry }: { state: HttpLatencyState; onRetry?: () => void }) {
  const { t } = useLanguage();

  if (state.status === "loading") {
    return (
      <section className="card settings-card settings-card-wide">
        <SkeletonState kind="settings" compact label={t("settings.requestLatency.loading")} />
      </section>
    );
  }

  if (state.status === "forbidden") {
    return (
      <section className="card settings-card settings-card-wide">
        <EmptyState
          graphic="details"
          title={t("settings.requestLatency.forbiddenTitle")}
          description={t("settings.requestLatency.forbiddenDescription")}
        />
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="card settings-card settings-card-wide">
        {onRetry ? (
          <ErrorState
            graphic="details"
            title={t("settings.requestLatency.errorTitle")}
            description={state.message}
            onRetry={onRetry}
            retryLabel={t("components.states.retry")}
          />
        ) : (
          <ErrorState graphic="details" title={t("settings.requestLatency.errorTitle")} description={state.message} />
        )}
      </section>
    );
  }

  if (state.metrics.length === 0) {
    return (
      <section className="card settings-card settings-card-wide">
        <EmptyState
          graphic="details"
          title={t("settings.requestLatency.emptyTitle")}
          description={t("settings.requestLatency.emptyDescription")}
        />
      </section>
    );
  }

  return (
    <section className="card settings-card settings-card-wide">
      <div className="http-latency-table-wrap">
        <table
          className="http-latency-table"
          aria-label={t("settings.requestLatency.tableLabel")}
        >
          <thead>
            <tr>
              <th scope="col">{t("settings.requestLatency.columnMethod")}</th>
              <th scope="col">{t("settings.requestLatency.columnRoute")}</th>
              <th scope="col">{t("settings.requestLatency.columnCount")}</th>
              <th scope="col">{t("settings.requestLatency.columnAvg")}</th>
              <th scope="col">{t("settings.requestLatency.columnP50")}</th>
              <th scope="col">{t("settings.requestLatency.columnP95")}</th>
              <th scope="col">{t("settings.requestLatency.columnP99")}</th>
              <th scope="col">{t("settings.requestLatency.columnMax")}</th>
            </tr>
          </thead>
          <tbody>
            {state.metrics.map((row) => (
              <tr key={`${row.method} ${row.route}`}>
                <td>{row.method}</td>
                <td>{row.route}</td>
                <td>{row.sampleCount}</td>
                <td>{formatMs(row.avgMs)}</td>
                <td>{formatMs(row.p50Ms)}</td>
                <td>{formatMs(row.p95Ms)}</td>
                <td>{formatMs(row.p99Ms)}</td>
                <td>{formatMs(row.maxMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Admin-only HTTP request-latency diagnostics: per-route avg/p50/p95/p99/max
 * and sample count, from `GET /api/v1/admin/metrics/http-latency`. Rows
 * arrive already sorted by `p95Ms` descending -- this page never re-sorts
 * them.
 *
 * `AdminUser`-gated server-side, same as `sync_status_handler` in
 * `admin.rs` -- 401 unauthenticated, 403 non-admin. This page always
 * appears in the settings nav (consistent with every other settings entry)
 * and, like `SettingsInvitePage`'s `resolveFriendInviteAddressBundle`, a
 * 403 here just means "not an admin," not a real failure: it renders the
 * "Admins only" empty state below instead of a table, rather than gating
 * the nav entry on a separate pre-flight admin check.
 */
export function SettingsRequestLatencyPage() {
  const { t } = useLanguage();
  useDocumentTitle(t("settings.requestLatency.documentTitle"));
  const client = usePrimaryApiClient();
  const [state, setState] = useState<HttpLatencyState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void client
      .getHttpLatencyMetrics()
      .then((metrics) => {
        if (!cancelled) setState({ status: "ready", metrics });
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) {
          setState({ status: "forbidden" });
        } else {
          setState({
            status: "error",
            message: error instanceof ApiError ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, attempt]);

  return (
    <SettingsSectionLayout>
      <RequestLatencyContent state={state} onRetry={() => setAttempt((value) => value + 1)} />
    </SettingsSectionLayout>
  );
}
