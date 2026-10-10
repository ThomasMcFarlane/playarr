import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SegmentedControl } from "../../src/components/ui";

function Demo({ count }: { count: 2 | 3 | 4 }) {
  const all = ["First", "Second", "Third", "Fourth"].slice(0, count).map((label) => ({ value: label, label }));
  const [value, setValue] = useState("First");
  return <SegmentedControl ariaLabel="Example" options={all} value={value} onChange={setValue} />;
}

const meta = {
  title: "Components/Segmented control",
  component: Demo,
  tags: ["autodocs"],
  args: { count: 3 },
  argTypes: { count: { control: "inline-radio", options: [2, 3, 4] } },
} satisfies Meta<typeof Demo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
