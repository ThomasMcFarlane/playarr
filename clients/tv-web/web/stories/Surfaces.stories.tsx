import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DateRangeField, MasterDetail, SettledAnnouncer } from "../src/components/shell";
import { ProfileAvatar } from "../src/components/ProfileAvatar";
import { LanguageDropdown } from "../src/components/LanguageDropdown";
import { WatchStateOverlay } from "../src/components/WatchStateOverlay";
import { Art, Caption, FIXTURE_TITLES } from "./fixtures";
import type { WatchProgress } from "@playarr-tv/api-client";

const progress = (state: "part_watched" | "unseen", position: number): WatchProgress =>
  ({ state, position_ms: position, duration_ms: 100, work_id: "w", media_file_id: "m" }) as unknown as WatchProgress;

function Surfaces() {
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  return (
    <div className="sb-pad sb-col" style={{ maxWidth: 900 }}>
      <div>
        <Caption>Profile avatars (presets)</Caption>
        <div className="sb-row">
          {(["pirate", "alien"] as const).map((preset) => (
            <span key={preset} style={{ width: "4rem", height: "4rem", display: "inline-block" }}>
              <ProfileAvatar preference={{ kind: "preset", preset } as never} />
            </span>
          ))}
        </div>
      </div>
      <div>
        <Caption>Watch state on card art</Caption>
        <div className="sb-row">
          {[progress("part_watched", 40), progress("unseen", 0)].map((p, i) => (
            <div key={i} className="tv-home-card" style={{ width: "14rem" }}>
              <span className="tv-home-card-art">
                <Art index={i + 2} />
                <WatchStateOverlay progress={p} />
              </span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <Caption>Settled announcer (visually hidden live region, speaks 700 ms after the text settles)</Caption>
        <SettledAnnouncer text="5 Oct – 11 Oct 2026" />
      </div>
      <div>
        <Caption>Date range field</Caption>
        <DateRangeField from={range.from} to={range.to} fromLabel="From" toLabel="To" clearLabel="Clear" onChange={setRange} />
      </div>
      <div>
        <Caption>Language dropdown</Caption>
        <LanguageDropdown />
      </div>
      <div style={{ minHeight: "24rem", position: "relative" }}>
        <Caption>Master and detail</Caption>
        <MasterDetail detailLabel="Details" detail={<><h2>{FIXTURE_TITLES[0]}</h2><p>A fixture synopsis used only to show the details pane.</p></>}>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {FIXTURE_TITLES.slice(0, 5).map((title) => (
              <li key={title}>
                <button type="button" className="ui-btn btn btn-ghost">
                  {title}
                </button>
              </li>
            ))}
          </ul>
        </MasterDetail>
      </div>
    </div>
  );
}

const meta = { title: "Components/Other surfaces", component: Surfaces, tags: ["autodocs"] } satisfies Meta<typeof Surfaces>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
