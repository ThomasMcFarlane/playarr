import type { Meta, StoryObj } from "@storybook/react-vite";
import { TvEmptyState } from "../../src/components/tv/TvEmptyState";

const GRAPHICS = ["home", "movies", "series", "music", "search", "playlist", "move", "details"] as const;

type Args = {
  title: string;
  description: string;
  graphic: (typeof GRAPHICS)[number];
  tone: "empty" | "error";
  variant: "page" | "rail" | "track" | "compact";
};

function Empty(args: Args) {
  return (
    <div className="sb-pad">
      <TvEmptyState {...args} />
    </div>
  );
}

const meta = {
  title: "Components/TV empty state",
  component: Empty,
  tags: ["autodocs"],
  args: { title: "Nothing here yet", description: "Titles you add appear here.", graphic: "movies", tone: "empty", variant: "page" },
  argTypes: {
    graphic: { control: "select", options: GRAPHICS },
    tone: { control: "inline-radio", options: ["empty", "error"] },
    variant: { control: "inline-radio", options: ["page", "rail", "track", "compact"] },
    title: { control: "text" },
    description: { control: "text" },
  },
} satisfies Meta<typeof Empty>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
