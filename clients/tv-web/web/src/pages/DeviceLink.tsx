import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiClient, ApiError } from "@playarr-tv/api-client";
import { authorizeDeviceAcrossServers, parseServersParam } from "@playarr-tv/device-auth";
import {
  useApiBaseUrl,
  useApiClient,
  useAuth,
  usePrimaryApiClient,
} from "../lib/ApiClientProvider";
import { isCompleteDeviceCode, normaliseDeviceCode } from "../lib/deviceCode";
import { authoriseHostedLink, inspectHostedLink } from "../lib/hostedDeviceLink";
import { createLocalNetworkFetch } from "../lib/localNetworkFetch";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { TranslationKey } from "../lib/i18n/translations";
import { ProfileAuthLayout } from "../components/ProfileAuthLayout";
import { Button } from "../components/ui";

// Matches `ApiClientProvider.tsx`'s own module-scoped instance: stateless
// (just routes each request through the Local Network Access exemption its
// target address needs), so a second instance here is equivalent, not a
// duplicated cache.
const browserFetch = createLocalNetworkFetch();

export function DeviceLinkPage() {
  const { t } = useLanguage();
  useDocumentTitle(t("pages.deviceLink.title"));
  const client = useApiClient();
  const primaryClient = usePrimaryApiClient();
  const [apiBaseUrl] = useApiBaseUrl();
  const { currentUserId } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryCode = new URLSearchParams(location.search).get("user_code") ?? "";
  const [userCode, setUserCode] = useState(() => normaliseDeviceCode(queryCode));
  const [submitting, setSubmitting] = useState(false);
  const [linked, setLinked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const code = normaliseDeviceCode(userCode);
    if (!isCompleteDeviceCode(code)) {
      setError(t("pages.deviceLink.errorIncompleteCode"));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const hostedSession = await inspectHostedLink(code);
      if (hostedSession) {
        if (hostedSession.linked) {
          setLinked(true);
          return;
        }
        if (!currentUserId) {
          navigate("/profiles", {
            replace: true,
            state: { loginFrom: `/link?user_code=${encodeURIComponent(code)}` },
          });
          return;
        }
        await authoriseHostedLink({
          userCode: code,
          session: hostedSession,
          serverUrl: apiBaseUrl,
          client: primaryClient,
        });
        setLinked(true);
        return;
      }
      // `docs/architecture/peer-groups.md` §6.3: a `servers=` bundle on this
      // very link (carried by `verification_uri_complete`, the QR-encoded
      // form) means the issuing peer told us the whole group's addresses --
      // fan the approval out to all of them in parallel, since it has to
      // beat an impatient human. No bundle (an old cached client, a
      // pre-upgrade peer, or a bare manually-typed code with no URL context
      // at all) falls back to this browser's own already-connected server,
      // exactly as before.
      const bundledServers = parseServersParam(location.search);
      if (bundledServers) {
        await authorizeDeviceAcrossServers(bundledServers, code, {
          buildClient: (url) =>
            new ApiClient({
              baseUrl: url,
              fetchImpl: browserFetch,
              getAccessToken: (request) => client.getAccessToken(request),
            }),
        });
      } else {
        await client.authorizeDevice({ user_code: code });
      }
      setLinked(true);
    } catch (reason) {
      if (!currentUserId) {
        navigate("/profiles", {
          replace: true,
          state: { loginFrom: `/link?user_code=${encodeURIComponent(code)}` },
        });
        return;
      }
      setError(deviceLinkErrorMessage(reason, t));
      setSubmitting(false);
    }
  }

  return (
    <ProfileAuthLayout className="device-link-profile-page">
      <p className="page-kicker">{t("pages.deviceLink.kicker")}</p>
      <h1 className="auth-title">{t("pages.deviceLink.title")}</h1>

      {linked ? (
        <div className="device-link-success" role="status">
          <p className="device-link-success-mark" aria-hidden="true">✓</p>
          <h2>{t("pages.deviceLink.linkedHeading")}</h2>
          <p className="muted">{t("pages.deviceLink.linkedBody")}</p>
        </div>
      ) : (
        <form onSubmit={(event) => void handleSubmit(event)}>
          <p className="muted auth-description">
            {t("pages.deviceLink.description")}
          </p>
          <label className="auth-label" htmlFor="device-user-code">{t("pages.deviceLink.codeLabel")}</label>
          <input
            id="device-user-code"
            className={`input auth-input device-link-input${error ? " is-error" : ""}`}
            name="user-code"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            maxLength={9}
            autoFocus
            required
            value={userCode}
            onChange={(event) => setUserCode(normaliseDeviceCode(event.target.value))}
            placeholder={t("pages.deviceLink.codePlaceholder")}
          />
          {error && <p className="error-text auth-error">{error}</p>}
          <Button
            type="submit" variant="primary" className="auth-submit"
            disabled={submitting || !isCompleteDeviceCode(userCode)}
          >
            {submitting ? t("pages.deviceLink.linking") : t("pages.deviceLink.linkButton")}
          </Button>
        </form>
      )}
    </ProfileAuthLayout>
  );
}

function deviceLinkErrorMessage(reason: unknown, t: (key: TranslationKey) => string): string {
  if (reason instanceof ApiError && reason.status === 404) {
    return t("pages.deviceLink.errorInvalidCode");
  }
  return reason instanceof Error ? reason.message : String(reason);
}
