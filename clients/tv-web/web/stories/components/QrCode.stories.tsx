import type { Meta, StoryObj } from "@storybook/react-vite";
import { QrCode } from "../../src/components/QrCode";

const meta = {
  title: "Components/QR code",
  component: QrCode,
  tags: ["autodocs"],
  args: { value: "https://example.com/link?code=SAMPLE", size: 240, label: "Scan to sign in" },
  argTypes: {
    value: { control: "text" },
    size: { control: { type: "range", min: 96, max: 480, step: 8 } },
    label: { control: "text" },
  },
  render: (args) => (
    <div className="sb-pad">
      <QrCode {...args} />
    </div>
  ),
} satisfies Meta<typeof QrCode>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
