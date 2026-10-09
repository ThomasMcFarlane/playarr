import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsSectionLayout } from "../../../src/pages/settings/SettingsSectionLayout";
import { Button } from "../../../src/components/ui";
import { SettingsFrame, type Mode } from "../pageKit";
import { ProfileAvatar } from "../../../src/components/ProfileAvatar";

function Section({ mode, busy, invalid }: { mode: Mode; busy: boolean; invalid: boolean }) {
  void busy;
  void invalid;
  return (
    <SettingsFrame active="Profile avatar" mode={mode}>
      <SettingsSectionLayout>
        <section className="card settings-card settings-card-wide">
          <div className="profile-avatar-preset-grid" role="group" aria-label="Avatar">
            {["pirate", "alien"].map((preset, i) => (
              <button key={preset} type="button" className={`profile-avatar-preset${i === 0 ? " is-active" : ""}`} aria-label={preset} aria-pressed={i === 0} disabled={busy}>
                <ProfileAvatar preference={{ kind: "preset", preset } as never} />
              </button>
            ))}
          </div>
          <label className="profile-avatar-upload">
            <span className="muted">Upload a picture</span>
            <input className="profile-avatar-upload-input" type="file" accept="image/*" disabled={busy} />
          </label>
          {invalid ? <p className="error-text" role="alert">That picture could not be used.</p> : null}
        </section>
      </SettingsSectionLayout>
    </SettingsFrame>
  );
}

const meta = {
  title: "Pages/Settings/ProfileAvatar",
  component: Section,
  tags: ["autodocs"],
  args: { mode: "default", busy: false, invalid: false },
  argTypes: {
    mode: { control: "inline-radio", options: ["default", "loading", "empty", "error"] },
    busy: { control: "boolean", description: "Saving or working" },
    invalid: { control: "boolean", description: "Show the field error" },
  },
} satisfies Meta<typeof Section>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
