import type { Meta, StoryObj } from "@storybook/react-vite";
import { AccountDeletionPage, AcceptableUsePage, LicencesPage, PrivacyPolicyPage, TermsPage } from "../../src/pages/Legal";

const PAGES = { privacy: PrivacyPolicyPage, terms: TermsPage, "acceptable-use": AcceptableUsePage, licences: LicencesPage, "account-deletion": AccountDeletionPage };

/** The real legal pages (static copy). */
function Legal({ page }: { page: keyof typeof PAGES }) {
  const Page = PAGES[page];
  return <Page />;
}

const meta = {
  title: "Pages/Legal",
  component: Legal,
  args: { page: "privacy" },
  argTypes: { page: { control: "select", options: Object.keys(PAGES) } },
} satisfies Meta<typeof Legal>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
