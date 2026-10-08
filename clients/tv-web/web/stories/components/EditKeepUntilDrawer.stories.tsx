import type { Meta, StoryObj } from "@storybook/react-vite";
import { EditKeepUntilDrawer } from "../../src/components/EditKeepUntilDrawer";

function Edit({ type, busy }: { type: "forever" | "date" | "after-watched"; busy: boolean }) {
  const keepUntil =
    type === "forever"
      ? ({ type: "forever" } as const)
      : type === "date"
        ? ({ type: "date", date: "2026-12-01T00:00:00.000Z" } as const)
        : ({ type: "after-watched", amount: 2, unit: "weeks" } as const);
  return <EditKeepUntilDrawer key={type} title="Test Movie A" keepUntil={keepUntil} busy={busy} onClose={() => undefined} onConfirm={() => undefined} />;
}

const meta = {
  title: "Components/Edit keep-until drawer",
  component: Edit,
  tags: ["autodocs"],
  args: { type: "forever", busy: false },
  argTypes: { type: { control: "inline-radio", options: ["forever", "date", "after-watched"] }, busy: { control: "boolean" } },
} satisfies Meta<typeof Edit>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
