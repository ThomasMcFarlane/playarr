import type { Meta, StoryObj } from "@storybook/react-vite";
import { CastButton } from "../../src/components/player/CastButton";
import { CastUnavailableError } from "../../src/lib/cast/castSdk";

type Outcome = "ok" | "slow" | "unavailable-browser" | "unavailable-insecure-server" | "error";

function Cast({ available, connected, deviceName, outcome }: { available: boolean; connected: boolean; deviceName: string; outcome: Outcome }) {
  const toggle = () => {
    switch (outcome) {
      case "slow":
        return new Promise<void>((resolve) => setTimeout(resolve, 4000));
      case "unavailable-browser":
        return Promise.reject(new CastUnavailableError("unsupported-browser" as never));
      case "unavailable-insecure-server":
        return Promise.reject(new CastUnavailableError("insecure-server" as never));
      case "error":
        return Promise.reject(new Error("fixture failure"));
      default:
        return Promise.resolve();
    }
  };
  return (
    <div className="sb-pad player-surface" style={{ position: "relative", background: "#000", minHeight: "40vh" }}>
      <div className="player-controls" style={{ position: "static", opacity: 1 }}>
        <CastButton available={available} connected={connected} deviceName={deviceName} onToggleCast={toggle} />
      </div>
    </div>
  );
}

const meta = {
  title: "Components/Cast button",
  component: Cast,
  tags: ["autodocs"],
  args: { available: true, connected: false, deviceName: "Living room display", outcome: "ok" },
  argTypes: {
    available: { control: "boolean", description: "false renders nothing" },
    connected: { control: "boolean" },
    deviceName: { control: "text" },
    outcome: { control: "select", options: ["ok", "slow", "unavailable-browser", "unavailable-insecure-server", "error"], description: "What clicking does: slow shows the connecting state, the rest show the inline error" },
  },
} satisfies Meta<typeof Cast>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
