import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsSectionLayout } from "../../../src/pages/settings/SettingsSectionLayout";
import { Button } from "../../../src/components/ui";
import { SettingsFrame, type Mode } from "../pageKit";


function Section({ mode, busy, invalid }: { mode: Mode; busy: boolean; invalid: boolean }) {
  void busy;
  void invalid;
  return (
    <SettingsFrame active="Home" mode={mode}>
      <SettingsSectionLayout>
        <section className="card settings-card settings-card-wide">
          <ul className="tv-home-customise-list">
            {["Continue watching", "Recently added", "Watchlist", "Upcoming"].map((title, i) => (
              <li key={title} className={i === 3 ? "is-hidden" : undefined}>
                <span className="tv-home-customise-title">{title}</span>
                <Button size="sm" aria-pressed={i !== 3} disabled={busy}>
                  {i === 3 ? "Show" : "Hide"}
                </Button>
                <Button size="sm" disabled={i === 0 || busy} aria-label={`Move ${title} up`}>
                  ↑
                </Button>
                <Button size="sm" disabled={i === 3 || busy} aria-label={`Move ${title} down`}>
                  ↓
                </Button>
              </li>
            ))}
          </ul>
          <div className="tv-home-customise-actions">
            <Button disabled={busy}>Reset to default</Button>
          </div>
        </section>
      </SettingsSectionLayout>
    </SettingsFrame>
  );
}

const meta = {
  title: "Pages/Settings/Home",
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
