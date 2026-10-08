import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Work } from "@playarr-tv/api-client";
import { WorkCard } from "../../src/components/WorkCard";
import { DownloadsProvider } from "../../src/lib/DownloadsProvider";
import { ToastProvider } from "../../src/lib/toast";
import { FIXTURE_TITLES } from "../fixtures";

const work = (n: number, kind: string) =>
  ({ id: `00000000-0000-4000-8000-00000000000${n}`, kind, title: FIXTURE_TITLES[n], release_date: "2020-05-01T00:00:00Z", images: [] }) as unknown as Work;

function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <DownloadsProvider>{children}</DownloadsProvider>
    </ToastProvider>
  );
}

function Card({ kind, count }: { kind: "movie" | "series"; count: number }) {
  return (
    <Providers>
      <ul className="sb-pad sb-row" style={{ listStyle: "none", margin: 0, alignItems: "flex-start" }}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} style={{ width: "12rem" }}>
            <WorkCard work={work(i, kind)} />
          </div>
        ))}
      </ul>
    </Providers>
  );
}

const meta = {
  title: "Components/Work card",
  component: Card,
  tags: ["autodocs"],
  args: { kind: "movie", count: 4 },
  argTypes: { kind: { control: "inline-radio", options: ["movie", "series"] }, count: { control: { type: "number", min: 1, max: 8 } } },
} satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Fixture works have no artwork, so the poster placeholder shows. */
export const Playground: Story = {};
