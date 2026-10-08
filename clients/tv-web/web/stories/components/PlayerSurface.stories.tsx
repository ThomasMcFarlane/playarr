import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PlayerMusicContext } from "../../src/components/player/PlayerSurface";
import {
  InlineMusicMiniPlayer,
  MusicVisualiserBars,
  PlayerCloseButton,
  musicVisualiserBarCount,
} from "../../src/components/player/PlayerSurface";
import { Caption } from "../fixtures";

const noop = () => undefined;
const CONTEXT: PlayerMusicContext = {
  artistName: "Sample Artist",
  albumTitle: "Sample Album",
  artworkWork: { id: "00000000-0000-4000-8000-00000000a1b2", images: [] } as unknown as PlayerMusicContext["artworkWork"],
};

/**
 * The full surface needs a live playback engine, so the story renders its exported parts: the close button, the music
 * visualiser and the inline music mini player.
 */
function Surface({ withMusicContext, progress, platform }: { withMusicContext: boolean; progress: number; platform: "web" | "tv-webos" }) {
  return (
    <div className="sb-pad sb-col">
      <div>
        <Caption>Close button ({musicVisualiserBarCount(platform)} visualiser bars on this platform)</Caption>
        <div className="player-surface" style={{ position: "relative", height: "8rem", background: "#000" }}>
          <PlayerCloseButton onClose={noop} />
        </div>
      </div>
      <div>
        <Caption>Music visualiser (at rest)</Caption>
        <div className="player-music-cover" style={{ width: "16rem", height: "6rem" }}>
          <MusicVisualiserBars />
        </div>
      </div>
      <div>
        <Caption>Inline music mini player</Caption>
        <div style={{ position: "relative", height: "6rem", width: "min(100%, 28rem)" }}>
          <InlineMusicMiniPlayer
            context={withMusicContext ? CONTEXT : undefined}
            title="Sample Track 1"
            positionSeconds={Math.round(2.4 * progress)}
            durationSeconds={240}
            progressPercentage={progress}
            onMaximise={noop}
          />
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Components/Player surface",
  component: Surface,
  tags: ["autodocs"],
  args: { withMusicContext: true, progress: 35, platform: "web" },
  argTypes: {
    withMusicContext: { control: "boolean", description: "false shows the artwork fallback" },
    progress: { control: { type: "range", min: 0, max: 100 } },
    platform: { control: "inline-radio", options: ["web", "tv-webos"] },
  },
} satisfies Meta<typeof Surface>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
