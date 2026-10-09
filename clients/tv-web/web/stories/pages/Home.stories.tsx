import type { Meta, StoryObj } from "@storybook/react-vite";
import { Link } from "react-router-dom";
import { PageLayout, ShellActionColumnProvider } from "../../src/components/shell";
import { TvMediaTrack, TvRailSurface } from "../../src/components/tv/TvStage";
import { Art, FIXTURE_TITLES } from "../fixtures";

type Mode = "default" | "loading" | "empty" | "error";
const RAILS = ["Continue watching", "Recently added movies", "Recently added series", "Watchlist"];

/**
 * Home composed from the real page frame (no header, backdrop wash), the real feature panel classes and real rail
 * components. The data-driven Home page itself needs the full catalogue API, so the cards are fixtures.
 */
function HomePage({ mode, rails, cards, view }: { mode: Mode; rails: number; cards: number; view: "cover" | "list" }) {
  const state =
    mode === "loading"
      ? ({ kind: "loading", skeleton: "rails", label: "Preparing Home" } as const)
      : mode === "empty"
        ? ({ kind: "empty", props: { graphic: "home", title: "Nothing to show yet", description: "Add a library to fill Home." } } as const)
        : mode === "error"
          ? ({ kind: "error", props: { graphic: "home", title: "Home could not be loaded", description: "Check the connection and try again.", onRetry: () => undefined, retryLabel: "Try again" } } as const)
          : undefined;
  return (
    <ShellActionColumnProvider>
      <PageLayout
        pageId="home"
        className={`tv-home${view === "cover" ? " is-cover-view" : ""}`}
        ariaLabel="Home"
        header={{ kind: "none" }}
        state={state}
        backdrop={state ? undefined : { artKey: "sb", art: <Art index={0} /> }}
      >
        {state ? null : (
          <>
            <aside className="tv-home-feature">
              <p className="tv-provider">Movie · Drama</p>
              <h2>{FIXTURE_TITLES[0]}</h2>
              <p>A fixture synopsis used only to show the feature panel above the rails.</p>
            </aside>
            <TvRailSurface className="tv-home-rails" mode="vertical-tracks" scrollKey="sb:home:rails" ariaLabel="Media tracks">
              {RAILS.slice(0, rails).map((title, r) => (
                <TvMediaTrack key={title} title={title} ariaLabel={title} active={r === 0} scrollKey={`sb:home:${title}`} itemsKey={`${title}:${cards}`} dataTrackId={title}>
                  {Array.from({ length: cards }, (_, i) => (
                    <Link to="/" className={`media-card tv-home-card${r === 0 && i === 0 ? " is-selected" : ""}`} key={i}>
                      <span className="tv-home-card-art">
                        <Art index={i + r * 3} />
                      </span>
                      <strong>{FIXTURE_TITLES[(i + r * 3) % FIXTURE_TITLES.length]}</strong>
                      <small>Movie · 2020</small>
                    </Link>
                  ))}
                </TvMediaTrack>
              ))}
            </TvRailSurface>
          </>
        )}
      </PageLayout>
    </ShellActionColumnProvider>
  );
}


const meta = {
  title: "Pages/Home",
  component: HomePage,
  args: { mode: "default", rails: 3, cards: 10, view: "cover" },
  argTypes: {
    mode: { control: "inline-radio", options: ["default", "loading", "empty", "error"] },
    rails: { control: { type: "number", min: 1, max: 4 } },
    cards: { control: { type: "number", min: 1, max: 30 } },
    view: { control: "inline-radio", options: ["cover", "list"] },
  },
} satisfies Meta<typeof HomePage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
