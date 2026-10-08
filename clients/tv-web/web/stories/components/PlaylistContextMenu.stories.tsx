import { useEffect, useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { usePlaylistContextMenu } from "../../src/components/PlaylistContextMenu";
import { MockApi } from "../mocks/providers";

type View = "closed" | "actions" | "edit" | "delete";

const PLAYLIST = {
  id: "00000000-0000-4000-8000-0000000004a1",
  name: "Sample Playlist 1",
  is_system: false,
  media_type: "Video",
  parent_playlist_id: null,
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
} as never;

function Menu({ view }: { view: View }) {
  const { itemProps, open, openEdit, openDelete, contextMenu } = usePlaylistContextMenu({
    onDeleted: () => undefined,
    onUpdated: () => undefined,
    playlists: [PLAYLIST],
  });
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const origin = ref.current;
    if (!origin || view === "closed") return;
    (view === "actions" ? open : view === "edit" ? openEdit : openDelete)(PLAYLIST, origin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  return (
    <div className="sb-pad">
      <p className="sb-caption">Hold Enter or use the context-menu key on the playlist to open the actions.</p>
      <a href="#sb" ref={ref} className="tv-title-card" style={{ width: "16rem" }} {...itemProps(PLAYLIST)}>
        <span className="tv-title-card-copy">
          <strong>Sample Playlist 1</strong>
        </span>
      </a>
      {contextMenu}
    </div>
  );
}

function Story({ view }: { view: View }) {
  return (
    <MockApi key={view} handlers={{ updatePlaylist: PLAYLIST, deletePlaylist: {} }}>
      <Menu view={view} />
    </MockApi>
  );
}

const meta = {
  title: "Components/Playlist context menu",
  component: Story,
  tags: ["autodocs"],
  args: { view: "actions" },
  argTypes: { view: { control: "inline-radio", options: ["closed", "actions", "edit", "delete"] } },
} satisfies Meta<typeof Story>;
export default meta;
type Story_ = StoryObj<typeof meta>;

export const Playground: Story_ = {};
