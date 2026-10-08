import type { Meta, StoryObj } from "@storybook/react-vite";
import type { TitleSnapshot } from "@playarr-tv/api-client";
import { RequestButton } from "../../src/components/RequestButton";
import { setMockApi } from "../mocks/ApiClientProvider";

const SNAPSHOT = { kind: "movie", title: "Test Movie A", year: 2020 } as unknown as TitleSnapshot;

type Args = { disabled: boolean; alreadyRequested: boolean; failRequest: boolean };

function Request({ disabled, alreadyRequested, failRequest }: Args) {
  setMockApi({
    requestTitle: () => (failRequest ? Promise.reject(new Error("This title could not be requested.")) : {}),
  });
  return (
    <div className="sb-pad" key={`${disabled}:${alreadyRequested}:${failRequest}`}>
      <RequestButton snapshot={SNAPSHOT} disabled={disabled} alreadyRequested={alreadyRequested} />
    </div>
  );
}

const meta = {
  title: "Components/Request button",
  component: Request,
  tags: ["autodocs"],
  args: { disabled: false, alreadyRequested: false, failRequest: false },
  argTypes: {
    disabled: { control: "boolean" },
    alreadyRequested: { control: "boolean" },
    failRequest: { control: "boolean", description: "Click shows the error state" },
  },
} satisfies Meta<typeof Request>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
