import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { LibraryPreview } from "../../src/components/LibraryPreview";
import { createPreviewStore } from "../../src/lib/previewStore";
import { fixtureWork } from "../mocks/providers";

function Preview({ title, genres, overview, hasOverview }: { title: string; genres: string; overview: string; hasOverview: boolean }) {
  const store = useMemo(() => createPreviewStore<never>(), []);
  const work = fixtureWork(0, { title, genres: genres.split(",").map((g) => g.trim()).filter(Boolean), overview: hasOverview ? overview : null });
  return (
    <div className="sb-pad" style={{ maxWidth: 520 }}>
      <LibraryPreview store={store} fallback={work} singular="Movie" />
    </div>
  );
}

const meta = {
  title: "Components/Library preview",
  component: Preview,
  tags: ["autodocs"],
  args: { title: "Test Movie A", genres: "Drama, Comedy", overview: "A fixture synopsis used only to show the layout of the preview.", hasOverview: true },
  argTypes: { title: { control: "text" }, genres: { control: "text" }, overview: { control: "text" }, hasOverview: { control: "boolean", description: "Off shows the no-synopsis fallback" } },
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
