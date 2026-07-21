import { describe, expect, it } from "vitest";
import {
  QUALITY_LEVELS,
  QUALITY_TIERS,
  qualityDefinitionForId,
  qualityTierForId,
} from "./qualityMatrix";

describe("quality matrix", () => {
  it("provides low, medium and high bitrates for every resolution tier", () => {
    expect(QUALITY_TIERS.map((tier) => tier.id)).toEqual(["uhd", "fhd", "hd", "sd"]);

    for (const tier of QUALITY_TIERS) {
      expect(tier.options.map((option) => option.level)).toEqual(QUALITY_LEVELS);
      expect(tier.options.map((option) => option.bitrateMbps)).toEqual(
        [...tier.options]
          .map((option) => option.bitrateMbps)
          .sort((left, right) => left - right)
      );
    }
  });

  it("retains existing profile ids as each tier's medium choice", () => {
    expect(qualityDefinitionForId("h264-1080p-8mbps")?.level).toBe("medium");
    expect(qualityDefinitionForId("h264-720p-4mbps")?.level).toBe("medium");
    expect(qualityDefinitionForId("h264-480p-2mbps")?.level).toBe("medium");
    expect(qualityTierForId("h264-2160p-35mbps")?.id).toBe("uhd");
  });
});
