import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsSectionLayout } from "../../../src/pages/settings/SettingsSectionLayout";
import { Button } from "../../../src/components/ui";
import { SettingsFrame, type Mode } from "../pageKit";


function Section({ mode, busy, invalid }: { mode: Mode; busy: boolean; invalid: boolean }) {
  void busy;
  void invalid;
  return (
    <SettingsFrame active="Remote" mode={mode}>
      <SettingsSectionLayout>
        <section className="card settings-card settings-card-wide">
          <p className="hint">Devices that can be controlled from this one.</p>
          {["Living room", "Bedroom"].map((name) => (
            <div className="remote-pairing-row" key={name}>
              <div>
                <strong>{name}</strong>
                <p className="muted remote-pairing-meta">Paired, online</p>
              </div>
              <div className="remote-pairing-actions">
                <Button size="sm" disabled={busy}>Rename</Button>
                <Button size="sm" variant="danger" disabled={busy}>Unpair</Button>
              </div>
            </div>
          ))}
          {invalid ? <p className="error-text" role="alert">The device could not be reached.</p> : null}
        </section>
      </SettingsSectionLayout>
    </SettingsFrame>
  );
}

const meta = {
  title: "Pages/Settings/Remote",
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
