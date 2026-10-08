import type { Meta, StoryObj } from "@storybook/react-vite";
import * as Icons from "../../src/components/player/PlayerIcons";
import { Caption } from "../fixtures";

type IconName = keyof typeof Icons;

function Gallery({ size, tone }: { size: number; tone: "ink" | "accent" | "muted" }) {
  const colour = tone === "ink" ? "var(--ink)" : tone === "accent" ? "var(--accent, #cf3157)" : "var(--ink-muted)";
  return (
    <div className="sb-pad sb-row" style={{ color: colour, alignItems: "flex-start" }}>
      {(Object.keys(Icons) as IconName[]).map((name) => {
        const Icon = Icons[name] as (props: { className?: string }) => JSX.Element;
        return (
          <div key={name} style={{ width: "7rem", textAlign: "center" }}>
            <span style={{ display: "inline-block", width: size, height: size }}>
              <Icon />
            </span>
            <Caption>{name}</Caption>
          </div>
        );
      })}
    </div>
  );
}

const meta = {
  title: "Components/Player icons",
  component: Gallery,
  tags: ["autodocs"],
  args: { size: 32, tone: "ink" },
  argTypes: { size: { control: { type: "range", min: 16, max: 96, step: 4 } }, tone: { control: "inline-radio", options: ["ink", "accent", "muted"] } },
} satisfies Meta<typeof Gallery>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
