import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PlaybackEngineState } from "@playarr-tv/player-core";
import { PlayerControls } from "../src/components/player/PlayerControls";
import { focusOn } from "./fixtures";

const noop = () => undefined;

function engine(state: PlaybackEngineState["state"], muted = false): PlaybackEngineState {
  return {
    state,
    currentTimeSeconds: 754,
    durationSeconds: 5400,
    bufferedSeconds: 1500,
    volume: 0.7,
    muted,
    audioTracks: [{ id: "a1", label: "English", language: "en", roles: [], selected: true }],
    subtitleTracks: [{ id: "s1", label: "English", language: "en", roles: [], forced: false, selected: false }],
    selectedAudioTrackId: "a1",
    selectedSubtitleTrackId: null,
  } as PlaybackEngineState;
}

function Chrome({ state, visible = true }: { state: PlaybackEngineState["state"]; visible?: boolean }) {
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

const meta = { title: "Components/Player chrome", component: Chrome, tags: ["autodocs"], args: { state: "playing" } } satisfies Meta<typeof Chrome>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playing: Story = {};
export const Paused: Story = { args: { state: "paused" } };
export const Buffering: Story = { args: { state: "buffering" } };
export const Hidden: Story = { args: { visible: false } };
export const Focus: Story = { parameters: focusOn(".player-controls button, .player-seek-track") };
