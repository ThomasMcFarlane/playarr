import type { Meta, StoryObj } from "@storybook/react-vite";
import { Link } from "react-router-dom";
import { RailStack } from "../src/components/tv/RailStack";
import { TvMediaTrack } from "../src/components/tv/TvStage";
import { Art, FIXTURE_TITLES } from "./fixtures";

function Track({ title, spacing }: { title: string; spacing?: "related" | "section" }) {
  return (
    <TvMediaTrack title={title} scrollKey={`sb:stack:${title}`} itemsKey={title} dataTrackId={title} spacing={spacing}>
      {Array.from({ length: 8 }, (_, i) => (
        <Link to="/" className="tv-home-card" key={i}>
          <span className="tv-home-card-art">
            <Art index={i} />
          </span>
          <strong>{FIXTURE_TITLES[i % FIXTURE_TITLES.length]}</strong>
          <small>Movie · 2020</small>
        </Link>
      ))}
    </TvMediaTrack>
  );
}

/** Two seasons (related, small gap) followed by Cast and Similar titles (section, larger gap). */
function Stack({ spacing }: { spacing: "related" | "section" }) {
  return (
    <div style={{ position: "relative", height: "100vh" }}>
      <RailStack className="tv-series-browser" scrollKey="sb:stack" spacing={spacing} ariaLabel="Rail stack">
        <Track title="Season 1" />
        <Track title="Season 2" />
        <Track title="Cast" spacing="section" />
        <Track title="Similar titles" spacing="section" />
      </RailStack>
    </div>
  );
}

const meta = { title: "Components/RailStack", component: Stack, tags: ["autodocs"], args: { spacing: "related" }, argTypes: { spacing: { control: "inline-radio", options: ["related", "section"] } } } satisfies Meta<typeof Stack>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Related: Story = {};
export const Section: Story = { args: { spacing: "section" } };
