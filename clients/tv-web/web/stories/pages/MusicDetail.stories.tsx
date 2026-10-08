import type { Meta, StoryObj } from "@storybook/react-vite";
import { Art } from "../fixtures";
import { MODE_ARGTYPES, PageStage, type Mode } from "./pageKit";

function MusicDetail({ mode, tracks }: { mode: Mode; tracks: number }) {
  return (
    <PageStage pageId="music-detail" title="Music" detail="Sample Album 1" mode={mode} skeleton="detail" className="tv-detail tv-music-detail" body="bleed" emptyTitle="Album unavailable" errorTitle="The album could not be loaded">
      <aside className="tv-detail-copy">
        <p className="tv-detail-kicker">Album</p>
        <h2 className="tv-detail-title">Sample Album 1</h2>
        <div className="tv-detail-meta">
          <span>Sample Artist</span>
          <span>{tracks} tracks</span>
          <span>2020</span>
        </div>
      </aside>
      <div className="tv-series-browser tv-music-browser">
        <div className="tv-music-album-art-fallback" style={{ width: "14rem", aspectRatio: "1" }}>
          <Art index={3} />
        </div>
        <ol className="tv-music-track-list">
          {Array.from({ length: tracks }, (_, i) => (
            <li key={i} className={`tv-music-track-row${i === 1 ? " is-selected" : ""}`}>
              <span className="tv-music-track-row-number" aria-hidden="true">{i + 1}</span>
              <strong>Sample Track {i + 1}</strong>
              <span className="tv-music-track-row-duration">3:{String(10 + i).padStart(2, "0")}</span>
            </li>
          ))}
        </ol>
      </div>
    </PageStage>
  );
}

const meta = { title: "Pages/MusicDetail", component: MusicDetail, tags: ["autodocs"], args: { mode: "default", tracks: 8 }, argTypes: { ...MODE_ARGTYPES, tracks: { control: { type: "number", min: 1, max: 30 } } } } satisfies Meta<typeof MusicDetail>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
