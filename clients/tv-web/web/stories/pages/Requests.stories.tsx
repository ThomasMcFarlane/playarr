import type { Meta, StoryObj } from "@storybook/react-vite";
import { FixtureRows, MODE_ARGTYPES, PageStage, type Mode } from "./pageKit";

function Requests({ mode, count }: { mode: Mode; count: number }) {
  return (
    <PageStage pageId="requests" title="Requests" detail={mode === "default" ? `${count} requests` : undefined} mode={mode} className="tv-library tv-downloads tv-watchlist" emptyTitle="No requests yet" errorTitle="Requests could not be loaded">
      <FixtureRows count={count} action="Pending" meta="Requested" />
    </PageStage>
  );
}

const meta = { title: "Pages/Requests", component: Requests, tags: ["autodocs"], args: { mode: "default", count: 5 }, argTypes: { ...MODE_ARGTYPES, count: { control: { type: "number", min: 1, max: 24 } } } } satisfies Meta<typeof Requests>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
