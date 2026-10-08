import type { Meta, StoryObj } from "@storybook/react-vite";
import { Link } from "react-router-dom";
import { PageLayout, ShellActionColumnProvider, SkeletonBlock, type PageAction, type PageLayoutState } from "../../src/components/shell";
import { TvMediaTrack } from "../../src/components/tv/TvStage";
import { Art, FIXTURE_TITLES } from "../fixtures";

const noop = () => undefined;
const ACTIONS: PageAction[] = [{ kind: "filters", label: "Filters", open: false, onToggle: noop, controls: "sb-filters", activeCount: 0 }];

type Mode = "default" | "loading" | "empty" | "error" | "retry";

function stateFor(mode: Mode): PageLayoutState | undefined {
  switch (mode) {
    case "empty":
      return { kind: "empty", props: { title: "No titles yet", description: "Add a library to see titles here.", graphic: "movies" } };
    case "error":
      return { kind: "error", props: { title: "Movies could not be loaded", description: "Check the connection and try again." } };
    case "retry":
      return { kind: "error", props: { title: "Movies could not be loaded", description: "Check the connection and try again.", onRetry: noop, retryLabel: "Try again" } };
    default:
      return undefined;
  }
}

function LibraryPage({ mode }: { mode: Mode }) {
  const rail = (title: string, offset: number) => (
    <TvMediaTrack title={title} scrollKey={`sb:page:${title}`} itemsKey={`${mode}:${title}`} dataTrackId={title}>
      {Array.from({ length: 12 }, (_, i) =>
        mode === "loading" ? (
          <div className="tv-home-card" key={i} aria-hidden="true">
            <span className="tv-home-card-art">
              <SkeletonBlock width="100%" height="100%" />
            </span>
            <SkeletonBlock width="70%" height="1em" />
          </div>
        ) : (
          <Link to="/" className="tv-home-card" key={i}>
            <span className="tv-home-card-art">
              <Art index={i + offset} />
            </span>
            <strong>{FIXTURE_TITLES[(i + offset) % FIXTURE_TITLES.length]}</strong>
            <small>Movie · 2020</small>
          </Link>
        ),
      )}
    </TvMediaTrack>
  );
  return (
    <ShellActionColumnProvider>
      <div id="sb-filters" hidden />
      <PageLayout
        pageId="library"
        header={{ title: "Movies", detail: mode === "default" ? "128 titles" : undefined, back: { label: "Back", to: "/" }, actions: ACTIONS }}
        state={stateFor(mode)}
        ariaLabel="Movies"
        className="tv-library"
      >
        {mode === "empty" || mode === "error" || mode === "retry" ? null : (
          <div className="tv-rail-panel tv-library-grid-panel">
            {rail("Recently added", 0)}
            {rail("Continue watching", 4)}
          </div>
        )}
      </PageLayout>
    </ShellActionColumnProvider>
  );
}

const meta = { title: "Pages/Library", component: LibraryPage, args: { mode: "default" }, argTypes: { mode: { control: "inline-radio", options: ["default", "loading", "empty", "error", "retry"] } } } satisfies Meta<typeof LibraryPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
