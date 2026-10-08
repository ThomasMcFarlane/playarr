import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProfileAuthLayout } from "../../src/components/ProfileAuthLayout";
import { Button } from "../../src/components/ui";

const FIELDS: Array<[string, string, string]> = [
  ["server-url", "Server address", "text"],
  ["username", "Username", "text"],
  ["display-name", "Display name", "text"],
  ["email", "Email", "email"],
  ["password", "Password", "password"],
  ["password-confirmation", "Confirm password", "password"],
];

function Signup({ submitting, error }: { submitting: boolean; error: string }) {
  return (
    <ProfileAuthLayout className="signup-profile-page">
      <p className="page-kicker">Create account</p>
      <h1 className="auth-title">Join this server</h1>
      <p className="muted auth-description">Create a profile on this Playarr server.</p>
      <p className="auth-switch">
        Already have an account? <a href="#fixture" className="auth-switch-link">Sign in</a>
      </p>
      <form onSubmit={(event) => event.preventDefault()}>
        {FIELDS.map(([id, label, type]) => (
          <div key={id}>
            <label className="auth-label" htmlFor={`signup-${id}`}>{label}</label>
            <input id={`signup-${id}`} type={type} className={`input auth-input${error && id === "password-confirmation" ? " is-error" : ""}`} disabled={submitting} />
          </div>
        ))}
        {error ? <p className="error-text auth-error">{error}</p> : null}
        <Button type="submit" variant="primary" className="auth-submit" disabled={submitting}>
          {submitting ? "Creating" : "Create account"}
        </Button>
      </form>
    </ProfileAuthLayout>
  );
}

const meta = { title: "Pages/Signup", component: Signup, tags: ["autodocs"], args: { submitting: false, error: "" }, argTypes: { submitting: { control: "boolean" }, error: { control: "text", description: "Error message (empty for none)" } } } satisfies Meta<typeof Signup>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
