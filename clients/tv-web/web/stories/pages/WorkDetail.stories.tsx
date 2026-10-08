import type { Meta, StoryObj } from "@storybook/react-vite";
import { TvMediaTrack } from "../../src/components/tv/TvStage";
import { Art } from "../fixtures";
import { MODE_ARGTYPES, PageStage, type Mode } from "./pageKit";

type Kind = "movie" | "series";

function WorkDetail({ mode, kind, seasons }: { mode: Mode; kind: Kind; seasons: number }) {
  return (
    <PageStage pageId="work-detail" title={kind === "movie" ? "Movies" : "Series"} detail={kind === "movie" ? "Test Movie A" : "Sample Series 1"} mode={mode} skeleton="detail" className="tv-detail" body="bleed" emptyTitle="Details unavailable" errorTitle="The title could not be loaded">
      <aside className="tv-detail-copy">
        <p className="tv-detail-kicker">{kind === "movie" ? "Drama" : "S01 · E02"}</p>
        <h2 className="tv-detail-title">{kind === "movie" ? "Test Movie A" : "Sample Series 1"}</h2>
        <div className="tv-detail-meta">
          <span>{kind === "movie" ? "Movie" : "Season 1"}</span>
          <span>1h 52m</span>
          <span>2020</span>
          <span>Drama</span>
        </div>
        <p className="tv-detail-synopsis">A fixture synopsis used only to show the details layout and its wrapping.</p>
        <div className="tv-detail-actions">
          <button type="button" className="tv-detail-download"><span aria-hidden="true">⇩</span><strong>Download</strong></button>
          <button type="button" className="tv-detail-playback-settings"><span aria-hidden="true">☷</span><strong>Playback</strong></button>
          <a href="#fixture" className="tv-detail-play">Play</a>
        </div>
      </aside>
      {kind === "series" ? (
        <div className="tv-series-browser">
          {Array.from({ length: seasons }, (_, s) => (
            <TvMediaTrack key={s} title={`Season ${s + 1}`} scrollKey={`sb:detail:${s}`} itemsKey={`${seasons}`} dataTrackId={`season-${s}`}>
              {Array.from({ length: 8 }, (_, e) => (
                <a href="#fixture" className={`media-card tv-episode-card${s === 0 && e === 1 ? " is-selected" : ""}`} key={e}>
                  <span className="tv-episode-art"><Art index={e + s} /></span>
                  <span className="tv-episode-copy"><small>E{String(e + 1).padStart(2, "0")}</small><strong>Sample Episode {e + 1}</strong></span>
                </a>
              ))}
            </TvMediaTrack>
          ))}
        </div>
      ) : null}
    </PageStage>
  );
}

const meta = {
  title: "Pages/WorkDetail",
  component: WorkDetail,
  tags: ["autodocs"],
  args: { mode: "default", kind: "series", seasons: 2 },
  argTypes: { ...MODE_ARGTYPES, kind: { control: "inline-radio", options: ["movie", "series"] }, seasons: { control: { type: "number", min: 1, max: 6 } } },
} satisfies Meta<typeof WorkDetail>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
