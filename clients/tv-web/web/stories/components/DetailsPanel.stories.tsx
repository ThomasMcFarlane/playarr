import type { Meta, StoryObj } from "@storybook/react-vite";
import { DetailsPanel } from "../../src/components/DetailsPanel";
import { StatusPill, type StatusPillTone } from "../../src/components/StatusPill";
import { Button } from "../../src/components/ui";

type Args = {
  eyebrow: string;
  title: string;
  year: string;
  genres: string;
  overview: string;
  pillTone: StatusPillTone;
  pillText: string;
  showActions: boolean;
  placement: "stage" | "flow";
};

function Panel({ eyebrow, title, year, genres, overview, pillTone, pillText, showActions, placement }: Args) {
  return (
    <div className="sb-pad" style={{ position: "relative", minHeight: 420, maxWidth: 560 }}>
      <DetailsPanel
        placement={placement}
        style={placement === "stage" ? { position: "relative", top: 0, left: 0 } : undefined}
        eyebrow={eyebrow}
        title={title}
        meta={
          <>
            {year ? <span>{year}</span> : null}
            {genres ? <span>{genres}</span> : null}
          </>
        }
        overview={overview}
        pills={pillText ? <StatusPill tone={pillTone}>{pillText}</StatusPill> : undefined}
        actions={
          showActions ? (
            <>
              <Button variant="primary">Play</Button>
              <Button variant="secondary">Add to watchlist</Button>
            </>
          ) : undefined
        }
      />
    </div>
  );
}

const meta = {
  title: "Components/Details panel",
  component: Panel,
  tags: ["autodocs"],
  args: {
    eyebrow: "Movie · Drama",
    title: "Test Movie A",
    year: "2020",
    genres: "Drama · Comedy",
    overview: "A fixture synopsis used only to show the layout of the details panel.",
    pillTone: "available",
    pillText: "Available",
    showActions: true,
    placement: "flow",
  },
  argTypes: {
    placement: { control: "inline-radio", options: ["stage", "flow"] },
    pillTone: { control: "select", options: ["neutral", "available", "downloading", "upcoming", "missing", "requested"] },
    pillText: { control: "text" },
    showActions: { control: "boolean" },
    overview: { control: "text" },
  },
} satisfies Meta<typeof Panel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
