import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ResumePlan } from "@playarr-tv/api-client";
import { ResumeChooserModal } from "../src/components/ResumeChooserModal";
import { UpdateToast } from "../src/components/UpdateToast";
import { focusOn } from "./fixtures";

const SERIES = "00000000-0000-4000-8000-0000000000a1";
const option = (n: number, kind: "unfinished" | "next_in_series" | "start_over", percent: number) => ({
  episode_id: `00000000-0000-4000-8000-0000000001${n}0`,
  media_file_id: `00000000-0000-4000-8000-0000000002${n}0`,
  episode_number: n,
  season_number: 1,
  kind,
  label: `S01E0${n}`,
  title: `Sample Episode ${n}`,
  duration_ms: 2_700_000,
  position_ms: Math.round(27_000 * percent),
  progress_percent: percent,
  last_watched_at: "2026-10-01T18:00:00Z",
});
const PLAN: ResumePlan = {
  action: "ask",
  ask_reasons: ["multiple_unfinished"],
  needs_choice: true,
  options: [option(2, "unfinished", 40), option(4, "unfinished", 12), option(5, "next_in_series", 0)],
  reason: "choice_required",
  series_work_id: SERIES,
} as unknown as ResumePlan;

function Chooser() {
  return <ResumeChooserModal plan={PLAN} seriesTitle="Sample Series 1" onCancel={() => undefined} onSelect={() => undefined} />;
}

const meta = { title: "Components/Dialog", component: Chooser, tags: ["autodocs"] } satisfies Meta<typeof Chooser>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The modal dialog: a real dialog role, first option focused, Back closes it. */
export const ResumeChooser: Story = { name: "Resume chooser (open)" };
export const ResumeChooserFocus: Story = { name: "Resume chooser (focus)", parameters: focusOn(".resume-chooser-modal button") };

function Toast({ kind }: { kind: "update" | "package" }) {
  return (
    <div className="sb-pad">
      <UpdateToast
        state={{
          updateAvailable: kind === "update",
          mustReload: false,
          packageUpdateRequired: kind === "package",
          dismiss: () => undefined,
          reloadNow: () => undefined,
        }}
      />
    </div>
  );
}

export const UpdateAvailable: Story = { name: "Update toast", render: () => <Toast kind="update" /> };
export const PackageUpdate: Story = { name: "Update toast (reinstall required)", render: () => <Toast kind="package" /> };
