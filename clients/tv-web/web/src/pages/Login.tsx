import { useState } from "react";
import { useLocation, useNavigate, type Location } from "react-router-dom";
import { ApiError } from "@streamarr-tv/api-client";
import { useApiBaseUrl, useAuth } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { DeviceLogin } from "../components/DeviceLogin";
import { IS_TV } from "../lib/clientPlatform";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { TranslationKey } from "../lib/i18n/translations";
import { initialLoginServerUrl, publicIpv4RelayUrl } from "../lib/loginServerUrl";
import { isPublicHttpUrl } from "../lib/localNetworkFetch";
import { ProfileAuthLayout } from "../components/ProfileAuthLayout";

interface LocationState {
  /** Set by `App.tsx`'s app-shell redirect so a successful login returns to wherever the user was headed. */
  from?: Location | string;
  /** Used by the profile picker when this browser has not signed into the selected profile before. */
  initialUsername?: string;
  /** Optional route state to apply to the post-login destination. */
  fromState?: unknown;
  /** Enables the profile-to-fields entrance motion when sign-in starts from the profile picker. */
  profileTransition?: boolean;
}

/**
 * Real username/password sign-in for Playarr Web -- backs `POST
 * /api/v1/auth/login`'s `AuthMode::FullAccount` tier (see
 * `ApiClientProvider`'s `login`). Reached either by navigating to `/login`
 * directly, or after the profile picker becomes the signed-out landing view
 * once transparent login (`ensureAccessToken`) has failed with nothing left
 * to fall back on -- see `App.tsx`.
 *
 * Deliberately outside the sidebar/header chrome (`App.tsx` mounts this
 * as a sibling of the shelled routes, not a child of `AppShell`) -- there
 * is nothing authenticated to navigate to yet.
 */
export function LoginPage() {
  const { t } = useLanguage();
  useDocumentTitle(t("pages.login.title"));
  const { login, loginWithDeviceToken } = useAuth();
  const [apiBaseUrl] = useApiBaseUrl();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const [serverUrl, setServerUrl] = useState(() =>
    initialLoginServerUrl(apiBaseUrl, window.location.hostname)
  );
  const [username, setUsername] = useState(state?.initialUsername ?? "");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsInsecureContentPermission =
    window.location.protocol === "https:" && isPublicHttpUrl(publicIpv4RelayUrl(serverUrl));

  function finishLogin() {
    const destination = state?.from ?? "/";
    const destinationState =
      state?.fromState ??
      (typeof destination === "object" && "state" in destination
        ? destination.state
        : undefined);
    navigate(destination, { replace: true, state: destinationState });
  }

  function returnToProfiles() {
    navigate("/profiles", {
      replace: true,
      state: { loginFrom: loginDestinationPath(state?.from) },
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login({ serverUrl, username, password });
      finishLogin();
    } catch (err) {
      setError(loginErrorMessage(err, needsInsecureContentPermission, t));
      setSubmitting(false);
    }
  }

  if (IS_TV) {
    return (
      <DeviceLogin
        onAuthenticated={(token) => {
          loginWithDeviceToken(token);
          finishLogin();
        }}
      />
    );
  }

  return (
    <ProfileAuthLayout
      className="login-profile-page"
      backLabel={t("pages.profiles.backAriaLabel")}
      onBack={returnToProfiles}
      transitionFromProfiles={state?.profileTransition}
    >
        <p className="page-kicker">{t("pages.login.kicker")}</p>
        <h1 className="auth-title">{t("pages.login.heading")}</h1>
        <p className="muted auth-description">
          {t("pages.login.description")}
        </p>

        <form onSubmit={(event) => void handleSubmit(event)}>
          <label className="auth-label" htmlFor="login-server-url">
            {t("pages.login.serverUrlLabel")}
          </label>
          <input
            id="login-server-url"
            name="server-url"
            type="text"
            className="input auth-input"
            autoComplete="url"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            required
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            placeholder={t("pages.login.serverUrlPlaceholder")}
          />
          <p className="hint auth-server-hint">
            {needsInsecureContentPermission
              ? t("pages.login.insecureHint")
              : t("pages.login.directConnectionHint")}
          </p>

          <label className="auth-label" htmlFor="login-username">
            {t("pages.login.usernameLabel")}
          </label>
          <input
            id="login-username"
            name="username"
            type="text"
            className="input auth-input"
            autoComplete="username"
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />

          <label className="auth-label" htmlFor="login-password">
            {t("pages.login.passwordLabel")}
          </label>
          <input
            id="login-password"
            name="password"
            type="password"
            className={`input auth-input${error ? " is-error" : ""}`}
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          {error && (
            <p className="error-text auth-error">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary auth-submit"
            disabled={submitting}
          >
            {submitting ? t("pages.login.submitting") : t("pages.login.submit")}
          </button>
        </form>
    </ProfileAuthLayout>
  );
}

function loginDestinationPath(from: Location | string | undefined): string | undefined {
  if (typeof from === "string") return from;
  if (!from) return undefined;
  return `${from.pathname}${from.search}${from.hash}`;
}

/**
 * The login endpoint's failure responses carry a real `{error, message}`
 * body (`streamarr_api::error::ApiError`, e.g. `message: "invalid username
 * or password"`) even though the generated OpenAPI type for its 400/401
 * responses is untyped -- see `ApiClient.login`'s doc comment and
 * `backend/crates/streamarr-api/src/error.rs`'s `From<LoginError>` impl.
 * Prefer that real message over `describeApiError`'s generic "Sign-in
 * required" 401 text, which reads wrong on the page whose entire purpose
 * is signing in.
 */
function loginErrorMessage(
  err: unknown,
  needsInsecureContentPermission: boolean,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown } | undefined;
    if (typeof body?.message === "string" && body.message.length > 0) {
      return body.message;
    }
    if (err.status === 400) {
      return t("pages.login.errorMissingCredentials");
    }
    return t("pages.login.errorGeneric");
  }
  if (err instanceof TypeError) {
    if (needsInsecureContentPermission) {
      return t("pages.login.errorInsecureContentBlocked");
    }
    return t("pages.login.errorLanUnreachable");
  }
  return err instanceof Error ? err.message : String(err);
}
