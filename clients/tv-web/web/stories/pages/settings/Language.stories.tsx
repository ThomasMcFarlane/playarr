import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsSectionLayout } from "../../../src/pages/settings/SettingsSectionLayout";
import { SettingsFrame, type Mode } from "../pageKit";
import { LanguageDropdown } from "../../../src/components/LanguageDropdown";

function Section({ mode, saving, locked }: { mode: Mode; saving: boolean; locked: boolean }) {
  void saving;
  void locked;
  return (
    <SettingsFrame active="Language" mode={mode}>
      <SettingsSectionLayout>
        <section className="card settings-card settings-card-wide">
          <p className="hint">Playarr follows the language detected from this device unless you choose one.</p>
          <LanguageDropdown />
        </section>
      </SettingsSectionLayout>
    </SettingsFrame>
  );
}

const meta = {
  title: "Pages/Settings/Language",
  component: Section,
  tags: ["autodocs"],
  args: { mode: "default", saving: false, locked: false },
  argTypes: {
    mode: { control: "inline-radio", options: ["default", "loading", "empty", "error"] },
    saving: { control: "boolean" },
    locked: { control: "boolean" },
  },
} satisfies Meta<typeof Section>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
