import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarLink } from "../../src/components/CalendarLink";
import { MockApi, never } from "../mocks/providers";

type Mode = "link" | "needs-reset" | "loading" | "error";

function Link({ mode }: { mode: Mode }) {
  try {
    window.localStorage.removeItem("playarr.calendarLink");
  } catch {
    /* storage unavailable */
  }
  const created = { url: "https://server.example.com/api/v1/calendar/feed/sample-token.ics", token: "sample-token", created_at: "2026-10-01T10:00:00Z" };
  const handlers =
    mode === "link"
      ? { getCalendarFeed: { active: true, link_available: true }, createCalendarFeed: created }
      : mode === "needs-reset"
        ? { getCalendarFeed: { active: true, link_available: false }, createCalendarFeed: created }
        : mode === "loading"
          ? { getCalendarFeed: never }
          : { getCalendarFeed: () => Promise.reject(new Error("fixture")) };
  return (
    <MockApi key={mode} handlers={handlers}>
      <div className="sb-pad" style={{ maxWidth: 760 }}>
        <CalendarLink />
      </div>
    </MockApi>
  );
}

const meta = {
  title: "Components/Calendar link",
  component: Link,
  tags: ["autodocs"],
  args: { mode: "link" },
  argTypes: { mode: { control: "inline-radio", options: ["link", "needs-reset", "loading", "error"] } },
} satisfies Meta<typeof Link>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
