import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsSectionLayout } from "../../../src/pages/settings/SettingsSectionLayout";
import { SettingsFrame, type Mode } from "../pageKit";
import { Button } from "../../../src/components/ui";

function Section({ mode, saving, locked }: { mode: Mode; saving: boolean; locked: boolean }) {
  void saving;
  void locked;
  return (
    <SettingsFrame active="Profile lock" mode={mode}>
      <SettingsSectionLayout>
        <section className="card settings-card settings-card-wide">
          <form className="profile-pin-settings" onSubmit={(e) => e.preventDefault()}>
            <label className="form-label" htmlFor="profile-lock-pin">
              {locked ? "Replace PIN" : "New PIN"}
            </label>
            <div className="connection-form-row">
              <input id="profile-lock-pin" type="password" className="input" inputMode="numeric" maxLength={4} placeholder="••••" disabled={saving} />
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving" : locked ? "Replace" : "Set PIN"}
              </Button>
            </div>
          </form>
          <div className="profile-pin-settings-status" aria-live="polite">
            <p className="muted">{locked ? "This profile is locked with a PIN." : "This profile has no PIN."}</p>
            {locked ? (
              <Button type="button" size="sm">
                Remove PIN
              </Button>
            ) : null}
          </div>
        </section>
      </SettingsSectionLayout>
    </SettingsFrame>
  );
}

const meta = {
  title: "Pages/Settings/Profile lock",
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
