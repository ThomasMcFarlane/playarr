import type { Meta, StoryObj } from "@storybook/react-vite";
import { ThemeToggle } from "../../src/components/ThemeToggle";
import { ThemeDropdown } from "../../src/components/ThemeDropdown";
import type { ThemePreference } from "../../src/lib/theme";
import { LocalTheme } from "../mocks/providers";

function Toggle({ preference }: { preference: ThemePreference }) {
  return (
    <div className="sb-pad sb-row" key={preference}>
      <LocalTheme initial={preference}>
        <ThemeToggle />
        <ThemeDropdown />
      </LocalTheme>
    </div>
  );
}

const meta = {
  title: "Components/Theme toggle",
  component: Toggle,
  tags: ["autodocs"],
  args: { preference: "dark" },
  argTypes: { preference: { control: "inline-radio", options: ["system", "light", "dark"] } },
} satisfies Meta<typeof Toggle>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
