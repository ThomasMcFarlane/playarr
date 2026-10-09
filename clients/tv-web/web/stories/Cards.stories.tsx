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

function PersonCard({ index, mode, name = `Sample Person ${index + 1}`, role = "Role", photo = false }: { index: number; mode: Mode; name?: string; role?: string; photo?: boolean }) {
  if (mode === "loading") {
    return (
      <div className="tv-episode-card tv-person-card" aria-hidden="true">
        <span className="tv-episode-art tv-person-art">
          <SkeletonBlock width="100%" height="100%" />
        </span>
        <span className="tv-episode-copy tv-person-copy">
          <SkeletonBlock width="70%" height="1em" />
        </span>
      </div>
    );
  }
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("") || "?";
  return (
    <article className={`media-card tv-episode-card tv-person-card${mode === "selected" ? " is-selected" : ""}`} tabIndex={0} aria-label={`${name}, ${role}`}>
      <span className="tv-episode-art tv-person-art">
        {photo ? <Art index={index} /> : <span className="tv-person-placeholder">{initials}</span>}
      </span>
      <span className="tv-episode-copy tv-person-copy">
        <strong>{name}</strong>
        <small>{role}</small>
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
          <div style={{ width: "7rem" }}>
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

function CastRail({ mode, name, role, photo, count }: { mode: Mode; name: string; role: string; photo: boolean; count: number }) {
  return (
    <div className="sb-pad">
      <Caption>Cast rail item: circular headshot, name and role centred below (two lines at most)</Caption>
      <div className="sb-row" style={{ alignItems: "flex-start" }}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} style={{ width: "7rem" }}>
            <PersonCard index={i} mode={mode} name={i === 0 ? name : `Sample Person ${i + 1}`} role={i === 0 ? role : "Role"} photo={photo} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Cast and crew item (owner request 2026-10-09): 1:1 circle, shadow follows the circle on focus; no photo shows initials. */
export const CastItem: StoryObj<typeof CastRail> = {
  render: (args) => <CastRail {...args} />,
  args: { mode: "default", name: "Sample Person With A Very Long Name", role: "A character with a long role description", photo: false, count: 4 },
  argTypes: {
    mode: { control: "inline-radio", options: ["default", "selected", "loading"] },
    name: { control: "text" },
    role: { control: "text" },
    photo: { control: "boolean" },
    count: { control: { type: "range", min: 1, max: 8, step: 1 } },
  },
};
