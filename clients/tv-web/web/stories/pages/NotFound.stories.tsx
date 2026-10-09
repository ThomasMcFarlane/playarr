import type { Meta, StoryObj } from "@storybook/react-vite";
import { NotFoundPage } from "../../src/pages/NotFound";

const meta = { title: "Pages/NotFound", component: NotFoundPage, tags: ["autodocs"] } satisfies Meta<typeof NotFoundPage>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The real catch-all page. */
export const Playground: Story = {};
