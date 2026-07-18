import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "@streamarr-tv/api-client";
import { useApiClient, useAuth } from "../lib/ApiClientProvider";
import { isCompleteDeviceCode, normaliseDeviceCode } from "../lib/deviceCode";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { TranslationKey } from "../lib/i18n/translations";

export function DeviceLinkPage() {
  const { t } = useLanguage();
  useDocumentTitle(t("pages.deviceLink.title"));
  const client = useApiClient();
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
      await client.authorizeDevice({ user_code: code });
      setLinked(true);
    } catch (reason) {
      if (!currentUserId) {
        navigate("/login", {
          replace: true,
          state: { from: `/link?user_code=${encodeURIComponent(code)}` },
        });
        return;
      }
      setError(deviceLinkErrorMessage(reason, t));
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page device-link-page">
      <div className="auth-backdrop" aria-hidden="true" />
      <div className="auth-card device-link-card">
        <div className="auth-header">
          <span className="app-logo">
            <img
              className="app-logo-icon"
              src="/playarr-icon.svg"
              alt=""
            />
            <span><span className="app-logo-accent">Play</span>arr</span>
          </span>
        </div>
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
            <button
              type="submit"
              className="btn btn-primary auth-submit"
              disabled={submitting || !isCompleteDeviceCode(userCode)}
            >
              {submitting ? t("pages.deviceLink.linking") : t("pages.deviceLink.linkButton")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function deviceLinkErrorMessage(reason: unknown, t: (key: TranslationKey) => string): string {
  if (reason instanceof ApiError && reason.status === 404) {
    return t("pages.deviceLink.errorInvalidCode");
  }
  return reason instanceof Error ? reason.message : String(reason);
}
