import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageHeader, ShellActionColumnProvider, type PageAction } from "../src/components/shell";

const noop = () => undefined;

const ACTIONS: PageAction[] = [
  { kind: "panel", id: "create", label: "Create", icon: "add", open: false, onToggle: noop, controls: "create-panel" },
  { kind: "filters", label: "Filters", open: false, onToggle: noop, controls: "filters-panel", activeCount: 2 },
];

function Header({ variant, withActions, open }: { variant: "page" | "detail"; withActions: boolean; open?: boolean }) {
  const actions = withActions ? ACTIONS.map((a) => (a.kind === "filters" || a.kind === "panel" ? { ...a, open: Boolean(open) } : a)) : undefined;
  return (
    <ShellActionColumnProvider>
      <div id="create-panel" hidden />
      <div id="filters-panel" hidden />
      <PageHeader
        title={variant === "detail" ? "Details" : "Movies"}
        detail={variant === "detail" ? "Test Movie A" : "128 titles"}
        variant={variant}
        back={{ label: "Back", to: "/" }}
        actions={actions}
      />
    </ShellActionColumnProvider>
  );
}

const meta = {
  title: "Components/Header",
  component: Header,
  tags: ["autodocs"],
  args: { variant: "page", withActions: true, open: false },
  argTypes: { variant: { control: "inline-radio", options: ["page", "detail"] }, withActions: { control: "boolean" }, open: { control: "boolean" } },
} satisfies Meta<typeof Header>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
/** A detail header differs in structure (no actions), so it keeps its own story. */
export const Detail: Story = { args: { variant: "detail", withActions: false } };
