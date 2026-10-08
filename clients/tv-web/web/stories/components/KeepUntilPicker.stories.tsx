import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { KeepUntilPicker, type KeepUntilKind, type KeepUntilState } from "../../src/components/KeepUntilPicker";

function Picker({ kind, amount, unit }: { kind: KeepUntilKind; amount: number; unit: "days" | "weeks" }) {
  const [override, setOverride] = useState<KeepUntilState | null>(null);
  const state: KeepUntilState = override ?? { kind, date: "2026-12-01", amount, unit };
  return (
    <div className="sb-pad" style={{ maxWidth: 640 }}>
      <KeepUntilPicker state={{ ...state, kind: override?.kind ?? kind }} onChange={setOverride} />
    </div>
  );
}

const meta = {
  title: "Components/Keep-until picker",
  component: Picker,
  tags: ["autodocs"],
  args: { kind: "forever", amount: 30, unit: "days" },
  argTypes: {
    kind: { control: "inline-radio", options: ["forever", "date", "after-watched"] },
    amount: { control: { type: "number", min: 1, max: 365 } },
    unit: { control: "inline-radio", options: ["days", "weeks"] },
  },
} satisfies Meta<typeof Picker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
