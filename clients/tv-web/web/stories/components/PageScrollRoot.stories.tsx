import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageScrollRoot } from "../../src/components/PageScrollRoot";

function Root({ rows, routeMotion }: { rows: number; routeMotion: string }) {
  return (
    <div style={{ height: "28rem", display: "grid" }}>
      <PageScrollRoot scrollKey="sb:page-scroll-root" routeMotion={routeMotion || undefined}>
        {Array.from({ length: rows }, (_, i) => (
          <p key={i} style={{ margin: "0 2rem 1rem" }}>
            {i === 0 ? <a href="#sb-page-scroll-root">Fixture row 1</a> : `Fixture row ${i + 1}`}
          </p>
        ))}
      </PageScrollRoot>
    </div>
  );
}

const meta = {
  title: "Components/Page scroll root",
  component: Root,
  tags: ["autodocs"],
  args: { rows: 40, routeMotion: "" },
  argTypes: { rows: { control: { type: "number", min: 0, max: 200 }, description: "Zero is the empty page" }, routeMotion: { control: "select", options: ["", "forward-a", "back-a"] } },
} satisfies Meta<typeof Root>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
