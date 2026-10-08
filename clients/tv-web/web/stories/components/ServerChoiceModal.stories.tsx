import type { Meta, StoryObj } from "@storybook/react-vite";
import { ServerChoiceModal } from "../../src/components/ServerChoiceModal";
import type { JoinedWorkSource } from "../../src/lib/joinedServers";

const source = (n: number) => ({ url: `https://server-${n}.example.com`, label: `Sample server ${n}`, work: { id: `w${n}`, title: "Test Movie A" } }) as unknown as JoinedWorkSource;

type Args = { count: number; failSelect: boolean; slowSelect: boolean };

function Modal({ count, failSelect, slowSelect }: Args) {
  const sources = Array.from({ length: count }, (_, i) => source(i + 1));
  return (
    <ServerChoiceModal
      key={`${count}:${failSelect}:${slowSelect}`}
      title="Test Movie A"
      sources={sources}
      onCancel={() => undefined}
      onSelect={() => (failSelect ? Promise.reject(new Error("The server could not be reached.")) : slowSelect ? new Promise<void>(() => undefined) : undefined)}
    />
  );
}

const meta = {
  title: "Components/Server choice modal",
  component: Modal,
  tags: ["autodocs"],
  args: { count: 2, failSelect: false, slowSelect: false },
  argTypes: {
    count: { control: { type: "number", min: 1, max: 6 } },
    failSelect: { control: "boolean", description: "Choosing a server shows the error" },
    slowSelect: { control: "boolean", description: "Choosing a server stays on Connecting" },
  },
} satisfies Meta<typeof Modal>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
