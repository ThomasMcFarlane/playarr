import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActionIconGlyph, type ActionIcon } from "../../src/components/shell";
import { Caption } from "../fixtures";

const ICONS: ActionIcon[] = ["filters", "bell", "add", "customise", "prev", "next", "back"];

function Gallery({ size }: { size: number }) {
  return (
    <div className="sb-pad sb-row">
      {ICONS.map((icon) => (
        <div key={icon} style={{ width: size, textAlign: "center" }}>
          <div style={{ width: size, height: size }}>
            <ActionIconGlyph icon={icon} />
          </div>
          <Caption>{icon}</Caption>
        </div>
      ))}
    </div>
  );
}

const meta = {
  title: "Components/Shell icons",
  component: Gallery,
  tags: ["autodocs"],
  args: { size: 48 },
  argTypes: { size: { control: { type: "range", min: 16, max: 128, step: 4 } } },
} satisfies Meta<typeof Gallery>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
