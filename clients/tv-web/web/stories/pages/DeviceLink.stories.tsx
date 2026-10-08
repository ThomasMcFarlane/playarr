import { MockApi, json, setMockApi } from "../mockApi";
import { useEffect, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DeviceLinkPage } from "../../src/pages/DeviceLink";

/** The real device-link page. `outcome` is what approving the code does on the (fixture) server. */
function Page({ code, outcome }: { code: string; outcome: "ok" | "rejected" | "pending" }) {
  const [key, setKey] = useState(0);
  useEffect(() => {
    setMockApi((url) => {
      if (!url.pathname.endsWith("/oauth/device/authorize")) return undefined;
      if (outcome === "pending") return "pending";
      return outcome === "ok" ? new Response(null, { status: 204 }) : json({ error: "invalid_grant" }, 400);
    });
    setKey((k) => k + 1);
  }, [outcome, code]);
  return (
    <MemoryRouter key={key} initialEntries={[`/link${code ? `?user_code=${encodeURIComponent(code)}` : ""}`]}>
      <MockApi>
        <DeviceLinkPage />
      </MockApi>
    </MemoryRouter>
  );
}

const meta = {
  title: "Pages/DeviceLink",
  component: Page,
  args: { code: "", outcome: "ok" },
  argTypes: {
    code: { control: "text", description: "Prefilled user code, for example ABCD-EFGH" },
    outcome: { control: "inline-radio", options: ["ok", "rejected", "pending"], description: "Result of pressing Link" },
  },
} satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
