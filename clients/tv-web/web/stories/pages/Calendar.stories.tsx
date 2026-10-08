import { MockApi, json, setMockApi } from "../mockApi";
import { useEffect, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarPage } from "../../src/pages/Calendar";

const SOURCE = { source_instance_id: "00000000-0000-4000-8000-0000000000a1", source_kind: "sonarr", source_name: "Sample Source", arr_id: 1 };
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

function calendar(entriesCount: number, start: string, end: string) {
  const entries = Array.from({ length: entriesCount }, (_, i) => {
    const episode = i % 2 === 0;
    return {
      date: day((i % 12) - 4),
      has_file: i % 3 === 0,
      id: `00000000-0000-4000-8000-00000000c${String(i).padStart(3, "0")}`,
      media_kind: episode ? "episode" : "movie",
      monitored: true,
      release_type: episode ? "air" : "digital",
      sources: [{ ...SOURCE, arr_id: i + 1 }],
      title: episode ? `Sample Series ${(i % 4) + 1}` : `Test Movie ${String.fromCharCode(65 + (i % 6))}`,
      subtitle: episode ? `Sample Episode ${i + 1}` : null,
      season_number: episode ? 1 : null,
      episode_number: episode ? i + 1 : null,
    };
  });
  return { start, end, entries, sources: [{ entry_count: entriesCount, kind: "sonarr", name: "Sample Source", source_instance_id: SOURCE.source_instance_id, status: "ok" }] };
}

/** The real Calendar page over a fixture server. */
function Page({ mode, entries, view }: { mode: "default" | "loading" | "empty" | "error"; entries: number; view: "week" | "month" | "agenda" }) {
  const [key, setKey] = useState(0);
  useEffect(() => {
    setMockApi((url) => {
      if (!url.pathname.endsWith("/calendar")) return undefined;
      if (mode === "loading") return "pending";
      if (mode === "error") return json({ error: "unavailable" }, 500);
      return json(calendar(mode === "empty" ? 0 : entries, url.searchParams.get("start") ?? day(-30), url.searchParams.get("end") ?? day(30)));
    });
    setKey((k) => k + 1);
  }, [mode, entries, view]);
  return (
    <MemoryRouter key={key} initialEntries={[`/calendar?view=${view}`]}>
      <MockApi>
        <CalendarPage />
      </MockApi>
    </MemoryRouter>
  );
}

const meta = {
  title: "Pages/Calendar",
  component: Page,
  args: { mode: "default", entries: 14, view: "week" },
  argTypes: {
    mode: { control: "inline-radio", options: ["default", "loading", "empty", "error"] },
    entries: { control: { type: "number", min: 1, max: 60 } },
    view: { control: "inline-radio", options: ["week", "month", "agenda"] },
  },
} satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
