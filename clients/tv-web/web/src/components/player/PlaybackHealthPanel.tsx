import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  describeApiError,
  type ConnectionTestResult,
  type HealthFact,
  type HealthFinding,
  type PlaybackHealthReport,
} from "@playarr-tv/api-client";
import type { PlaybackCapabilities } from "@playarr-tv/api-client/react";
import { Button } from "../ui";
import { Drawer } from "../shell";
import { useApiClient } from "../../lib/ApiClientProvider";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import {
  buildClientReport,
  displayAdvertisesHdr,
  exportFileName,
  exportText,
  formatBitrate,
  provenanceLabelKey,
  sortFindings,
  startConnectionTest,
  summaryFacts,
  type ConnectionTestHandle,
} from "../../lib/playbackHealth";

export function HealthFindingsList({ findings }: { findings: HealthFinding[] }) {
  const { t } = useLanguage();
  return (
    <ul className="playback-health-findings">
      {sortFindings(findings).map((finding) => (
        <li key={finding.code} data-severity={finding.severity}>
          <strong>{finding.title}</strong>
          <span>{finding.detail}</span>
          {finding.next_action ? (
            <em>
              {t("components.playbackHealth.nextAction")} {finding.next_action}
            </em>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function HealthFactsList({ facts }: { facts: HealthFact[] }) {
  const { t } = useLanguage();
  return (
    <dl className="playback-health-facts">
      {facts.map((fact) => {
        const kind = provenanceLabelKey(fact);
        return (
          <div key={fact.key} data-provenance={kind}>
            <dt>{fact.label}</dt>
            <dd>
              {fact.value ?? t("components.playbackHealth.unknown")}
              <small>{t(`components.playbackHealth.provenance.${kind}`)}</small>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

type ReportState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; report: PlaybackHealthReport };

type TestState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: ConnectionTestResult }
  | { status: "cancelled" }
  | { status: "error"; message: string };

interface PlaybackHealthPanelProps {
  getSessionId: () => string | null;
  videoRef: RefObject<HTMLVideoElement>;
  capabilities: PlaybackCapabilities;
  onClose: () => void;
}

/**
 * "Playback health": explains in plain words how the current session is
 * delivered, what the device reports versus what was measured, runs a short
 * cancellable connection test, and exports redacted evidence on request.
 * Spec: docs/architecture/playback-health.md.
 */
export function PlaybackHealthPanel({
  getSessionId,
  videoRef,
  capabilities,
  onClose,
}: PlaybackHealthPanelProps) {
  const { t } = useLanguage();
  const client = useApiClient();
  const testRef = useRef<ConnectionTestHandle | null>(null);
  const throughputRef = useRef<number | undefined>(undefined);
  const [state, setState] = useState<ReportState>({ status: "loading" });
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [detail, setDetail] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const load = useCallback(() => {
    const sessionId = getSessionId();
    if (!sessionId) {
      setState({ status: "error", message: t("components.playbackHealth.noSession") });
      return () => undefined;
    }
    let cancelled = false;
    setState({ status: "loading" });
    client
      .getPlaybackHealth(
        sessionId,
        buildClientReport(capabilities, videoRef.current, {
          displayHdr: displayAdvertisesHdr(),
          throughputBps: throughputRef.current,
        })
      )
      .then((report) => {
        if (!cancelled) setState({ status: "ready", report });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", message: describeApiError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [capabilities, client, getSessionId, t, videoRef]);

  useEffect(() => load(), [load]);

  useEffect(() => () => testRef.current?.cancel(), []);

  const runTest = useCallback(() => {
    testRef.current?.cancel();
    const handle = startConnectionTest(client);
    testRef.current = handle;
    setTest({ status: "running" });
    void handle.done
      .then((result) => {
        if (testRef.current !== handle) return;
        if (result === "cancelled") {
          setTest({ status: "cancelled" });
          return;
        }
        throughputRef.current = result.throughputBps;
        setTest({ status: "done", result });
        load();
      })
      .catch((error: unknown) => {
        if (testRef.current !== handle) return;
        setTest({
          status: "error",
          message: error instanceof Error ? error.message : describeApiError(error),
        });
      });
  }, [client, load]);

  const cancelTest = useCallback(() => testRef.current?.cancel(), []);

  const copyExport = useCallback(
    async (report: PlaybackHealthReport) => {
      try {
        await navigator.clipboard.writeText(exportText(report));
        setExportNote(t("components.playbackHealth.copied"));
      } catch {
        setExportNote(t("components.playbackHealth.copyFailed"));
      }
    },
    [t]
  );

  const saveExport = useCallback(
    (report: PlaybackHealthReport) => {
      const url = URL.createObjectURL(
        new Blob([exportText(report)], { type: "application/json" })
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = exportFileName();
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportNote(t("components.playbackHealth.saved"));
    },
    [t]
  );

  const report = state.status === "ready" ? state.report : null;
  const facts = report ? (detail ? report.facts : summaryFacts(report.facts)) : [];

  return (
    <Drawer
      className="playback-health-panel"
      kicker={t("components.playbackHealth.kicker")}
      title={report?.headline ?? t("components.playbackHealth.title")}
      ariaLabel={t("components.playbackHealth.title")}
      closeLabel={t("components.playbackHealth.close")}
      onClose={onClose}
      containerProps={{
        "data-tv-scroll-container": "",
        "data-tv-scroll-axis": "y",
        "data-navigation-scroll-key": "player:playback-health",
        onClick: (event) => event.stopPropagation(),
      }}
    >
      {state.status === "loading" ? (
        <p role="status" className="playback-health-status">
          {t("components.playbackHealth.loading")}
        </p>
      ) : null}
      {state.status === "error" ? (
        <div role="alert" className="playback-health-status is-error">
          <p>{state.message}</p>
          <Button size="sm" onClick={load}>
            {t("components.playbackHealth.retry")}
          </Button>
        </div>
      ) : null}

      {report ? (
        <>
          <section aria-label={t("components.playbackHealth.findings")}>
            <HealthFindingsList findings={report.findings} />
          </section>

          <section>
            <Button
              size="sm"
              className="playback-health-toggle"
              aria-expanded={detail}
              onClick={() => setDetail((value) => !value)}
            >
              {detail
                ? t("components.playbackHealth.hideDetail")
                : t("components.playbackHealth.showDetail")}
            </Button>
            <HealthFactsList facts={facts} />
            {detail ? (
              <p className="playback-health-note">{report.qualification.note}</p>
            ) : null}
          </section>

          <section aria-label={t("components.playbackHealth.testHeading")}>
            <h3>{t("components.playbackHealth.testHeading")}</h3>
            <p className="playback-health-note">{t("components.playbackHealth.testHint")}</p>
            <div className="playback-health-actions">
              {test.status === "running" ? (
                <Button size="sm" onClick={cancelTest}>
                  {t("components.playbackHealth.testCancel")}
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={runTest}>
                  {t("components.playbackHealth.testRun")}
                </Button>
              )}
            </div>
            <p role="status" className="playback-health-note">
              {test.status === "running" ? t("components.playbackHealth.testRunning") : null}
              {test.status === "cancelled" ? t("components.playbackHealth.testCancelled") : null}
              {test.status === "error" ? test.message : null}
              {test.status === "done"
                ? t("components.playbackHealth.testResult", {
                    rate: formatBitrate(test.result.throughputBps),
                    latency: test.result.latencyMs,
                  })
                : null}
            </p>
          </section>

          <section aria-label={t("components.playbackHealth.exportHeading")}>
            <h3>{t("components.playbackHealth.exportHeading")}</h3>
            <p className="playback-health-note">{t("components.playbackHealth.exportHint")}</p>
            <div className="playback-health-actions">
              <Button size="sm" onClick={() => void copyExport(report)}>
                {t("components.playbackHealth.exportCopy")}
              </Button>
              <Button size="sm" onClick={() => saveExport(report)}>
                {t("components.playbackHealth.exportSave")}
              </Button>
            </div>
            {exportNote ? (
              <p role="status" className="playback-health-note">
                {exportNote}
              </p>
            ) : null}
            {detail ? (
              <pre className="playback-health-export" tabIndex={0}>
                {exportText(report)}
              </pre>
            ) : null}
          </section>
        </>
      ) : null}
    </Drawer>
  );
}
