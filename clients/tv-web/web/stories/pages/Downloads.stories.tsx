import { MockApi } from "../mockApi";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DownloadsProvider } from "../../src/lib/DownloadsProvider";
import { DownloadsPage } from "../../src/pages/Downloads";

/**
 * The real Downloads page inside the real downloads provider. Downloads live in the browser's own storage, so the
 * story starts empty (no records) and the server answers every request with a fixture 404.
 */
function Page() {
  return (
    <MockApi>
      <DownloadsProvider>
        <DownloadsPage />
      </DownloadsProvider>
    </MockApi>
  );
}

const meta = { title: "Pages/Downloads", component: Page } satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
