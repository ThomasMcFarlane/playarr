import { MockApi, json, setMockApi } from "../mockApi";
import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { RemotePairing } from "@playarr-tv/api-client";
import { RemotePad } from "../../src/components/remote/RemotePad";

const SCOPES = ["navigate", "text", "playback", "input"];
const pairing = (scopes: string[]): RemotePairing => ({
  controller_device_id: "00000000-0000-4000-8000-0000000000d1",
  controller_name: "Sample Phone",
  created_ms: 0,
  expires_ms: 4_102_444_800_000,
  id: "00000000-0000-4000-8000-0000000000c2",
  is_controller: true,
  is_target: false,
  scopes,
  status: "active",
  target_device_id: "00000000-0000-4000-8000-0000000000d2",
});

function Pad({ scopes, outcome, targetName }: { scopes: string[]; outcome: "ok" | "offline" | "failed"; targetName: string }) {
  useEffect(() => {
    setMockApi((url) => {
      if (url.pathname.endsWith("/remote/commands") || /\/remote\/pairings\/[^/]+\/commands$/.test(url.pathname)) {
        return outcome === "offline" ? json({ error: "target_offline" }, 409) : json({ command_id: "00000000-0000-4000-8000-0000000000e1" }, 202);
      }
      if (url.pathname.includes("/commands/")) return json({ status: outcome === "failed" ? "failed" : "ok", detail: null });
      return undefined;
    });
  }, [outcome]);
  return (
    <MockApi>
      <div className="sb-pad" style={{ maxWidth: 760 }}>
        <RemotePad pairing={pairing(scopes)} targetName={targetName} />
      </div>
    </MockApi>
  );
}

const meta = {
  title: "Components/Remote pad",
  component: Pad,
  tags: ["autodocs"],
  args: { scopes: SCOPES, outcome: "ok", targetName: "Sample Display" },
  argTypes: {
    scopes: { control: "check", options: SCOPES },
    outcome: { control: "inline-radio", options: ["ok", "offline", "failed"], description: "What pressing a key reports (fixture only)" },
    targetName: { control: "text" },
  },
} satisfies Meta<typeof Pad>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
