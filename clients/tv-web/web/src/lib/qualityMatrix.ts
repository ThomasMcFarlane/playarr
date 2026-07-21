export const QUALITY_LEVELS = ["low", "medium", "high"] as const;

export type QualityLevel = (typeof QUALITY_LEVELS)[number];
export type QualityTierId = "sd" | "hd" | "fhd" | "uhd";

interface QualityMatrixOptionDefinition {
  id: string;
  level: QualityLevel;
  bitrateMbps: number;
}

interface QualityTierDefinition {
  id: QualityTierId;
  height: number;
  resolution: string;
  options: readonly QualityMatrixOptionDefinition[];
}

export const QUALITY_TIERS = [
  {
    id: "uhd",
    height: 2160,
    resolution: "2160p",
    options: [
      { id: "h264-2160p-12mbps", level: "low", bitrateMbps: 12 },
      { id: "h264-2160p-20mbps", level: "medium", bitrateMbps: 20 },
      { id: "h264-2160p-35mbps", level: "high", bitrateMbps: 35 },
    ],
  },
  {
    id: "fhd",
    height: 1080,
    resolution: "1080p",
    options: [
      { id: "h264-1080p-4mbps", level: "low", bitrateMbps: 4 },
      { id: "h264-1080p-8mbps", level: "medium", bitrateMbps: 8 },
      { id: "h264-1080p-12mbps", level: "high", bitrateMbps: 12 },
    ],
  },
  {
    id: "hd",
    height: 720,
    resolution: "720p",
    options: [
      { id: "h264-720p-2mbps", level: "low", bitrateMbps: 2 },
      { id: "h264-720p-4mbps", level: "medium", bitrateMbps: 4 },
      { id: "h264-720p-6mbps", level: "high", bitrateMbps: 6 },
    ],
  },
  {
    id: "sd",
    height: 480,
    resolution: "480p",
    options: [
      { id: "h264-480p-1mbps", level: "low", bitrateMbps: 1 },
      { id: "h264-480p-2mbps", level: "medium", bitrateMbps: 2 },
      { id: "h264-480p-3mbps", level: "high", bitrateMbps: 3 },
    ],
  },
] as const satisfies readonly QualityTierDefinition[];

export type MatrixQualityId =
  (typeof QUALITY_TIERS)[number]["options"][number]["id"];

export function qualityDefinitionForId(
  id: string
): QualityMatrixOptionDefinition | undefined {
  for (const tier of QUALITY_TIERS) {
    const option = tier.options.find((candidate) => candidate.id === id);
    if (option) return option;
  }
  return undefined;
}

export function qualityTierForId(
  id: string
): (typeof QUALITY_TIERS)[number] | undefined {
  return QUALITY_TIERS.find((tier) =>
    tier.options.some((option) => option.id === id)
  );
}
