import type { Meta, StoryObj } from "@storybook/react-vite";
import { FixtureRows, MODE_ARGTYPES, PageStage, type Mode } from "./pageKit";

function Watchlist({ mode, count }: { mode: Mode; count: number }) {
  return (
    <PageStage pageId="watchlist" title="Watchlist" detail={mode === "default" ? `${count} titles` : undefined} mode={mode} className="tv-library tv-downloads tv-watchlist" emptyTitle="Your watchlist is empty" errorTitle="The watchlist could not be loaded">
      <FixtureRows count={count} />
    </PageStage>
  );
}

const meta = { title: "Pages/Watchlist", component: Watchlist, tags: ["autodocs"], args: { mode: "default", count: 6 }, argTypes: { ...MODE_ARGTYPES, count: { control: { type: "number", min: 1, max: 24 } } } } satisfies Meta<typeof Watchlist>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
