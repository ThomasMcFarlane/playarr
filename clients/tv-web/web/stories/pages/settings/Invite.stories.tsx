import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsSectionLayout } from "../../../src/pages/settings/SettingsSectionLayout";
import { Button } from "../../../src/components/ui";
import { SettingsFrame, type Mode } from "../pageKit";


function Section({ mode, busy, invalid }: { mode: Mode; busy: boolean; invalid: boolean }) {
  void busy;
  void invalid;
  return (
    <SettingsFrame active="Invite" mode={mode}>
      <SettingsSectionLayout>
        <section className="card settings-card settings-card-wide">
          <p className="hint">Create a link that lets a friend join this server.</p>
          <label className="form-label" htmlFor="friend-invite-message">Message</label>
          <input id="friend-invite-message" className="input" defaultValue="Join my server" disabled={busy} />
          <label className="form-label" htmlFor="friend-invite-link">Invite link</label>
          <input id="friend-invite-link" className="input" readOnly value="https://example.com/invite/sample" />
          <div className="connection-actions">
            <Button variant="primary" disabled={busy}>{busy ? "Creating" : "Create invite"}</Button>
            <Button disabled={busy}>Copy link</Button>
          </div>
          {invalid ? <p className="error-text" role="alert">The invite could not be created.</p> : null}
        </section>
      </SettingsSectionLayout>
    </SettingsFrame>
  );
}

const meta = {
  title: "Pages/Settings/Invite",
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
