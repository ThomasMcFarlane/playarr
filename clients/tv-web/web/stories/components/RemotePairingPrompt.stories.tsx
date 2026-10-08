import type { Meta, StoryObj } from "@storybook/react-vite";
import { RemotePairingPrompt } from "../../src/components/remote/RemotePairingPrompt";

function Prompt({ scopes, slow, code }: { scopes: string[]; slow: boolean; code: string }) {
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, slow ? 4000 : 0));
  return (
    <div style={{ minHeight: "60vh" }}>
      <RemotePairingPrompt
        request={{ pairingId: "00000000-0000-4000-8000-0000000000c1", controllerName: "Sample Phone", verificationCode: code, scopes }}
        onAllow={settle}
        onDeny={settle}
      />
    </div>
  );
}

const SCOPES = ["navigate", "text", "playback", "input"];
const meta = {
  title: "Components/Remote pairing prompt",
  component: Prompt,
  tags: ["autodocs"],
  args: { scopes: SCOPES, slow: false, code: "482915" },
  argTypes: {
    scopes: { control: "check", options: SCOPES },
    slow: { control: "boolean", description: "Allow and Deny stay busy for a few seconds" },
    code: { control: "text" },
  },
} satisfies Meta<typeof Prompt>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
