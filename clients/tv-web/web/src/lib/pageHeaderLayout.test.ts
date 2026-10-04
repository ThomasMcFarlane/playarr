import { describe, expect, it } from "vitest";
import { detailFitsInline } from "./pageHeaderLayout";

// Geometry sampled from the real layout: header starts after the nav rail, the clock sits at the stage divider.
const downloads = { backWidth: 50, titleWidth: 190, detailWidth: 330, gap: 24 };

describe("detailFitsInline", () => {
  it("wraps the Downloads storage subtitle at 1920 where it would run under the clock", () => {
    expect(detailFitsInline({ ...downloads, headerLeft: 154, obstacles: [560, 1631] })).toBe(false);
  });

  it("wraps at 1280 where the clock sits further left", () => {
    expect(detailFitsInline({ ...downloads, headerLeft: 102, obstacles: [373, 1090] })).toBe(false);
  });

  it("keeps a short detail inline when it ends before the clock", () => {
    expect(
      detailFitsInline({ backWidth: 50, titleWidth: 104, detailWidth: 110, gap: 24, headerLeft: 154, obstacles: [560] })
    ).toBe(true);
  });

  it("keeps detail inline when nothing is in the way (phones hide the clock)", () => {
    expect(detailFitsInline({ ...downloads, headerLeft: 16, obstacles: [] })).toBe(true);
  });

  it("wraps when the detail would run under the header actions at 390", () => {
    expect(
      detailFitsInline({ backWidth: 44, titleWidth: 160, detailWidth: 200, gap: 10, headerLeft: 16, obstacles: [250] })
    ).toBe(false);
  });
});
