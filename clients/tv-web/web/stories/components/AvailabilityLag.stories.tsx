import type { Meta, StoryObj } from "@storybook/react-vite";
import { AvailabilityLagNote } from "../../src/components/AvailabilityLag";
import { MockApi, never } from "../mocks/providers";

type Mode = "average" | "no-data" | "loading" | "error";

function Lag({ mode, samples, backfill }: { mode: Mode; samples: number; backfill: number }) {
  const lag = {
    average_seconds: mode === "no-data" ? null : 93_600,
    sample_count: samples,
    backfill_count: backfill,
    unknown_count: 0,
    backfill_threshold_days: 14,
    average_grab_seconds: null,
    samples: [],
  };
  const handler = mode === "loading" ? never : mode === "error" ? () => Promise.reject(new Error("fixture")) : lag;
  return (
    <MockApi key={`${mode}:${samples}:${backfill}`} handlers={{ getAvailabilityLag: handler }}>
      <div className="sb-pad">
        <AvailabilityLagNote workId="00000000-0000-4000-8000-0000000000a1" />
        {mode === "loading" || mode === "error" ? <p className="sb-caption">Renders nothing while loading or on error, by design.</p> : null}
      </div>
    </MockApi>
  );
}

const meta = {
  title: "Components/Availability lag",
  component: Lag,
  tags: ["autodocs"],
  args: { mode: "average", samples: 12, backfill: 0 },
  argTypes: {
    mode: { control: "inline-radio", options: ["average", "no-data", "loading", "error"] },
    samples: { control: { type: "number", min: 0, max: 99 } },
    backfill: { control: { type: "number", min: 0, max: 20 } },
  },
} satisfies Meta<typeof Lag>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
