import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MultiSelect } from "../../src/components/ui";

const OPTIONS = ["English", "Japanese", "French", "German", "Spanish", "Italian", "Korean", "Thai"].map((label, i) => ({
  value: label.toLowerCase(),
  label,
  hint: String(20 - i),
}));

function Demo({ initial }: { initial: string[] }) {
  const [selected, setSelected] = useState(initial);
  return (
    <div style={{ maxWidth: 320 }}>
      <MultiSelect
        ariaLabel="Languages"
        options={OPTIONS}
        selected={selected}
        onChange={setSelected}
        labels={{
          none: "Any language",
          add: "Add language",
          remove: (name) => `Remove ${name}`,
          announce: (count, shown) => `${count} selected, ${shown} listed`,
        }}
      />
    </div>
  );
}

const meta = {
  title: "Components/Multi select",
  component: Demo,
  tags: ["autodocs"],
  args: { initial: [] as string[] },
} satisfies Meta<typeof Demo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const WithSelection: Story = { args: { initial: ["japanese", "thai"] } };
