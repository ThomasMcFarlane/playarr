import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActionPill, type ActionIcon } from "../src/components/shell";
import { Caption, focusOn, hoverOn } from "./fixtures";

const TILES: Array<{ icon: ActionIcon; label: string; count?: number }> = [
  { icon: "filters", label: "Filters", count: 2 },
  { icon: "add", label: "Create" },
  { icon: "bell", label: "Calendar link" },
];

function Pills({ active }: { active?: boolean }) {
  return (
    <div className="sb-pad sb-col">
      <div>
        <Caption>Tile shape (header action, 30 September look)</Caption>
        <div className="sb-row">
          {TILES.map((tile) => (
            <ActionPill key={tile.label} icon={tile.icon} label={tile.label} count={tile.count} active={active} onClick={() => undefined} />
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

const meta = { title: "Components/Action pill", component: Pills, tags: ["autodocs"] } satisfies Meta<typeof Pills>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Focus: Story = { parameters: focusOn(".action-pill, .action-pill-icon") };
export const Hover: Story = { parameters: hoverOn(".action-pill, .action-pill-icon") };
export const Open: Story = { args: { active: true } };
