import { MockApi, json, setMockApi } from "../mockApi";
import { createRef, useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlaybackHealthPanel } from "../../src/components/player/PlaybackHealthPanel";
import { WEB_PLAYBACK_CAPABILITIES } from "../../src/lib/playbackCapabilities";

const videoRef = createRef<HTMLVideoElement>();

function Panel({ state, withAbout }: { state: "loading" | "no-session" | "error"; withAbout: boolean }) {
  const [key, setKey] = useState(0);
  useEffect(() => {
    setMockApi((url) => {
      if (!url.pathname.includes("/playback")) return undefined;
      return state === "loading" ? "pending" : json({ error: "unavailable" }, 500);
    });
    setKey((k) => k + 1);
  }, [state]);
  return (
    <MockApi>
      <div className="player-surface" style={{ position: "relative", height: "100vh", background: "#000" }}>
        <PlaybackHealthPanel
          key={key}
          getSessionId={() => (state === "no-session" ? null : "00000000-0000-4000-8000-0000000000aa")}
          videoRef={videoRef}
          capabilities={WEB_PLAYBACK_CAPABILITIES}
          about={withAbout ? { title: "Test Movie A", subtitle: "2020", synopsis: "A fixture synopsis used only to show the info content." } : undefined}
          onClose={() => undefined}
        />
      </div>
    </MockApi>
  );
}

const meta = {
  title: "Components/Playback health panel",
  component: Panel,
  tags: ["autodocs"],
  args: { state: "loading", withAbout: true },
  argTypes: {
    state: { control: "inline-radio", options: ["loading", "no-session", "error"], description: "The ready report needs a live session, so it is not mocked" },
    withAbout: { control: "boolean" },
  },
} satisfies Meta<typeof Panel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
