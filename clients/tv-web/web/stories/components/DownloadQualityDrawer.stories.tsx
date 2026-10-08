import type { Meta, StoryObj } from "@storybook/react-vite";
import { DownloadQualityDrawer } from "../../src/components/DownloadQualityDrawer";
import { MockApi, never } from "../mocks/providers";

type Mode = "ready" | "loading" | "error";

function Quality({ mode, items, busy }: { mode: Mode; items: number; busy: boolean }) {
  const options = {
    media_file_id: "00000000-0000-4000-8000-0000000002a0",
    container: "mp4",
    options: [
      { id: "original", label: "Original", profile: null, height: 2160, estimated_size_bytes: 8_400_000_000, size_is_estimate: false },
      { id: "high", label: "High 1080p", profile: "high", height: 1080, estimated_size_bytes: 2_600_000_000, size_is_estimate: true },
      { id: "low", label: "Low 480p", profile: "low", height: 480, estimated_size_bytes: 600_000_000, size_is_estimate: true },
    ],
  };
  const leaves = Array.from({ length: items }, (_, i) => ({
    mediaFileId: `00000000-0000-4000-8000-0000000002a${i}`,
    runtimeMs: 5_400_000,
    title: `Sample Episode ${i + 1}`,
  }));
  const handler = mode === "ready" ? options : mode === "loading" ? never : () => Promise.reject(new Error("Quality options could not be loaded."));
  return (
    <MockApi key={`${mode}:${items}`} handlers={{ getDownloadOptions: handler }}>
      <DownloadQualityDrawer title="Test Movie A" leaves={leaves} busy={busy} onClose={() => undefined} onConfirm={() => undefined} />
    </MockApi>
  );
}

const meta = {
  title: "Components/Download quality drawer",
  component: Quality,
  tags: ["autodocs"],
  args: { mode: "ready", items: 1, busy: false },
  argTypes: {
    mode: { control: "inline-radio", options: ["ready", "loading", "error"] },
    items: { control: { type: "number", min: 0, max: 12 }, description: "More than one shows the per-item batch size; zero is the empty error" },
    busy: { control: "boolean" },
  },
} satisfies Meta<typeof Quality>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
