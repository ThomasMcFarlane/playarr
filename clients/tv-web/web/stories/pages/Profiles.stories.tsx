import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { ProfileAvatar } from "../../src/components/ProfileAvatar";
import { TvStageChrome } from "../../src/components/tv/TvStage";

const NAMES = ["Sample Profile 1", "Sample Profile 2", "Sample Profile 3", "Sample Profile 4"];

type Mode = "default" | "loading" | "empty" | "error";

function Profiles({ mode, count, selected }: { mode: Mode; count: number; selected: number }) {
  const profiles = mode === "empty" ? [] : NAMES.slice(0, count);
  return (
    <div className="profiles-page">
      <TvStageChrome />
      <header className="profiles-heading">
        <p>Profiles</p>
        <h1>Who is watching?</h1>
      </header>
      {mode === "loading" ? <p className="profiles-status" role="status">Loading profiles</p> : null}
      {mode === "error" ? <p className="profiles-status is-error" role="alert">Profiles could not be loaded.</p> : null}
      <div className="profiles-row">
        <div className="profiles-track">
          {mode === "loading" || mode === "error"
            ? null
            : profiles.map((name, index) => (
                <div key={name} className={`profile-choice${index === selected ? " is-selected" : ""}`} style={{ "--profile-index": index } as CSSProperties}>
                  <button type="button" className="profile-avatar-button" aria-pressed={index === selected}>
                    <ProfileAvatar className="profile-avatar" preference={{ kind: "preset", preset: index % 2 ? "alien" : "pirate" } as never} />
                    <strong>{name}</strong>
                    <small>{index === 0 ? "Current" : "Ready"}</small>
                  </button>
                  {index === selected ? (
                    <div className="profile-actions">
                      <button type="button" className="profile-action-button profile-settings-button" aria-label={`Settings for ${name}`}>⚙</button>
                      <button type="button" className="profile-action-button profile-sign-out-button" aria-label={`Sign out ${name}`}><strong>Sign out</strong></button>
                    </div>
                  ) : null}
                </div>
              ))}
          <div className="profile-choice profile-add" style={{ "--profile-index": profiles.length } as CSSProperties}>
            <button type="button" className="profile-avatar-button" aria-label="Add a profile">
              <span className="profile-avatar" aria-hidden="true">+</span>
              <strong>Add profile</strong>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Pages/Profiles",
  component: Profiles,
  tags: ["autodocs"],
  args: { mode: "default", count: 3, selected: 0 },
  argTypes: { mode: { control: "inline-radio", options: ["default", "loading", "empty", "error"] }, count: { control: { type: "number", min: 1, max: 4 } }, selected: { control: { type: "number", min: 0, max: 3 } } },
} satisfies Meta<typeof Profiles>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
