import { useState, type ReactNode } from "react";
import {
  useLocation,
  useNavigate,
  type Location,
} from "react-router-dom";
import { ApiError } from "@playarr-tv/api-client";
import { useApiBaseUrl, useAuth } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { DeviceLogin } from "../components/DeviceLogin";
import { IS_TV, PLAYARR_CLIENT_PLATFORM } from "../lib/clientPlatform";
import { serverHostedEntryUrl } from "../lib/serverHostedEntry";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { TranslationKey } from "../lib/i18n/translations";
import { initialLoginServerUrl, publicIpv4RelayUrl } from "../lib/loginServerUrl";
import { isPublicHttpUrl } from "../lib/localNetworkFetch";
import { ProfileAuthLayout } from "../components/ProfileAuthLayout";
import { Button } from "../components/ui";

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
  const { login } = useAuth();
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

  // An HTTPS page cannot reach an http:// server; the server serves this same
  // client at /tv/ over http, so offer that one-step route (never a dead end).
  // A sign-in that interrupted a TV link approval (`/link?user_code=...`) must carry the code over.
  const resumePath = loginDestinationPath(state?.from);
  const linkPage = resumePath?.startsWith("/link?") ? resumePath : "";
  const serverHostedUrl = serverHostedEntryUrl(
    serverUrl,
    window.location.protocol,
    PLAYARR_CLIENT_PLATFORM,
    linkPage
  );

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
      setError(loginErrorMessage(err, needsInsecureContentPermission, serverHostedUrl !== null, t));
      setSubmitting(false);
    }
  }

  function showQrLogin() {
    setError(null);
    navigate("/login/qr", { state: location.state });
  }

  return (
    <LoginShell
      descriptionKey="pages.login.description"
      onBack={returnToProfiles}
      transitionFromProfiles={state?.profileTransition}
    >
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
        {serverHostedUrl ? (
          <p className="hint auth-server-hint">
            <a href={serverHostedUrl}>{t("pages.login.openFromServer")}</a>
          </p>
        ) : null}

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

        <Button
          type="submit" variant="primary" className="auth-submit"
          disabled={submitting}
        >
          {submitting
            ? t("pages.login.submitting")
            : t("pages.login.submit")}
        </Button>
      </form>
      <Button
        type="button" className="auth-qr-submit"
        disabled={submitting}
        onClick={showQrLogin}
      >
        {t("pages.login.qrSubmit")}
      </Button>
    </LoginShell>
  );
}

/**
 * QR/device-code sign-in lives at its own URL while retaining the manual
 * login page's exact shell. It always starts with the hosted link broker;
 * the approving phone/browser selects the Playarr Server, so the QR route
 * neither knows nor carries a server URL.
 */
export function QrLoginPage() {
  const { t } = useLanguage();
  useDocumentTitle(t("pages.login.title"));
  const { loginWithDeviceToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const showManualLogin = () => {
    navigate("/login", {
      replace: true,
      state: location.state,
    });
  };
  const finishLogin = () => {
    const destination = state?.from ?? "/";
    const destinationState =
      state?.fromState ??
      (typeof destination === "object" && "state" in destination
        ? destination.state
        : undefined);
    navigate(destination, { replace: true, state: destinationState });
  };
  const returnToProfiles = () => {
    navigate("/profiles", {
      replace: true,
      state: { loginFrom: loginDestinationPath(state?.from) },
    });
  };

  return (
    <LoginShell
      descriptionKey="pages.login.qrDescription"
      onBack={returnToProfiles}
      transitionFromProfiles={state?.profileTransition}
    >
      <DeviceLogin
        embedded
        hostedLink={!IS_TV}
        onBack={showManualLogin}
        onAuthenticated={(token, connection) => {
          loginWithDeviceToken(token, connection);
          finishLogin();
        }}
      />
    </LoginShell>
  );
}

function LoginShell({
  children,
  descriptionKey,
  onBack,
  transitionFromProfiles,
}: {
  children: ReactNode;
  descriptionKey: TranslationKey;
  onBack: () => void;
  transitionFromProfiles?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <ProfileAuthLayout
      className="login-profile-page"
      backLabel={t("pages.profiles.backAriaLabel")}
      onBack={onBack}
      transitionFromProfiles={transitionFromProfiles}
    >
      <p className="page-kicker">{t("pages.login.kicker")}</p>
      <h1 className="auth-title">{t("pages.login.heading")}</h1>
      <p className="muted auth-description">{t(descriptionKey)}</p>
      {children}
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
 * body (`playarr_api::error::ApiError`, e.g. `message: "invalid username
 * or password"`) even though the generated OpenAPI type for its 400/401
 * responses is untyped -- see `ApiClient.login`'s doc comment and
 * `backend/crates/playarr-api/src/error.rs`'s `From<LoginError>` impl.
 * Prefer that real message over `describeApiError`'s generic "Sign-in
 * required" 401 text, which reads wrong on the page whose entire purpose
 * is signing in.
 */
function loginErrorMessage(
  err: unknown,
  needsInsecureContentPermission: boolean,
  mixedContent: boolean,
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
    if (needsInsecureContentPermission || mixedContent) {
      return t("pages.login.errorInsecureContentBlocked");
    }
    return t("pages.login.errorLanUnreachable");
  }
  return err instanceof Error ? err.message : String(err);
}
