import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActionPill, ShellActionColumnProvider } from "../src/components/shell";
import { focusOn } from "./fixtures";

/** The shell-owned right-hand column: pages register their panel buttons, they never position them. */
function Column({ open }: { open?: boolean }) {
  return (
    <div style={{ position: "relative", minHeight: "70vh" }}>
      <ShellActionColumnProvider>
        <div id="filters-panel" hidden />
        <div className="page-header-stack">
          <ActionPill icon="add" label="Create" onClick={() => undefined} />
          <ActionPill icon="filters" label="Filters" active={open} count={open ? 3 : 0} onClick={() => undefined} controls="filters-panel" />
        </div>
      </ShellActionColumnProvider>
    </div>
  );
}

const meta = { title: "Components/Shell action column", component: Column, tags: ["autodocs"] } satisfies Meta<typeof Column>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Focus: Story = { parameters: focusOn(".action-pill") };
export const Open: Story = { args: { open: true } };
