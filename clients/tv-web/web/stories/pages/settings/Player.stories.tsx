import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsSectionLayout } from "../../../src/pages/settings/SettingsSectionLayout";
import { Button } from "../../../src/components/ui";
import { SettingsFrame, type Mode } from "../pageKit";


function Section({ mode, busy, invalid }: { mode: Mode; busy: boolean; invalid: boolean }) {
  void busy;
  void invalid;
  return (
    <SettingsFrame active="Player" mode={mode}>
      <SettingsSectionLayout>
        <section className="card settings-card settings-card-wide">
          <div className="player-default-group">
            <div className="player-default-heading">
              <h3>Subtitles</h3>
              <p>What to show when playback starts.</p>
            </div>
            <div className="player-default-choice" role="radiogroup" aria-label="Subtitles">
              {["Off", "Forced only", "Always"].map((label, i) => (
                <button key={label} type="button" role="radio" className={`player-default-button${i === 1 ? " is-active" : ""}`} aria-checked={i === 1} disabled={busy}>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="player-default-group">
            <div className="player-default-heading">
              <h3>Audio language</h3>
            </div>
            <div className="player-language-choice" role="radiogroup" aria-label="Audio language">
              {["Original", "English", "Spanish"].map((label, i) => (
                <button key={label} type="button" role="radio" className={`player-language-button${i === 0 ? " is-active" : ""}`} aria-checked={i === 0} disabled={busy}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>
      </SettingsSectionLayout>
    </SettingsFrame>
  );
}

const meta = {
  title: "Pages/Settings/Player",
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
