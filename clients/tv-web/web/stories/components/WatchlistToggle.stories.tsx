import type { Meta, StoryObj } from "@storybook/react-vite";
import type { TitleSnapshot } from "@playarr-tv/api-client";
import { WatchlistToggle } from "../../src/components/WatchlistToggle";
import { setMockApi } from "../mocks/ApiClientProvider";

const SNAPSHOT = { kind: "movie", title: "Test Movie A", year: 2020 } as unknown as TitleSnapshot;

type Args = { listed: boolean; loading: boolean; failMutation: boolean };

function Toggle({ listed, loading, failMutation }: Args) {
  const resolved = { in_watchlist: listed, title: { title_key: "sample-title" } };
  setMockApi({
    resolveTitle: () => (loading ? new Promise(() => undefined) : resolved),
    addToWatchlist: () => (failMutation ? Promise.reject(new Error("The watchlist could not be changed.")) : resolved),
    removeFromWatchlist: () => (failMutation ? Promise.reject(new Error("The watchlist could not be changed.")) : {}),
  });
  return (
    <div className="sb-pad" key={`${listed}:${loading}:${failMutation}`}>
      <WatchlistToggle snapshot={SNAPSHOT} />
    </div>
  );
}

const meta = {
  title: "Components/Watchlist toggle",
  component: Toggle,
  tags: ["autodocs"],
  args: { listed: false, loading: false, failMutation: false },
  argTypes: {
    listed: { control: "boolean", description: "On the watchlist" },
    loading: { control: "boolean", description: "State not resolved yet (button disabled)" },
    failMutation: { control: "boolean", description: "Click shows the error state" },
  },
} satisfies Meta<typeof Toggle>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
