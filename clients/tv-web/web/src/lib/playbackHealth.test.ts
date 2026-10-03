import { describe, expect, it, vi } from "vitest";
import type { HealthFact, HealthFinding, PlaybackHealthReport } from "@playarr-tv/api-client";
import {
  buildClientReport,
  exportFileName,
  exportText,
  formatBitrate,
  provenanceLabelKey,
  sortFindings,
  startConnectionTest,
  summaryFacts,
} from "./playbackHealth";

const caps = { containers: "mp4", videoCodecs: "h264, H265", audioCodecs: "aac,opus" };

describe("buildClientReport", () => {
  it("reports declared capabilities and only measures what the browser observed", () => {
    const report = buildClientReport(
      caps,
      { videoWidth: 3840, videoHeight: 2160, getVideoPlaybackQuality: () => ({ droppedVideoFrames: 7 }) },
      { displayHdr: true, throughputBps: 25_000_000.4 }
    );
    expect(report.reported?.video_codecs).toEqual(["h264", "h265"]);
    expect(report.reported?.display_hdr_formats).toEqual(["hdr"]);
    expect(report.measured).toEqual({
      width: 3840,
      height: 2160,
      dropped_frames: 7,
      throughput_bps: 25_000_000,
    });
  });

  it("never invents decoder, HDR output or passthrough measurements", () => {
    const report = buildClientReport(caps, null);
    expect(report.measured).toEqual({});
    expect(report.reported?.display_hdr_formats).toEqual([]);
  });

  it("omits zero-sized video and missing quality APIs", () => {
    const report = buildClientReport(caps, { videoWidth: 0, videoHeight: 0 });
    expect(report.measured).toEqual({});
  });
});

describe("presentation helpers", () => {
  const finding = (code: string, severity: HealthFinding["severity"]): HealthFinding => ({
    code,
    severity,
    title: code,
    detail: "",
    next_action: null,
  });

  it("orders problems before warnings before info before ok, stably", () => {
    const sorted = sortFindings([
      finding("a", "ok"),
      finding("b", "warning"),
      finding("c", "problem"),
      finding("d", "warning"),
      finding("e", "info"),
    ]);
    expect(sorted.map((f) => f.code)).toEqual(["c", "b", "d", "e", "a"]);
  });

  it("treats a missing value as unknown regardless of claimed provenance", () => {
    const fact = (value: string | null, provenance: HealthFact["provenance"]): HealthFact => ({
      key: "k",
      label: "k",
      value,
      provenance,
      source: null,
    });
    expect(provenanceLabelKey(fact(null, "reported"))).toBe("unknown");
    expect(provenanceLabelKey(fact("x", "reported"))).toBe("reported");
    expect(provenanceLabelKey(fact("x", "measured"))).toBe("measured");
  });

  it("keeps the simple view to the delivery facts", () => {
    const facts = ["play_method", "decoder_kind", "delivered_audio"].map((key) => ({
      key,
      label: key,
      value: "v",
      provenance: "measured" as const,
      source: null,
    }));
    expect(summaryFacts(facts).map((f) => f.key)).toEqual(["play_method", "delivered_audio"]);
  });

  it("formats bitrates and export names", () => {
    expect(formatBitrate(25_400_000)).toBe("25.4 Mbit/s");
    expect(formatBitrate(640_000)).toBe("640 kbit/s");
    expect(exportFileName(new Date("2026-10-03T10:00:00Z"))).toBe(
      "playarr-playback-health-2026-10-03.json"
    );
  });

  it("exports only the server-redacted export object", () => {
    const report = {
      headline: "h",
      export: { schema: "playarr.playback-health.v1", finding_codes: ["direct_play"] },
      facts: [{ key: "secret-ish", value: "should not be exported" }],
    } as unknown as PlaybackHealthReport;
    const text = exportText(report);
    expect(text).toContain("direct_play");
    expect(text).not.toContain("should not be exported");
  });
});

describe("startConnectionTest", () => {
  it("resolves with the measured result", async () => {
    const result = { bytes: 1, latencyMs: 5, throughputBps: 10 };
    const client = { runConnectionTest: vi.fn().mockResolvedValue(result) };
    const handle = startConnectionTest(client as never);
    await expect(handle.done).resolves.toEqual(result);
    expect(client.runConnectionTest.mock.calls[0]?.[0]?.bytes).toBe(1024 * 1024);
  });

  it("reports cancellation instead of an error", async () => {
    const client = {
      runConnectionTest: vi.fn(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(new DOMException("a", "AbortError")))
          )
      ),
    };
    const handle = startConnectionTest(client as never);
    handle.cancel();
    await expect(handle.done).resolves.toBe("cancelled");
  });

  it("aborts and reports a timeout when the transfer stalls", async () => {
    vi.useFakeTimers();
    try {
      const client = {
        runConnectionTest: vi.fn(
          ({ signal }: { signal: AbortSignal }) =>
            new Promise((_, reject) =>
              signal.addEventListener("abort", () => reject(new DOMException("a", "AbortError")))
            )
        ),
      };
      const handle = startConnectionTest(client as never);
      const assertion = expect(handle.done).rejects.toThrow(/took too long/);
      await vi.advanceTimersByTimeAsync(8001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
