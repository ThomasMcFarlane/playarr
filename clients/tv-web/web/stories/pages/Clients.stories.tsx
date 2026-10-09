import { MockApi } from "../mockApi";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ClientsPage } from "../../src/pages/Clients";

/** The real Clients page (a static catalogue of apps); the server release lookup is answered with a 404 fixture. */
function Page() {
  return (
    <MockApi>
      <ClientsPage />
    </MockApi>
  );
}

const meta = { title: "Pages/Clients", component: Page } satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
