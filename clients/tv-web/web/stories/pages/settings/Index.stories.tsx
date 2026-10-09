import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsFrame, SETTINGS_SECTIONS, type Mode } from "../pageKit";

function Index({ section, mode }: { section: string; mode: Mode }) {
  return (
    <SettingsFrame active={section} mode={mode}>
      <section className="card settings-card settings-card-wide">
        <p className="muted">The selected section renders here.</p>
      </section>
    </SettingsFrame>
  );
}

const meta = {
  title: "Pages/Settings/Index",
  component: Index,
  tags: ["autodocs"],
  args: { section: "Appearance", mode: "default" },
  argTypes: {
    section: { control: "select", options: SETTINGS_SECTIONS.map(([title]) => title) },
    mode: { control: "inline-radio", options: ["default", "loading", "empty", "error"] },
  },
} satisfies Meta<typeof Index>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
