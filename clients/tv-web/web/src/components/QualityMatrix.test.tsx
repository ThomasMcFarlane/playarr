import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LanguageProvider } from "../lib/i18n/LanguageProvider";
import { QualityMatrix } from "./QualityMatrix";

describe("QualityMatrix", () => {
  it("renders three bitrate columns for every resolution tier", () => {
    const markup = renderToStaticMarkup(
      <LanguageProvider>
        <QualityMatrix
          variant="settings"
          role="radio"
          selectedId="h264-1080p-8mbps"
          standaloneChoices={[
            { id: "original", label: "Original", detail: "Best available source" },
          ]}
          onSelect={() => undefined}
        />
      </LanguageProvider>
    );

    expect(markup).toContain(">Low</strong>");
    expect(markup).toContain(">Medium</strong>");
    expect(markup).toContain(">High</strong>");
    expect(markup).toContain(">UHD</strong><small>2160p</small>");
    expect(markup).toContain(">FHD</strong><small>1080p</small>");
    expect(markup).toContain(">HD</strong><small>720p</small>");
    expect(markup).toContain(">SD</strong><small>480p</small>");
    expect(markup.match(/role="radio"/g)).toHaveLength(13);
    expect(markup).toContain('data-quality-id="h264-1080p-8mbps"');
    expect(markup).toContain('aria-checked="true"');
  });
});
