import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QualityMatrix } from "../../src/components/QualityMatrix";
import { QUALITY_TIERS } from "../../src/lib/qualityMatrix";

const CHOICES = [
  { id: "original", label: "Original", detail: "Direct play" },
  { id: "auto", label: "Auto", detail: "Adapts to the connection" },
];
const ALL_IDS = QUALITY_TIERS.flatMap((tier) => tier.options.map((option) => option.id));

type Args = { variant: "player" | "settings"; disabled: boolean; limited: boolean; selectedId: string };

function Matrix({ variant, disabled, limited, selectedId }: Args) {
  const [selected, setSelected] = useState(selectedId);
  const available = limited ? new Set(["original", "auto", ...ALL_IDS.slice(0, 4)]) : undefined;
  return (
    <div className="sb-pad" style={{ maxWidth: 900 }}>
      <QualityMatrix
        variant={variant}
        role={variant === "player" ? "menuitemradio" : "radio"}
        disabled={disabled}
        availableIds={available}
        selectedId={selected}
        onSelect={setSelected}
        standaloneChoices={CHOICES}
      />
    </div>
  );
}

const meta = {
  title: "Components/Quality matrix",
  component: Matrix,
  tags: ["autodocs"],
  args: { variant: "settings", disabled: false, limited: false, selectedId: "original" },
  argTypes: {
    variant: { control: "inline-radio", options: ["player", "settings"] },
    disabled: { control: "boolean" },
    limited: { control: "boolean", description: "Only some qualities are available" },
    selectedId: { control: "select", options: ["original", "auto", ...ALL_IDS] },
  },
} satisfies Meta<typeof Matrix>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
