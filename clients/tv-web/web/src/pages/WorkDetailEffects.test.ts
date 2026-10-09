import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./WorkDetail.tsx", import.meta.url), "utf8");

describe("WorkDetail effects (B22, B23)", () => {
  it("re-reads the resume plan only when this series' own progress moved", () => {
    expect(source).toContain("}, [client, resumeSeriesId, seriesProgressKey]);");
    expect(source).not.toMatch(/getResumePlan[\s\S]{0,700}\[client, resumeSeriesId, progressByMedia\]/);
  });

  it("does not drop the runtime lookup when the effect re-runs", () => {
    const start = source.indexOf(".getMediaMetadata(mediaFileId)");
    const end = source.indexOf("}, [client, runtimeByMedia, runtimeTarget]);");
    const block = source.slice(start, end);
    expect(block).not.toContain("cancelled");
    expect(block).toContain("setRuntimeByMedia");
  });
});
