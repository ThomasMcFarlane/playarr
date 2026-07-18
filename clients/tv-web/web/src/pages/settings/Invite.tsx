import { useEffect, useState } from "react";
import {
  ApiError,
  type UserInviteRequestResponse,
} from "@streamarr-tv/api-client";
import { useApiBaseUrl, usePrimaryApiClient } from "../../lib/ApiClientProvider";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useToast } from "../../lib/toast";
import { QrCode } from "../../components/QrCode";
import { enableApprovalPushNotifications } from "../../lib/pushNotifications";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import { SettingsSectionLayout } from "./SettingsSectionLayout";

type FriendInviteState =
  | { status: "loading" }
  | { status: "ready"; request: UserInviteRequestResponse | null }
  | { status: "saving"; request: UserInviteRequestResponse | null }
  | { status: "error"; request: UserInviteRequestResponse | null; message: string };

type PushState = "idle" | "enabling" | "enabled" | "error";

export function SettingsInvitePage() {
  const { t } = useLanguage();
  useDocumentTitle(t("settings.invite.documentTitle"));
  const [apiBaseUrl] = useApiBaseUrl();
  const client = usePrimaryApiClient();
  const { showToast } = useToast();
  const [friendInviteState, setFriendInviteState] = useState<FriendInviteState>({
    status: "loading",
  });
  const [friendInviteLink, setFriendInviteLink] = useState<string | null>(null);
  const [friendInviteExpiresAt, setFriendInviteExpiresAt] = useState<string | null>(null);
  const [friendInviteCopied, setFriendInviteCopied] = useState(false);
  const [pushState, setPushState] = useState<PushState>("idle");
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void client
        .getMyUserInviteRequest()
        .then((request) => {
          if (!cancelled) setFriendInviteState({ status: "ready", request });
        })
        .catch((error) => {
          if (cancelled) return;
          setFriendInviteState({
            status: "error",
            request: null,
            message: error instanceof ApiError ? error.message : String(error),
          });
        });
    };
    refresh();
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [client]);

  async function handleRequestFriendInvite() {
    const current = friendInviteState.status === "loading" ? null : friendInviteState.request;
    setFriendInviteState({ status: "saving", request: current });
    try {
      const request = await client.createUserInviteRequest();
      setFriendInviteState({ status: "ready", request });
      showToast(t("settings.invite.toastRequestSent"));
    } catch (error) {
      setFriendInviteState({
        status: "error",
        request: current,
        message: error instanceof ApiError ? error.message : String(error),
      });
    }
  }

  async function handleGenerateFriendInvite() {
    const current = friendInviteState.status === "loading" ? null : friendInviteState.request;
    setFriendInviteState({ status: "saving", request: current });
    try {
      const invite = await client.generateApprovedUserInvite();
      const url = new URL("/signup", "https://playarr.app");
      url.searchParams.set("server", apiBaseUrl);
      url.searchParams.set("invite", invite.invite_token);
      setFriendInviteLink(url.toString());
      setFriendInviteExpiresAt(invite.expires_at);
      setFriendInviteCopied(false);
      const request = await client.getMyUserInviteRequest();
      setFriendInviteState({ status: "ready", request });
      showToast(t("settings.invite.toastGenerated"));
    } catch (error) {
      setFriendInviteState({
        status: "error",
        request: current,
        message: error instanceof ApiError ? error.message : String(error),
      });
    }
  }

  async function handleCopyFriendInvite() {
    if (!friendInviteLink) return;
    try {
      await navigator.clipboard.writeText(friendInviteLink);
      setFriendInviteCopied(true);
      showToast(t("settings.invite.toastCopied"));
    } catch {
      setFriendInviteState((current) => ({
        status: "error",
        request: current.status === "loading" ? null : current.request,
        message: t("settings.invite.copyFailed"),
      }));
    }
  }

  async function handleEnablePush() {
    setPushState("enabling");
    setPushError(null);
    try {
      await enableApprovalPushNotifications(client);
      setPushState("enabled");
      showToast(t("settings.invite.toastPushEnabled"));
    } catch (error) {
      setPushState("error");
      setPushError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <>
      <SettingsSectionLayout
        kicker={t("settings.invite.kicker")}
        title={t("settings.invite.title")}
        description={t("settings.invite.description")}
      >
      <section className="card settings-card settings-card-wide">
        {friendInviteState.status === "loading" ? (
          <p className="muted">{t("settings.invite.checkingStatus")}</p>
        ) : (
          <>
            <p className="muted" aria-live="polite">
              {!friendInviteState.request
                ? t("settings.invite.statusNone")
                : friendInviteState.request.status === "pending"
                  ? t("settings.invite.statusPending")
                  : friendInviteState.request.status === "approved"
                    ? t("settings.invite.statusApproved")
                    : friendInviteState.request.status === "denied"
                      ? t("settings.invite.statusDenied")
                      : t("settings.invite.statusGenerated")}
            </p>
            {friendInviteState.status === "error" ? (
              <p className="error-text" role="alert">{friendInviteState.message}</p>
            ) : null}
            <button
              type="button"
              className="btn btn-primary"
              disabled={friendInviteState.status === "saving" || friendInviteState.request?.status === "pending"}
              onClick={() =>
                friendInviteState.request?.status === "approved"
                  ? void handleGenerateFriendInvite()
                  : void handleRequestFriendInvite()
              }
            >
              {friendInviteState.status === "saving"
                ? t("settings.invite.working")
                : friendInviteState.request?.status === "approved"
                  ? t("settings.invite.generateQr")
                  : friendInviteState.request?.status === "pending"
                    ? t("settings.invite.requestPending")
                    : t("settings.invite.requestQr")}
            </button>
            <div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={pushState === "enabling" || pushState === "enabled"}
                onClick={() => void handleEnablePush()}
              >
                {pushState === "enabled"
                  ? t("settings.invite.pushEnabled")
                  : pushState === "enabling"
                    ? t("settings.invite.pushEnabling")
                    : t("settings.invite.enablePush")}
              </button>
              {pushError ? <p className="error-text" role="alert">{pushError}</p> : null}
            </div>
          </>
        )}
      </section>
    </SettingsSectionLayout>

      {friendInviteLink ? (
        <div
          className="server-choice-backdrop"
          role="presentation"
          onMouseDown={() => setFriendInviteLink(null)}
        >
          <section
            className="server-choice-modal friend-invite-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="friend-invite-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <p className="page-kicker">{t("settings.invite.modalKicker")}</p>
            <h2 id="friend-invite-title">{t("settings.invite.modalTitle")}</h2>
            <p className="muted">
              {t("settings.invite.modalDescription")}
            </p>
            <QrCode
              value={friendInviteLink}
              size={260}
              label={t("settings.invite.qrLabel")}
            />
            <label className="form-label" htmlFor="friend-invite-link">{t("settings.invite.linkLabel")}</label>
            <input
              id="friend-invite-link"
              className="input"
              value={friendInviteLink}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            {friendInviteExpiresAt ? (
              <p className="hint">
                {t("settings.invite.expires", {
                  expiresAt: new Date(friendInviteExpiresAt).toLocaleString(),
                })}
              </p>
            ) : null}
            <div className="connection-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setFriendInviteLink(null)}>
                {t("settings.invite.close")}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void handleCopyFriendInvite()}>
                {friendInviteCopied ? t("settings.invite.copied") : t("settings.invite.copyLink")}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
