import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ApiClient } from "@playarr-tv/api-client";
import { HouseholdBlockedScreen, HouseholdRemainingChip } from "../../src/components/HouseholdGate";
import { useApiClient } from "../../src/lib/ApiClientProvider";
import { MockApi } from "../mocks/providers";

type Block = "outside_schedule" | "budget_exhausted";

function Blocked({ block, withTime }: { block: Block; withTime: boolean }) {
  const client = useApiClient() as ApiClient;
  const status = {
    state: block,
    restricted: true,
    guardian_for: [],
    next_start_at: withTime && block === "outside_schedule" ? "2026-10-09T16:00:00Z" : null,
    resets_at: withTime && block === "budget_exhausted" ? "2026-10-09T00:00:00Z" : null,
    offline_valid_until: "2026-10-09T00:00:00Z",
    server_time: "2026-10-08T12:00:00Z",
  } as never;
  return <HouseholdBlockedScreen client={client} status={status} onSwitchProfile={() => undefined} />;
}

function Gate({ block, withTime, minutes }: { block: Block; withTime: boolean; minutes: number }) {
  const status = { state: "allowed", restricted: true, guardian_for: [], remaining_seconds: minutes * 60, offline_valid_until: "2026-10-09T00:00:00Z", server_time: "2026-10-08T12:00:00Z" } as never;
  return (
    <MockApi key={`${block}:${withTime}`} handlers={{ createHouseholdApproval: {} }}>
      <Blocked block={block} withTime={withTime} />
      <div className="sb-pad">
        <HouseholdRemainingChip status={status} now={new Date("2026-10-08T12:00:00Z")} />
      </div>
    </MockApi>
  );
}

const meta = {
  title: "Components/Household gate",
  component: Gate,
  tags: ["autodocs"],
  args: { block: "outside_schedule", withTime: true, minutes: 12 },
  argTypes: {
    block: { control: "inline-radio", options: ["outside_schedule", "budget_exhausted"] },
    withTime: { control: "boolean" },
    minutes: { control: { type: "number", min: 1, max: 60 }, description: "Minutes left on the remaining chip" },
  },
} satisfies Meta<typeof Gate>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
