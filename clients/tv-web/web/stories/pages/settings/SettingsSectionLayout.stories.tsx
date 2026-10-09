import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsSectionLayout } from "../../../src/pages/settings/SettingsSectionLayout";
import { SettingsFrame, type Mode } from "../pageKit";

function Layout({ mode }: { mode: Mode }) {
  return (
    <SettingsFrame active="Appearance" mode={mode}>
      <SettingsSectionLayout>
        <section className="card settings-card settings-card-wide">
          <p className="muted">Section content sits in a card beneath the heading.</p>
        </section>
      </SettingsSectionLayout>
    </SettingsFrame>
  );
}

const meta = {
  title: "Pages/Settings/SettingsSectionLayout",
  component: Layout,
  tags: ["autodocs"],
  args: { mode: "default" },
  argTypes: { mode: { control: "inline-radio", options: ["default", "loading", "empty", "error"] } },
} satisfies Meta<typeof Layout>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
