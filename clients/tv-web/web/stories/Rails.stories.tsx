import type { Meta, StoryObj } from "@storybook/react-vite";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, SkeletonBlock } from "../src/components/shell";
import { TvMediaTrack } from "../src/components/tv/TvStage";
import { Art, FIXTURE_TITLES } from "./fixtures";

type Mode = "default" | "loading" | "empty" | "error";

function Rail({ mode, count = 12 }: { mode: Mode; count?: number }) {
  return (
    <div className="sb-pad" style={{ paddingInline: "var(--screen-x)" }}>
      <TvMediaTrack title="Continue watching" meta={mode === "default" ? `${count} titles` : undefined} scrollKey="sb:rail" itemsKey={`${mode}:${count}`} dataTrackId="sb">
        {mode === "loading"
          ? Array.from({ length: 8 }, (_, i) => (
              <div className="tv-home-card" key={i} aria-hidden="true">
                <span className="tv-home-card-art">
                  <SkeletonBlock width="100%" height="100%" />
                </span>
                <SkeletonBlock width="70%" height="1em" />
              </div>
            ))
          : mode === "empty"
            ? [<EmptyState key="e" variant="rail" title="Nothing here yet" description="Titles you start watching appear here." />]
            : mode === "error"
              ? [<ErrorState key="x" variant="rail" title="This rail could not be loaded" onRetry={() => undefined} retryLabel="Try again" />]
              : Array.from({ length: count }, (_, i) => (
                  <Link to="/" className="tv-home-card" key={i}>
                    <span className="tv-home-card-art">
                      <Art index={i} />
                    </span>
                    <strong>{FIXTURE_TITLES[i % FIXTURE_TITLES.length]}</strong>
                    <small>Movie · 2020</small>
                  </Link>
                ))}
      </TvMediaTrack>
    </div>
  );
}

const meta = { title: "Components/Rail", component: Rail, tags: ["autodocs"], args: { mode: "default", count: 12 }, argTypes: { mode: { control: "inline-radio", options: ["default", "loading", "empty", "error"] }, count: { control: { type: "number", min: 1, max: 40 } } } } satisfies Meta<typeof Rail>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The right edge shows the single soft fade because the content continues off screen. */
export const Playground: Story = {};
