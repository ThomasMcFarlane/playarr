import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActionPill, type ActionIcon } from "../src/components/shell";
import { Caption } from "./fixtures";

const TILES: Array<{ icon: ActionIcon; label: string; count?: number }> = [
  { icon: "filters", label: "Filters" },
  { icon: "add", label: "Create" },
  { icon: "bell", label: "Calendar link" },
];

function Pills({ active, count, label }: { active?: boolean; count?: number; label?: string }) {
  return (
    <div className="sb-pad sb-col">
      <div>
        <Caption>Tile shape (header action, 30 September look)</Caption>
        <div className="sb-row">
          {TILES.map((tile) => (
            <ActionPill key={tile.label} icon={tile.icon} label={tile.label === "Filters" ? (label ?? tile.label) : tile.label} count={tile.icon === "filters" ? count : undefined} active={active} onClick={() => undefined} />
          ))}
        </div>
      </div>
      <div>
        <Caption>Icon shape (Back, period arrows)</Caption>
        <div className="sb-row">
          <ActionPill shape="icon" icon="back" label="Back" onClick={() => undefined} />
          <ActionPill shape="icon" icon="prev" label="Previous" onClick={() => undefined} />
          <ActionPill shape="icon" icon="next" label="Next" onClick={() => undefined} />
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Components/Action pill",
  component: Pills,
  tags: ["autodocs"],
  args: { active: false, count: 2, label: "Filters" },
  argTypes: {
    active: { control: "boolean", description: "Open: a drawer is showing" },
    count: { control: { type: "number", min: 0, max: 99 }, description: "Badge count on Filters" },
    label: { control: "text" },
  },
} satisfies Meta<typeof Pills>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One interactive story: hover, focus-visible, active and focus-within come from the Pseudo states toolbar item. */
export const Playground: Story = {};
