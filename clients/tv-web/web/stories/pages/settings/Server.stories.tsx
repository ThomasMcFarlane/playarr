import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsSectionLayout } from "../../../src/pages/settings/SettingsSectionLayout";
import { Button } from "../../../src/components/ui";
import { SettingsFrame, type Mode } from "../pageKit";


function Section({ mode, busy, invalid }: { mode: Mode; busy: boolean; invalid: boolean }) {
  void busy;
  void invalid;
  return (
    <SettingsFrame active="Server" mode={mode}>
      <SettingsSectionLayout>
        <section className="card settings-card settings-card-wide">
          <ul className="connected-server-list" aria-label="Connected servers">
            <li className="connected-server">
              <div className="connected-server-primary">
                <strong>Home server</strong>
                <span className="connected-server-badge">Connected</span>
              </div>
            </li>
          </ul>
          <form className="connection-form" onSubmit={(e) => e.preventDefault()}>
            <label className="form-label" htmlFor="additional-server-url">Add a server</label>
            <div className="connection-server-fields">
              <input id="additional-server-url" className={`input${invalid ? " is-error" : ""}`} placeholder="https://example.com" disabled={busy} />
              <div className="connection-actions">
                <Button type="submit" variant="primary" disabled={busy}>{busy ? "Connecting" : "Connect"}</Button>
              </div>
            </div>
            {invalid ? <p className="error-text" role="alert">That address could not be reached.</p> : <p className="hint">Enter a server address.</p>}
          </form>
        </section>
      </SettingsSectionLayout>
    </SettingsFrame>
  );
}

const meta = {
  title: "Pages/Settings/Server",
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
