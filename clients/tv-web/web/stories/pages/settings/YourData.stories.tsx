import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsSectionLayout } from "../../../src/pages/settings/SettingsSectionLayout";
import { Button } from "../../../src/components/ui";
import { SettingsFrame, type Mode } from "../pageKit";


function Section({ mode, busy, invalid }: { mode: Mode; busy: boolean; invalid: boolean }) {
  void busy;
  void invalid;
  return (
    <SettingsFrame active="Your data" mode={mode}>
      <SettingsSectionLayout>
        <section className="card settings-card settings-card-wide">
          <h3 id="your-data-export">Export</h3>
          <p className="hint">Download a copy of your watch history, watchlist and settings.</p>
          <div className="connection-actions">
            <Button variant="primary" disabled={busy}>{busy ? "Preparing" : "Export"}</Button>
          </div>
          <h3 id="your-data-import">Import</h3>
          <label className="form-label" htmlFor="your-data-file">Choose an export file</label>
          <input id="your-data-file" className="input" type="file" disabled={busy} />
          {invalid ? <p className="error-text" role="alert">That file is not a valid export.</p> : <p className="muted">No file chosen.</p>}
        </section>
      </SettingsSectionLayout>
    </SettingsFrame>
  );
}

const meta = {
  title: "Pages/Settings/YourData",
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
