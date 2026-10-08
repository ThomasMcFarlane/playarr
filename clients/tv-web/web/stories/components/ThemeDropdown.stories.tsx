import type { Meta, StoryObj } from "@storybook/react-vite";
import { ThemeDropdown } from "../../src/components/ThemeDropdown";
import type { ThemePreference } from "../../src/lib/theme";
import { LocalTheme } from "../mocks/providers";

function Dropdown({ preference }: { preference: ThemePreference }) {
  return (
    <div className="sb-pad" style={{ minHeight: "16rem" }} key={preference}>
      <LocalTheme initial={preference}>
        <ThemeDropdown />
      </LocalTheme>
    </div>
  );
}

const meta = {
  title: "Components/Theme dropdown",
  component: Dropdown,
  tags: ["autodocs"],
  args: { preference: "system" },
  argTypes: { preference: { control: "inline-radio", options: ["system", "light", "dark"] } },
} satisfies Meta<typeof Dropdown>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Click the trigger to see the open menu. */
export const Playground: Story = {};
