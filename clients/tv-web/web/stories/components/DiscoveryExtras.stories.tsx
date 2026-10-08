import type { Meta, StoryObj } from "@storybook/react-vite";
import { DiscoveryExtras } from "../../src/components/DiscoveryExtras";
import { MockApi, never } from "../mocks/providers";

type Mode = "titles" | "empty" | "notice" | "loading" | "error";

const title = (n: number) => ({
  title_key: `fixture-${n}`,
  title: `Sample Series ${n}`,
  year: 2020 + n,
  kind: "series",
  editions: [],
  in_watchlist: n === 2,
  sources: [{ source: "request", availability: "requestable", provider: "fixture" }],
});

function Extras({ mode, gamesOnly }: { mode: Mode; gamesOnly: boolean }) {
  const response = {
    titles: mode === "titles" ? [title(1), title(2), title(3)] : [],
    providers: mode === "notice" ? [{ provider: gamesOnly ? "game" : "peer", state: "unavailable", reason: "This source is not reachable right now." }] : [],
  };
  const handler = mode === "loading" ? never : mode === "error" ? () => Promise.reject(new Error("Discovery failed.")) : response;
  return (
    <MockApi key={`${mode}:${gamesOnly}`} handlers={{ discover: handler, listWatchlist: { entries: [] }, getWatchlist: { entries: [] } }}>
      <div className="sb-pad" style={{ maxWidth: 760 }}>
        <DiscoveryExtras query="sample" gamesOnly={gamesOnly} />
      </div>
    </MockApi>
  );
}

const meta = {
  title: "Components/Discovery extras",
  component: Extras,
  tags: ["autodocs"],
  args: { mode: "titles", gamesOnly: false },
  argTypes: { mode: { control: "inline-radio", options: ["titles", "empty", "notice", "loading", "error"] }, gamesOnly: { control: "boolean" } },
} satisfies Meta<typeof Extras>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
