import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProfileAuthLayout } from "../../src/components/ProfileAuthLayout";

type Args = { withBack: boolean; transitionFromProfiles: boolean; error: boolean; disabled: boolean };

function Layout({ withBack, transitionFromProfiles, error, disabled }: Args) {
  return (
    <ProfileAuthLayout backLabel="Back" onBack={withBack ? () => undefined : undefined} transitionFromProfiles={transitionFromProfiles}>
      <h1>Sign in</h1>
      <label htmlFor="sb-auth-user">Username</label>
      <input id="sb-auth-user" defaultValue="sample" disabled={disabled} aria-invalid={error || undefined} />
      <label htmlFor="sb-auth-pass">Password</label>
      <input id="sb-auth-pass" type="password" defaultValue="secret" disabled={disabled} aria-invalid={error || undefined} />
      {error ? <p role="alert">The username or password is not right.</p> : null}
      <button type="button" className="ui-btn btn btn-primary" disabled={disabled}>
        Sign in
      </button>
    </ProfileAuthLayout>
  );
}

const meta = {
  title: "Components/Profile auth layout",
  component: Layout,
  tags: ["autodocs"],
  args: { withBack: true, transitionFromProfiles: false, error: false, disabled: false },
  argTypes: {
    withBack: { control: "boolean", description: "Show the Back button" },
    transitionFromProfiles: { control: "boolean" },
    error: { control: "boolean" },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Layout>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
