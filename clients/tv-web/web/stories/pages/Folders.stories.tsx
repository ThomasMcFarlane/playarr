import { MockApi, json, setMockApi } from "../mockApi";
import { useEffect, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { FoldersPage } from "../../src/pages/Folders";

const ROOT = {
  available: true,
  id: "00000000-0000-4000-8000-0000000000a1",
  item_count: 24,
  last_scanned_at: null,
  library_kind: "movie",
  name: "Sample Movies",
  scan_status: "ready",
  source_instance_id: "00000000-0000-4000-8000-0000000000a2",
  source_name: "Sample Source",
};

function entries(count: number) {
  return Array.from({ length: count }, (_, i) =>
    i % 3 === 0
      ? { entry_type: "directory", name: `Sample Folder ${i + 1}`, path: `Sample Folder ${i + 1}`, item_count: 6 }
      : { entry_type: "media", name: `Test Movie ${String.fromCharCode(65 + (i % 26))}.mkv`, path: `Test Movie ${i}.mkv`, title: `Test Movie ${String.fromCharCode(65 + (i % 26))}`, media_file_id: `00000000-0000-4000-8000-00000000${String(i).padStart(4, "0")}`, media_kind: "movie", duration_ms: 5_400_000, size_bytes: 3_000_000_000, video_codec: "h264", width: 1920, height: 1080, modified_at: "2026-09-01T10:00:00Z", watch_state: i % 4 === 0 ? "watched" : "unseen" },
  );
}

/** The real Folders page over a fixture server. `mode` chooses what the server answers. */
function Page({ mode, items }: { mode: "default" | "loading" | "no-roots" | "error" | "missing-folder" | "empty-folder"; items: number }) {
  const [key, setKey] = useState(0);
  useEffect(() => {
    setMockApi((url) => {
      if (!url.pathname.includes("/folders/")) return undefined;
      if (mode === "loading") return "pending";
      if (mode === "error") return json({ error: "unavailable" }, 500);
      if (url.pathname.endsWith("/folders/roots")) return json(mode === "no-roots" ? [] : [ROOT]);
      if (mode === "missing-folder") return json({ error: "not_found" }, 404);
      const list = mode === "empty-folder" ? [] : entries(items);
      return json({ breadcrumbs: [], entries: list, limit: 100, offset: 0, path: "", root: ROOT, total: list.length });
    });
    setKey((k) => k + 1);
  }, [mode, items]);
  return (
    <MemoryRouter key={key} initialEntries={[`/folders?root=${ROOT.id}`]}>
      <MockApi>
        <FoldersPage />
      </MockApi>
    </MemoryRouter>
  );
}

const meta = {
  title: "Pages/Folders",
  component: Page,
  args: { mode: "default", items: 18 },
  argTypes: {
    mode: { control: "select", options: ["default", "loading", "no-roots", "error", "missing-folder", "empty-folder"] },
    items: { control: { type: "number", min: 1, max: 100 } },
  },
} satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
