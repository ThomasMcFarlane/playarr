import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PlaybackEngineState } from "@playarr-tv/player-core";
import { PlayerControls } from "../../src/components/player/PlayerControls";

const noop = () => undefined;
type EngineState = PlaybackEngineState["state"];

function engine(state: EngineState): PlaybackEngineState {
  return {
    state,
    currentTimeSeconds: 754,
    durationSeconds: 5400,
    bufferedSeconds: 1500,
    volume: 0.7,
    muted: false,
    audioTracks: [{ id: "a1", label: "English", language: "en", roles: [], selected: true }],
    subtitleTracks: [{ id: "s1", label: "English", language: "en", roles: [], forced: false, selected: false }],
    selectedAudioTrackId: "a1",
    selectedSubtitleTrackId: null,
  } as PlaybackEngineState;
}

/** The player page: a black stage with the standard chrome and at most the buffering spinner (never a preparing screen). */
function PlayerPage({ state, visible }: { state: EngineState; visible: boolean }) {
  return (
    <div className="player-surface" style={{ position: "relative", height: "100vh", background: "#000" }}>
      <PlayerControls
        engineState={engine(state)}
        visible={visible}
        contextTitle="Sample Series 1 · S01E02"
        isFullscreen={false}
        onTogglePlay={noop}
        onSeek={noop}
        onSetVolume={noop}
        onSetMuted={noop}
        onToggleFullscreen={noop}
        bufferedRanges={[[0, 1500]]}
        qualityOptions={[]}
        activeQualityId="original"
        qualitySwitching={false}
        onSelectQuality={noop}
        audioTracks={[{ id: "a1", label: "English", language: "en" }]}
        selectedAudioTrackId="a1"
        onSelectAudioTrack={noop}
        subtitleTracks={[{ id: "s1", label: "English", language: "en" }]}
        selectedSubtitleTrackId={null}
        subtitleSwitching={false}
        onSelectSubtitleTrack={noop}
        canPrevious
        canNext
        onPrevious={noop}
        onNext={noop}
        playlistCount={0}
        playlistOpen={false}
        onTogglePlaylist={noop}
        onQualityMenuOpenChange={noop}
        onActivity={noop}
      />
    </div>
  );
}

const meta = {
  title: "Pages/Player",
  component: PlayerPage,
  tags: ["autodocs"],
  args: { state: "playing", visible: true },
  argTypes: { state: { control: "inline-radio", options: ["playing", "paused", "buffering"] }, visible: { control: "boolean", description: "Controls overlay shown" } },
} satisfies Meta<typeof PlayerPage>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
