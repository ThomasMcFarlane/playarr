import { useEffect, useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMediaContextMenu } from "../../src/components/MediaContextMenu";
import { Art, FIXTURE_TITLES } from "../fixtures";
import { fixtureWork, MockApi } from "../mocks/providers";

type View = "closed" | "actions" | "playlists" | "download";

const PLAYLISTS = [
  { id: "00000000-0000-4000-8000-0000000004a1", name: "Sample Playlist 1", is_system: false, media_type: "Video", parent_playlist_id: null, created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-01T10:00:00Z" },
  { id: "00000000-0000-4000-8000-0000000004a2", name: "Sample Playlist 2", is_system: false, media_type: "Video", parent_playlist_id: null, created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-01T10:00:00Z" },
];

function Menu({ view, hasProgress }: { view: View; hasProgress: boolean }) {
  const { itemProps, openAction, contextMenu } = useMediaContextMenu();
  const cardRef = useRef<HTMLAnchorElement>(null);
  const work = fixtureWork(0);
  const item = {
    work,
    workId: (work as { id: string }).id,
    title: FIXTURE_TITLES[0],
    detailRoute: "/movies/sample",
    parentRoute: "/movies",
    leaves: [{ mediaFileId: "00000000-0000-4000-8000-0000000002a0", runtimeMs: 5_400_000, title: FIXTURE_TITLES[0] }],
    progress: hasProgress ? ({ state: "part_watched", position_ms: 1_800_000, duration_ms: 5_400_000, work_id: "w", media_file_id: "m" } as never) : undefined,
  };
  useEffect(() => {
    const card = cardRef.current;
    if (!card || view === "closed") return;
    if (view === "actions") card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    else openAction(view, item, card);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  return (
    <div className="sb-pad">
      <p className="sb-caption">Hold Enter or use the context-menu key on the card to open the actions.</p>
      <a href="#sb" ref={cardRef} className="tv-home-card" style={{ width: "16rem" }} {...itemProps(item)}>
        <span className="tv-home-card-art">
          <Art index={0} />
        </span>
        <strong>{FIXTURE_TITLES[0]}</strong>
      </a>
      {contextMenu}
    </div>
  );
}

function Story({ view, hasProgress }: { view: View; hasProgress: boolean }) {
  return (
    <MockApi
      key={`${view}:${hasProgress}`}
      downloads
      handlers={{
        listPlaylists: PLAYLISTS,
        listPlaylistItems: [],
        listWatchProgress: [],
        getWork: { work: fixtureWork(0), children: null },
        getDownloadOptions: { media_file_id: "m", container: "mp4", options: [{ id: "original", label: "Original", profile: null, height: 1080, estimated_size_bytes: 2_000_000_000, size_is_estimate: false }] },
      }}
    >
      <Menu view={view} hasProgress={hasProgress} />
    </MockApi>
  );
}

const meta = {
  title: "Components/Media context menu",
  component: Story,
  tags: ["autodocs"],
  args: { view: "actions", hasProgress: true },
  argTypes: { view: { control: "inline-radio", options: ["closed", "actions", "playlists", "download"] }, hasProgress: { control: "boolean", description: "Part-watched adds the mark-unwatched action" } },
} satisfies Meta<typeof Story>;
export default meta;
type Story_ = StoryObj<typeof meta>;

export const Playground: Story_ = {};
