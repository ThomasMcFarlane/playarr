import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiClient, ApiError } from "@streamarr-tv/api-client";
import { useAuth } from "../lib/ApiClientProvider";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import { createLocalNetworkFetch } from "../lib/localNetworkFetch";
import { parseSignupInvite } from "../lib/signupInvite";
import { publicIpv4RelayUrl } from "../lib/loginServerUrl";
import { useToast } from "../lib/toast";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { ProfileAuthLayout } from "../components/ProfileAuthLayout";

const invite = parseSignupInvite(window.location.search);
const browserFetch = createLocalNetworkFetch();

export function SignupPage() {
  const { t } = useLanguage();
  useDocumentTitle(t("pages.signup.documentTitle"));
  const navigate = useNavigate();
  const { login } = useAuth();
  const { showToast } = useToast();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverName, setServerName] = useState<string | null>(null);
  const signupClient = useMemo(
    () =>
      invite
        ? new ApiClient({
            baseUrl: publicIpv4RelayUrl(invite.serverUrl),
            fetchImpl: browserFetch,
          })
        : null,
    []
  );

  useEffect(() => {
    if (!invite || !signupClient) return;
    let cancelled = false;
    void signupClient
      .getVersion()
      .then((version) => {
        if (!cancelled) setServerName(version.instance_name || invite.serverUrl);
      })
      .catch(() => {
        if (!cancelled) setServerName(invite.serverUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [signupClient]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!invite || !signupClient) return;
    if (password !== passwordConfirmation) {
      setError(t("pages.signup.passwordMismatch"));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await signupClient.signup({
        invite_token: invite.inviteToken,
        username,
        display_name: displayName,
        email: email || undefined,
        password,
      });
      await login({ serverUrl: invite.serverUrl, username, password });
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) {
        showToast(t("pages.signup.error.inviteAlreadyUsedToast"));
        navigate("/login", { replace: true, state: { initialUsername: username } });
        return;
      }
      setError(signupErrorMessage(err, t));
      setSubmitting(false);
    }
  }

  return (
    <ProfileAuthLayout className="signup-profile-page">
        <p className="page-kicker">{t("pages.signup.kicker")}</p>
        <h1 className="auth-title">{t("pages.signup.title")}</h1>
        <p className="muted auth-description">
          {t("pages.signup.description")}
        </p>

        <p className="auth-switch">
          {t("pages.signup.alreadyHaveAccount")}{" "}
          <Link to="/login" className="auth-switch-link">
            {t("pages.signup.loginLink")}
          </Link>
        </p>

        {!invite ? (
          <p className="error-text auth-error">
            {t("pages.signup.inviteMissing")}
          </p>
        ) : (
          <form onSubmit={(event) => void handleSubmit(event)}>
            <label className="auth-label" htmlFor="signup-server-url">{t("pages.signup.serverUrlLabel")}</label>
            <input
              id="signup-server-url"
              name="server-url"
              type="text"
              className="input auth-input"
              value={serverName ?? t("pages.signup.serverNameLoading")}
              readOnly
              aria-readonly="true"
              aria-busy={serverName === null}
              tabIndex={-1}
            />
            <p className="hint auth-server-hint">
              {t("pages.signup.serverUrlHint")}
            </p>

            <label className="auth-label" htmlFor="signup-username">{t("pages.signup.usernameLabel")}</label>
            <input
              id="signup-username"
              name="username"
              type="text"
              className="input auth-input"
              autoComplete="username"
              required
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />

            <label className="auth-label" htmlFor="signup-display-name">{t("pages.signup.displayNameLabel")}</label>
            <input
              id="signup-display-name"
              name="display-name"
              type="text"
              className="input auth-input"
              autoComplete="name"
              required
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />

            <label className="auth-label" htmlFor="signup-email">{t("pages.signup.emailLabel")}</label>
            <input
              id="signup-email"
              name="email"
              type="email"
              className="input auth-input"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />

            <label className="auth-label" htmlFor="signup-password">{t("pages.signup.passwordLabel")}</label>
            <input
              id="signup-password"
              name="password"
              type="password"
              className="input auth-input"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />

            <label className="auth-label" htmlFor="signup-password-confirmation">
              {t("pages.signup.confirmPasswordLabel")}
            </label>
            <input
              id="signup-password-confirmation"
              name="password-confirmation"
              type="password"
              className={`input auth-input${error ? " is-error" : ""}`}
              autoComplete="new-password"
              required
              value={passwordConfirmation}
              onChange={(event) => setPasswordConfirmation(event.target.value)}
            />

            {error && <p className="error-text auth-error">{error}</p>}

            <button type="submit" className="btn btn-primary auth-submit" disabled={submitting}>
              {submitting ? t("pages.signup.submitting") : t("pages.signup.submit")}
            </button>
          </form>
        )}
    </ProfileAuthLayout>
  );
}

function signupErrorMessage(err: unknown, t: ReturnType<typeof useLanguage>["t"]): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | undefined;
    if (typeof body?.message === "string" && body.message.length > 0) return body.message;
    if (err.status === 409) return t("pages.signup.error.usernameTaken");
    return t("pages.signup.error.generic");
  }
  if (err instanceof TypeError) {
    return t("pages.signup.error.networkUnreachable");
  }
  return err instanceof Error ? err.message : String(err);
}
