import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/ApiClientProvider";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { SettingsSectionLayout } from "./SettingsSectionLayout";

export function SettingsAccountPage() {
  useDocumentTitle("Account — Settings");
  const { logout } = useAuth();
  const navigate = useNavigate();

  function handleSignOut() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <SettingsSectionLayout
      kicker="Make it yours"
      title="Account"
      description="End this browser session and return to sign in."
    >
      <section className="card settings-card settings-card-wide">
        <button type="button" className="btn btn-danger" onClick={handleSignOut}>
          Sign out
        </button>
      </section>
    </SettingsSectionLayout>
  );
}
