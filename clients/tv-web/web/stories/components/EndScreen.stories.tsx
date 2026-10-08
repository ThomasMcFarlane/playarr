import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Work } from "@playarr-tv/api-client";
import { EndScreen } from "../../src/components/player/EndScreen";
import { FIXTURE_TITLES } from "../fixtures";

const noop = () => undefined;
const suggestion = (index: number): Work =>
  ({ id: `00000000-0000-4000-8000-00000000f0${index}`, title: FIXTURE_TITLES[index % FIXTURE_TITLES.length], kind: "movie", images: [] }) as unknown as Work;

function End({ kind, suggestions, withNext }: { kind: "ended" | "up-next"; suggestions: number; withNext: boolean }) {
  return (
    <div className="player-surface" style={{ position: "relative", height: "100vh", background: "#000" }}>
      <EndScreen
        kind={kind}
        title="Sample Series 1"
        subtitle="S01E02 · Sample Episode 2"
        next={withNext ? { title: "Sample Episode 3", subtitle: "Sample Series 1", seasonNumber: 1, episodeNumber: 3 } : undefined}
        suggestions={Array.from({ length: suggestions }, (_, i) => suggestion(i))}
        onReplay={noop}
        onExit={noop}
        onPlayNow={noop}
        onSelectSuggestion={noop}
      />
    </div>
  );
}

const meta = {
  title: "Components/End screen",
  component: End,
  tags: ["autodocs"],
  args: { kind: "ended", suggestions: 6, withNext: true },
  argTypes: {
    kind: { control: "inline-radio", options: ["ended", "up-next"], description: "up-next shows the countdown" },
    suggestions: { control: { type: "number", min: 0, max: 12 }, description: "0 shows the empty state" },
    withNext: { control: "boolean" },
  },
} satisfies Meta<typeof End>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
