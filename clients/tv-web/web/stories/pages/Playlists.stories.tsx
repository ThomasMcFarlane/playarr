import type { Meta, StoryObj } from "@storybook/react-vite";
import { FixtureGrid, MODE_ARGTYPES, PageStage, type Mode } from "./pageKit";

function Playlists({ mode, count }: { mode: Mode; count: number }) {
  return (
    <PageStage
      pageId="playlists"
      title="Playlists"
      detail={mode === "default" ? `${count} playlists` : undefined}
      mode={mode}
      skeleton="grid"
      className="tv-home tv-playlists is-playlist-directory"
      actions={[{ kind: "panel", id: "create", label: "Create", icon: "add", open: false, onToggle: () => undefined, controls: "create-panel" }]}
      emptyTitle="No playlists yet"
      errorTitle="Playlists could not be loaded"
    >
      <FixtureGrid count={count} />
    </PageStage>
  );
}

const meta = { title: "Pages/Playlists", component: Playlists, tags: ["autodocs"], args: { mode: "default", count: 8 }, argTypes: { ...MODE_ARGTYPES, count: { control: { type: "number", min: 1, max: 24 } } } } satisfies Meta<typeof Playlists>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
