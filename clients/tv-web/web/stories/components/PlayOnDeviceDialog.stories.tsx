import { MockApi, json, setMockApi } from "../mockApi";
import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlayOnDeviceDialog } from "../../src/components/remote/PlayOnDeviceDialog";

const target = (n: number, name: string, online = true) => ({
  capabilities: ["handoff", "navigate"],
  device_id: `00000000-0000-4000-8000-0000000000f${n}`,
  is_self: n === 0,
  name,
  online,
  platform: n === 0 ? "web" : "tv-webos",
});

function Dialog({ mode, devices }: { mode: "list" | "loading" | "none" | "error"; devices: number }) {
  const [key, setKey] = useState(0);
  useEffect(() => {
    setMockApi((url) => {
      if (!url.pathname.endsWith("/remote/targets")) return undefined;
      if (mode === "loading") return "pending";
      if (mode === "error") return json({ error: "unavailable" }, 500);
      const others = mode === "none" ? [] : Array.from({ length: devices }, (_, i) => target(i + 1, `Sample Display ${i + 1}`));
      return json([target(0, "This browser"), ...others]);
    });
    setKey((k) => k + 1);
  }, [mode, devices]);
  return (
    <MockApi>
      <PlayOnDeviceDialog key={key} onClose={() => undefined} />
    </MockApi>
  );
}

const meta = {
  title: "Components/Play on device dialog",
  component: Dialog,
  tags: ["autodocs"],
  args: { mode: "list", devices: 3 },
  argTypes: {
    mode: { control: "inline-radio", options: ["list", "loading", "none", "error"] },
    devices: { control: { type: "number", min: 1, max: 8 } },
  },
} satisfies Meta<typeof Dialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
