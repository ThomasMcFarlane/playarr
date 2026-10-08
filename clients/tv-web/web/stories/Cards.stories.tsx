import type { Meta, StoryObj } from "@storybook/react-vite";
import { Link } from "react-router-dom";
import { SkeletonBlock } from "../src/components/shell";
import { Art, Caption, FIXTURE_TITLES } from "./fixtures";

type Mode = "default" | "selected" | "loading";

function HomeCard({ index, mode }: { index: number; mode: Mode }) {
  if (mode === "loading") {
    return (
      <div className="tv-home-card" aria-hidden="true">
        <span className="tv-home-card-art">
          <SkeletonBlock width="100%" height="100%" />
        </span>
        <SkeletonBlock width="70%" height="1em" />
        <SkeletonBlock width="40%" height="0.8em" />
      </div>
    );
  }
  return (
    <Link to="/" className={`tv-home-card${mode === "selected" ? " is-selected" : ""}`}>
      <span className="tv-home-card-art">
        <Art index={index} />
      </span>
      <strong>{FIXTURE_TITLES[index]}</strong>
      <small>Movie · 2020</small>
    </Link>
  );
}

function TitleCard({ index, mode }: { index: number; mode: Mode }) {
  if (mode === "loading") {
    return (
      <div className="tv-title-card" aria-hidden="true">
        <span className="tv-title-card-art">
          <SkeletonBlock width="100%" height="100%" />
        </span>
        <span className="tv-title-card-copy">
          <SkeletonBlock width="70%" height="1em" />
        </span>
      </div>
    );
  }
  return (
    <Link to="/" className={`tv-title-card${mode === "selected" ? " is-selected" : ""}`} aria-label={`Open ${FIXTURE_TITLES[index]}`}>
      <span className="tv-title-card-art">
        <Art index={index} />
      </span>
      <span className="tv-title-card-copy">
        <strong>{FIXTURE_TITLES[index]}</strong>
        <span className="tv-list-card-meta">Drama · Comedy</span>
      </span>
    </Link>
  );
}

function EpisodeCard({ index, mode }: { index: number; mode: Mode }) {
  if (mode === "loading") {
    return (
      <div className="tv-episode-card" aria-hidden="true">
        <span className="tv-episode-art">
          <SkeletonBlock width="100%" height="100%" />
        </span>
        <span className="tv-episode-copy">
          <SkeletonBlock width="60%" height="1em" />
        </span>
      </div>
    );
  }
  return (
    <Link to="/" className={`tv-episode-card${mode === "selected" ? " is-selected" : ""}`} aria-label={`Open ${FIXTURE_TITLES[index]}`}>
      <span className="tv-episode-art">
        <Art index={index} />
      </span>
      <span className="tv-episode-copy">
        <small>Series</small>
        <strong>{FIXTURE_TITLES[index]}</strong>
      </span>
    </Link>
  );
}

function PersonCard({ index, mode }: { index: number; mode: Mode }) {
  return (
    <article className={`tv-episode-card tv-person-card${mode === "selected" ? " is-selected" : ""}`} tabIndex={0} aria-label={`Sample Person ${index + 1}, Role`}>
      <span className="tv-episode-art tv-person-art">
        <span className="tv-person-placeholder">SP</span>
      </span>
      <span className="tv-episode-copy tv-person-copy">
        <strong>Sample Person {index + 1}</strong>
        <small>Role</small>
      </span>
    </article>
  );
}

function Cards({ mode }: { mode: Mode }) {
  return (
    <div className="sb-pad sb-col">
      <div>
        <Caption>Home card</Caption>
        <div className="sb-row" style={{ alignItems: "flex-start" }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: "16rem" }}>
              <HomeCard index={i} mode={mode} />
            </div>
          ))}
        </div>
      </div>
      <div>
        <Caption>Library title card</Caption>
        <div className="sb-row" style={{ alignItems: "flex-start" }}>
          {[3, 4, 5].map((i) => (
            <div key={i} style={{ width: "13rem" }}>
              <TitleCard index={i} mode={mode} />
            </div>
          ))}
        </div>
      </div>
      <div>
        <Caption>Episode and person cards</Caption>
        <div className="sb-row" style={{ alignItems: "flex-start" }}>
          {[6, 7].map((i) => (
            <div key={i} style={{ width: "16rem" }}>
              <EpisodeCard index={i} mode={mode} />
            </div>
          ))}
          <div style={{ width: "10rem" }}>
            <PersonCard index={0} mode={mode} />
          </div>
        </div>
      </div>
    </div>
  );
}

const meta = { title: "Components/Cards", component: Cards, tags: ["autodocs"], args: { mode: "default" }, argTypes: { mode: { control: "inline-radio", options: ["default", "selected", "loading"] } } } satisfies Meta<typeof Cards>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Owner rule: media cards show a soft shadow plus a lift on focus, never a ring or fill (use the Pseudo states toolbar). */
export const Playground: Story = {};
