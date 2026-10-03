import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { HealthFact, HealthFinding } from "@playarr-tv/api-client";
import { LanguageProvider } from "../../lib/i18n/LanguageProvider";

vi.mock("../../lib/ApiClientProvider", () => ({ useApiClient: () => ({}) }));

import {
  HealthFactsList,
  HealthFindingsList,
  PlaybackHealthPanel,
} from "./PlaybackHealthPanel";

function wrap(node: React.ReactNode): string {
  return renderToStaticMarkup(<LanguageProvider>{node}</LanguageProvider>);
}

describe("PlaybackHealthPanel", () => {
  it("renders an accessible, scrollable dialog with a close control", () => {
    const markup = wrap(
      <PlaybackHealthPanel
        getSessionId={() => null}
        videoRef={{ current: null }}
        capabilities={{}}
        onClose={() => undefined}
      />
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("data-tv-scroll-container");
    expect(markup).toContain('data-tv-scroll-axis="y"');
    expect(markup).toContain('aria-label="Close playback health"');
  });

  it("lists findings by severity with the next action", () => {
    const findings: HealthFinding[] = [
      { code: "ok", severity: "ok", title: "Playing the original file", detail: "d1", next_action: null },
      {
        code: "buffering",
        severity: "problem",
        title: "Playback has been buffering",
        detail: "4 pauses",
        next_action: "Run the connection test",
      },
    ];
    const markup = wrap(<HealthFindingsList findings={findings} />);
    expect(markup.indexOf("Playback has been buffering")).toBeLessThan(
      markup.indexOf("Playing the original file")
    );
    expect(markup).toContain('data-severity="problem"');
    expect(markup).toContain("What to do:");
    expect(markup).toContain("Run the connection test");
  });

  it("labels each fact as measured, reported or not available and never hides unknowns", () => {
    const facts: HealthFact[] = [
      { key: "a", label: "Decoder", value: "hardware", provenance: "measured", source: "client" },
      { key: "b", label: "HDR formats the display reports", value: "hdr", provenance: "reported", source: "client" },
      { key: "c", label: "HDR output confirmed by the player", value: null, provenance: "unknown", source: null },
    ];
    const markup = wrap(<HealthFactsList facts={facts} />);
    expect(markup).toContain("measured");
    expect(markup).toContain("reported by device");
    expect(markup).toContain("not available");
    expect(markup).toContain("Unknown");
    expect(markup).toContain('data-provenance="unknown"');
  });
});
