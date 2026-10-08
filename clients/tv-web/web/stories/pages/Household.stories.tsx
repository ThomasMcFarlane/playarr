import { MockApi, json, setMockApi } from "../mockApi";
import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { HouseholdPage } from "../../src/pages/Household";

const soon = () => new Date(Date.now() + 3_600_000).toISOString();
const approval = (n: number, kind: "purchase" | "install" | "content" | "time") => ({
  bonus_seconds: kind === "time" ? 1800 : 0,
  id: `00000000-0000-4000-8000-0000000000b${n}`,
  kind,
  note: null,
  profile_user_id: "00000000-0000-4000-8000-0000000000a1",
  request_expires_at: soon(),
  requested_at: new Date().toISOString(),
  status: "pending",
  subject: kind === "time" ? "30 more minutes" : "Test Movie A",
  uses: 0,
});

/** The real Household page (guardian approvals and viewing limits) over a fixture server. */
function Page({ mode, restricted, approvals }: { mode: "default" | "loading" | "error"; restricted: boolean; approvals: number }) {
  const [key, setKey] = useState(0);
  useEffect(() => {
    setMockApi((url) => {
      if (!url.pathname.includes("/household/") && !url.pathname.endsWith("/users/profiles")) return undefined;
      if (mode === "loading") return "pending";
      if (mode === "error") return json({ error: "unavailable" }, 500);
      if (url.pathname.endsWith("/household/status")) {
        return json({ guardian_for: ["00000000-0000-4000-8000-0000000000a1"], offline_valid_until: soon(), restricted, server_time: new Date().toISOString(), state: restricted ? "limited" : "open", daily_budget_minutes: 120, remaining_seconds: 5400, max_rating: "PG" });
      }
      if (url.pathname.endsWith("/household/approvals")) {
        return json(Array.from({ length: approvals }, (_, i) => approval(i, (["time", "content", "install", "purchase"] as const)[i % 4]!)));
      }
      if (url.pathname.endsWith("/users/profiles")) return json([{ id: "00000000-0000-4000-8000-0000000000a1", display_name: "Sample Child" }]);
      return undefined;
    });
    setKey((k) => k + 1);
  }, [mode, restricted, approvals]);
  return (
    <MockApi key={key}>
      <HouseholdPage />
    </MockApi>
  );
}

const meta = {
  title: "Pages/Household",
  component: Page,
  args: { mode: "default", restricted: true, approvals: 3 },
  argTypes: {
    mode: { control: "inline-radio", options: ["default", "loading", "error"] },
    restricted: { control: "boolean" },
    approvals: { control: { type: "number", min: 0, max: 8 }, description: "0 shows the empty approvals list" },
  },
} satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
