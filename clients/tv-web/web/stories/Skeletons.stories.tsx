import type { Meta, StoryObj } from "@storybook/react-vite";
import { SkeletonBlock, SkeletonLines } from "../src/components/shell";
import { Caption } from "./fixtures";

function Skeletons({ lines }: { lines: number }) {
  return (
    <div className="sb-pad sb-col" style={{ maxWidth: 720 }} aria-busy="true">
      <div>
        <Caption>Block</Caption>
        <SkeletonBlock width="16rem" height="9rem" />
      </div>
      <div>
        <Caption>Text lines</Caption>
        <SkeletonLines count={lines} />
      </div>
      <div>
        <Caption>Header</Caption>
        <div className="sb-row">
          <SkeletonBlock width="3rem" height="3rem" style={{ borderRadius: "50%" }} />
          <SkeletonBlock width="12rem" height="2rem" />
        </div>
      </div>
    </div>
  );
}

const meta = { title: "Components/Skeleton", component: Skeletons, tags: ["autodocs"], args: { lines: 4 }, argTypes: { lines: { control: { type: "number", min: 1, max: 12 } } } } satisfies Meta<typeof Skeletons>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
