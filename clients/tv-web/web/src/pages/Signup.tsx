import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiClient, ApiError } from "@streamarr-tv/api-client";
import { rememberGroup } from "@streamarr-tv/domain";
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

/**
 * Short reachability-probe budget per address, per `docs/architecture/
 * peer-groups.md` §6.1 ("tries serverUrls in order, short per-attempt
 * timeout"). Only guards the probe below, never the real signup/login
 * requests, which get however long a normal request takes.
 */
const SERVER_PROBE_TIMEOUT_MS = 3000;

/** Wraps a `fetchImpl` so a single request aborts after `timeoutMs`. */
function fetchWithTimeout(
  fetchImpl: (input: Request) => Promise<Response>,
  timeoutMs: number
): (input: Request) => Promise<Response> {
  return (input) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetchImpl(new Request(input, { signal: controller.signal })).finally(() =>
      clearTimeout(timer)
    );
  };
}

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
  // The address (from `invite.serverUrls`) that actually answered -- see the
  // resolution effect below. `null` until resolved, so `signupClient` (and
  // therefore submission) waits for a reachable address instead of racing
  // ahead against one that might not exist.
  const [resolvedServerUrl, setResolvedServerUrl] = useState<string | null>(null);
  const signupClient = useMemo(
    () =>
      resolvedServerUrl
        ? new ApiClient({
            baseUrl: publicIpv4RelayUrl(resolvedServerUrl),
            fetchImpl: browserFetch,
          })
        : null,
    [resolvedServerUrl]
  );

  // Tries every address this invite carries, in order, per §6.1: a short
  // per-attempt timeout so one unreachable peer doesn't stall the whole
  // list. First address to answer `getVersion()` wins -- that's both the
  // liveness probe and how the server's display name gets populated, same
  // as the single-address version of this effect did. On success, the
  // *whole* list is remembered (not just the winner) as a `KnownServerGroup`
  // (§7.1) via `rememberGroup`, with the winner promoted to `lastGoodUrl` so
  // it's tried first on the next resolution -- the invite carries no
  // `groupId`/`groupName` of its own, so this group starts anonymous.
  useEffect(() => {
    if (!invite) return;
    let cancelled = false;

    void (async () => {
      for (const serverUrl of invite.serverUrls) {
        if (cancelled) return;
        const probeClient = new ApiClient({
          baseUrl: publicIpv4RelayUrl(serverUrl),
          fetchImpl: fetchWithTimeout(browserFetch, SERVER_PROBE_TIMEOUT_MS),
        });
        try {
          const version = await probeClient.getVersion();
          if (cancelled) return;
          rememberGroup({
            servers: invite.serverUrls.map((url) => ({ url })),
            lastGoodUrl: serverUrl,
          });
          setResolvedServerUrl(serverUrl);
          setServerName(version.instance_name || serverUrl);
          return;
        } catch {
          // Unreachable, or timed out -- try the next address. §6.1: "as
          // long as one of them connects, it's fine."
        }
      }
      if (cancelled) return;
      // Every address's reachability probe failed. Fall back to the first
      // address anyway so the form stays usable and a real submit attempt
      // surfaces a normal network-unreachable error rather than leaving
      // the page silently inert (matches this effect's pre-multi-address
      // behavior of always building a client even when the probe failed).
      const fallbackUrl = invite.serverUrls[0];
      if (fallbackUrl) {
        setResolvedServerUrl(fallbackUrl);
        setServerName(fallbackUrl);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!invite || !signupClient || !resolvedServerUrl) return;
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
      await login({ serverUrl: resolvedServerUrl, username, password });
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
