import type { CapabilityItem } from "@playarr-tv/api-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CapabilityAttentionBanner,
  CapabilityList,
  CapabilityRow,
} from "./ServerCapabilities";

const ffprobeMissing: CapabilityItem = {
  id: "ffprobe",
  name: "ffprobe",
  category: "binary",
  status: "missing",
  required: true,
  path: null,
  version: null,
  detail: "`ffprobe` was not found",
  impact: "Chapters and track discovery fail with a 500 error.",
  install_hint: "Install ffmpeg on the host.",
};

const ffmpegPresent: CapabilityItem = {
  ...ffprobeMissing,
  id: "ffmpeg",
  name: "ffmpeg",
  status: "present",
  path: "/usr/bin/ffmpeg",
  version: "6.1.1",
  detail: null,
};

const gpuOptional: CapabilityItem = {
  ...ffprobeMissing,
  id: "hardware.nvidia",
  name: "NVIDIA GPU devices",
  category: "hardware",
  required: false,
  impact: "NVENC is unavailable.",
  install_hint: "Install the NVIDIA toolkit.",
};

describe("ServerCapabilities components", () => {
  it("shows a prominent alert with impact for missing required items", () => {
    const html = renderToStaticMarkup(
      <CapabilityAttentionBanner items={[ffprobeMissing, ffmpegPresent, gpuOptional]} />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("1 required component needs attention");
    expect(html).toContain("Chapters and track discovery fail");
    expect(html).not.toContain("NVENC");
  });

  it("renders no banner when nothing required is missing", () => {
    expect(
      renderToStaticMarkup(<CapabilityAttentionBanner items={[ffmpegPresent, gpuOptional]} />)
    ).toBe("");
  });

  it("shows impact and install hint only for items that are not present", () => {
    const missing = renderToStaticMarkup(<CapabilityRow item={ffprobeMissing} />);
    expect(missing).toContain("Install ffmpeg on the host.");
    expect(missing).toContain("Required");
    const present = renderToStaticMarkup(<CapabilityRow item={ffmpegPresent} />);
    expect(present).toContain("/usr/bin/ffmpeg");
    expect(present).toContain("version 6.1.1");
    expect(present).not.toContain("How to fix");
  });

  it("groups by category, puts problems first and honours the filter", () => {
    const all = renderToStaticMarkup(
      <CapabilityList items={[ffmpegPresent, ffprobeMissing, gpuOptional]} filter="all" />
    );
    expect(all.indexOf("ffprobe")).toBeLessThan(all.indexOf("/usr/bin/ffmpeg"));
    expect(all).toContain("Hardware acceleration");

    const attention = renderToStaticMarkup(
      <CapabilityList items={[ffmpegPresent, ffprobeMissing]} filter="attention" />
    );
    expect(attention).toContain('data-capability="ffprobe"');
    expect(attention).not.toContain('data-capability="ffmpeg"');

    expect(
      renderToStaticMarkup(<CapabilityList items={[ffprobeMissing]} filter="present" />)
    ).toContain("Nothing matches this filter.");
  });
});
