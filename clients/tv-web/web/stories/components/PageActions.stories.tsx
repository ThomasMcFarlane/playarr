import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageActions, ShellActionColumnProvider, type PageAction } from "../../src/components/shell";

const noop = () => undefined;

type Args = { open: boolean; count: number; withNavigation: boolean; withLink: boolean };

function Actions({ open, count, withNavigation, withLink }: Args) {
  const actions: PageAction[] = [
    ...(withNavigation
      ? [
          {
            kind: "navigation" as const,
            id: "period",
            label: "Period",
            items: [
              { id: "prev", label: "Previous", icon: "prev" as const, onSelect: noop },
              { id: "today", label: "Today", onSelect: noop },
              { id: "next", label: "Next", icon: "next" as const, onSelect: noop },
            ],
          },
        ]
      : []),
    { kind: "panel", id: "create", label: "Create", icon: "add", open, onToggle: noop, controls: "sb-create" },
    ...(withLink ? [{ kind: "link" as const, id: "cal", label: "Calendar link", icon: "bell" as const, to: "/" }] : []),
    { kind: "filters", label: "Filters", open, onToggle: noop, controls: "sb-filters", activeCount: count },
  ];
  return (
    <ShellActionColumnProvider>
      <div id="sb-create" hidden />
      <div id="sb-filters" hidden />
      <div className="sb-pad">
        <PageActions actions={actions} />
      </div>
    </ShellActionColumnProvider>
  );
}

const meta = {
  title: "Components/Page actions",
  component: Actions,
  tags: ["autodocs"],
  args: { open: false, count: 2, withNavigation: true, withLink: true },
  argTypes: {
    open: { control: "boolean" },
    count: { control: { type: "number", min: 0, max: 99 } },
    withNavigation: { control: "boolean" },
    withLink: { control: "boolean" },
  },
} satisfies Meta<typeof Actions>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
