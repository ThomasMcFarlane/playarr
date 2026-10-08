import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsSectionLayout } from "../../../src/pages/settings/SettingsSectionLayout";
import { SettingsFrame, type Mode } from "../pageKit";


function Section({ mode, saving, locked }: { mode: Mode; saving: boolean; locked: boolean }) {
  void saving;
  void locked;
  return (
    <SettingsFrame active="Appearance" mode={mode}>
      <SettingsSectionLayout>
        <section className="card settings-card settings-card-wide">
          <div className="appearance-setting">
            <div className="appearance-setting-heading">
              <h3>Colour theme</h3>
            </div>
            <div className="theme-choice" role="group" aria-label="Colour theme">
              {["system", "light", "dark"].map((o, i) => (
                <button key={o} type="button" className={`theme-choice-button${i === 2 ? " is-active" : ""}`} aria-pressed={i === 2}>
                  {o}
                </button>
              ))}
            </div>
          </div>
          <div className="appearance-setting">
            <div className="appearance-setting-heading">
              <h3>Home view</h3>
              <p>Show thumbnails or cover art on Home.</p>
            </div>
            <div className="theme-choice home-view-choice" role="group" aria-label="Home view">
              {["Thumbnail", "Cover"].map((o, i) => (
                <button key={o} type="button" className={`theme-choice-button${i === 0 ? " is-active" : ""}`} aria-pressed={i === 0}>
                  {o}
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
  title: "Pages/Settings/Appearance",
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
