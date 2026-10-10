import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SegmentedControl } from "../../src/components/ui/SegmentedControl";

type Size = "small" | "medium" | "large";

function Demo({ initial }: { initial: Size }) {
  const [value, setValue] = useState<Size>(initial);
  return (
    <div className="sb-pad" style={{ maxWidth: 420 }}>
      <SegmentedControl
        ariaLabel="Artwork size"
        value={value}
        onChange={setValue}
        options={[
          { value: "small", label: "Small" },
          { value: "medium", label: "Medium" },
          { value: "large", label: "Large" },
        ]}
      />
    </div>
  );
}

const meta: Meta<typeof Demo> = {
  title: "Components/SegmentedControl",
  component: Demo,
};
export default meta;

type Story = StoryObj<typeof Demo>;

export const Medium: Story = { args: { initial: "medium" } };
export const Large: Story = { args: { initial: "large" } };
