import type { Meta, StoryObj } from "@storybook/react-vite";
import { MediaThumbnailArtwork } from "../../src/components/MediaThumbnailArtwork";
import { MockApi, never } from "../mocks/providers";
import { artStyle } from "../fixtures";

type Mode = "frame" | "loading" | "error";

const SVG = (hue: number) =>
  new Blob([`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="hsl(${hue} 46% 34%)"/></svg>`], { type: "image/svg+xml" });

function Artwork({ mode, withFallback }: { mode: Mode; withFallback: boolean }) {
  const handler = mode === "frame" ? () => Promise.resolve(SVG(200)) : mode === "loading" ? never : () => Promise.reject(new Error("fixture"));
  return (
    <MockApi key={mode} handlers={{ getMediaThumbnail: handler, getEpisodeArtwork: handler }}>
      <div className="sb-pad" style={{ width: "22rem" }}>
        <MediaThumbnailArtwork
          mediaFileId={`00000000-0000-4000-8000-0000000003${mode.length}0`}
          fallback={withFallback ? `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="%23553"/></svg>')}` : null}
          className="tv-episode-art"
        >
          {!withFallback && mode !== "frame" ? <span style={{ ...artStyle(3), position: "absolute", inset: 0 }} aria-hidden="true" /> : null}
        </MediaThumbnailArtwork>
      </div>
    </MockApi>
  );
}

const meta = {
  title: "Components/Media thumbnail artwork",
  component: Artwork,
  tags: ["autodocs"],
  args: { mode: "frame", withFallback: true },
  argTypes: { mode: { control: "inline-radio", options: ["frame", "loading", "error"] }, withFallback: { control: "boolean" } },
} satisfies Meta<typeof Artwork>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
