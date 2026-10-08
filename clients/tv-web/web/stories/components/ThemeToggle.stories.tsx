import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ThemeToggle } from "../../src/components/ThemeToggle";
import { ThemeDropdown } from "../../src/components/ThemeDropdown";
import { ThemeContext } from "../../src/lib/theme";
import type { ThemePreference } from "../../src/lib/theme";

/** A local theme context: the real provider would rewrite the document theme and fight the Storybook toolbar. */
export function LocalTheme({ initial, children }: { initial: ThemePreference; children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(initial);
  const resolvedTheme = preference === "system" ? "dark" : preference;
  return (
    <ThemeContext.Provider value={{ preference, resolvedTheme, setPreference, toggleTheme: () => setPreference(resolvedTheme === "dark" ? "light" : "dark") }}>
      {children}
    </ThemeContext.Provider>
  );
}

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
