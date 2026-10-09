import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusPill, type StatusPillTone } from "../../src/components/StatusPill";

function Pill({ tone, label }: { tone: StatusPillTone; label: string }) {
  return (
    <div className="sb-pad">
      <StatusPill tone={tone}>{label}</StatusPill>
    </div>
  );
}

const meta = {
  title: "Components/Status pill",
  component: Pill,
  tags: ["autodocs"],
  args: { tone: "available", label: "Available" },
  argTypes: {
    tone: {
      control: "select",
      options: ["neutral", "available", "downloading", "upcoming", "missing", "requested"],
    },
    label: { control: "text" },
  },
} satisfies Meta<typeof Pill>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One interactive story: pick the state and the short text; switch the theme from the toolbar. */
export const Playground: Story = {};
