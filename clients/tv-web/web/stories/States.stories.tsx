import type { Meta, StoryObj } from "@storybook/react-vite";
import { EmptyState, ErrorState, SkeletonState } from "../src/components/shell";
import { Caption, focusOn } from "./fixtures";

function States({ kind }: { kind: "empty" | "error" | "loading" | "retry" }) {
  return (
    <div className="sb-pad sb-col">
      {kind === "empty" ? (
        <>
          <Caption>Page empty state</Caption>
          <EmptyState title="Nothing here yet" description="Add something to see it listed." graphic="movies" />
          <Caption>Compact empty state</Caption>
          <EmptyState variant="compact" title="No results" />
        </>
      ) : null}
      {kind === "error" ? (
        <>
          <Caption>Page error state</Caption>
          <ErrorState title="This page could not be loaded" description="Check the connection and try again." />
        </>
      ) : null}
      {kind === "retry" ? (
        <>
          <Caption>Page error state with Retry (D-pad reachable)</Caption>
          <ErrorState title="This page could not be loaded" description="Check the connection and try again." onRetry={() => undefined} retryLabel="Try again" />
        </>
      ) : null}
      {kind === "loading" ? (
        <>
          <Caption>Loading state</Caption>
          <SkeletonState kind="rows" label="Loading" />
        </>
      ) : null}
    </div>
  );
}

const meta = { title: "Components/Empty and error states", component: States, tags: ["autodocs"] } satisfies Meta<typeof States>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { args: { kind: "empty" } };
export const ErrorState_: Story = { name: "Error", args: { kind: "error" } };
export const ErrorWithRetry: Story = { args: { kind: "retry" } };
export const FocusRetry: Story = { args: { kind: "retry" }, parameters: focusOn(".error-state button") };
export const Loading: Story = { args: { kind: "loading" } };
