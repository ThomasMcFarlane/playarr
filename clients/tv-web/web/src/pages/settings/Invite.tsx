import { useEffect, useState } from "react";
import {
  ApiError,
  type UserInviteRequestResponse,
} from "@playarr-tv/api-client";
import { buildInviteUrl, type PeerAddressBundleLike } from "@playarr-tv/domain";
import { useApiBaseUrl, usePrimaryApiClient } from "../../lib/ApiClientProvider";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useToast } from "../../lib/toast";
import { QrCode } from "../../components/QrCode";
import { enableApprovalPushNotifications } from "../../lib/pushNotifications";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import { SettingsSectionLayout } from "./SettingsSectionLayout";
import { SkeletonState } from "../../components/shell";
import { Button } from "../../components/ui";

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
  const [requestMessage, setRequestMessage] = useState("");
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
      const request = await client.createUserInviteRequest({
        message: requestMessage.trim() || undefined,
      });
      setFriendInviteState({ status: "ready", request });
      setRequestMessage("");
      showToast(t("settings.invite.toastRequestSent"));
    } catch (error) {
      setFriendInviteState({
        status: "error",
        request: current,
        message: error instanceof ApiError ? error.message : String(error),
      });
    }
  }

  /**
   * `GET .../peer-groups/self/address-bundle` is `AdminUser`-gated
   * (`admin_peer.rs`), but this friend-invite flow's caller is only a
   * `StreamingUser` (`users.rs::generate_user_invite_handler` -- any
   * signed-in household member, not just admins). A 403 here just means
   * "not an admin," not a real failure: fall back to this node's own
   * configured address, degenerating to exactly today's single-address
   * link rather than blocking friend-invite generation for non-admins.
   *
   * Separately: even for an admin caller, the bundle's `addresses` list is
   * empty -- not an error -- for a node that has never called `PUT
   * /api/v1/admin/peer-nodes/self` (no UI calls that endpoint yet, so this
   * is every deployment's actual state today). A zero-address `servers=`
   * bundle is exactly what `signupInvite.ts::parseSignupInvite` treats as
   * "no invite at all," silently breaking sign-up for the ordinary
   * single-node case. Fall back the same way as the 403 case: this
   * client's own currently-connected address, still through the one
   * `servers=` code path.
   */
  async function resolveFriendInviteAddressBundle(): Promise<PeerAddressBundleLike> {
    try {
      const bundle = await client.getPeerAddressBundle();
      return bundle.addresses.length > 0 ? bundle : fallbackAddressBundle(apiBaseUrl);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        return fallbackAddressBundle(apiBaseUrl);
      }
      throw error;
    }
  }

  /**
   * Wraps this client's own connected address into a one-element
   * `PeerAddressBundleLike` for both fallback branches above.
   * `peer_node_id` is a placeholder, not a real attribution -- there is no
   * backing `peer_nodes` row to attribute it to in either fallback case --
   * but that's harmless: every consumer downstream of `buildInviteUrl`
   * (ultimately `signupInvite.ts::parseSignupInvite` on the redeeming
   * client) only ever reads `url`, never `peer_node_id`, since sign-up
   * redemption works at any node in the group by design.
   */
  function fallbackAddressBundle(url: string): PeerAddressBundleLike {
    return { addresses: [{ peer_node_id: "", url }] };
  }

  async function handleGenerateFriendInvite() {
    const current = friendInviteState.status === "loading" ? null : friendInviteState.request;
    setFriendInviteState({ status: "saving", request: current });
    try {
      const [invite, addressBundle] = await Promise.all([
        client.generateApprovedUserInvite(),
        resolveFriendInviteAddressBundle(),
      ]);
      setFriendInviteLink(buildInviteUrl(addressBundle, invite.invite_token));
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
      <SettingsSectionLayout>
      <section className="card settings-card settings-card-wide">
        {friendInviteState.status === "loading" ? (
          <SkeletonState kind="settings" compact label={t("settings.invite.checkingStatus")} />
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
            {!friendInviteState.request ||
            friendInviteState.request.status === "denied" ||
            friendInviteState.request.status === "generated" ? (
              <label className="form-label" htmlFor="friend-invite-message">
                {t("settings.invite.messageLabel")}
                <textarea
                  id="friend-invite-message"
                  className="input"
                  rows={4}
                  maxLength={500}
                  value={requestMessage}
                  placeholder={t("settings.invite.messagePlaceholder")}
                  onChange={(event) => setRequestMessage(event.target.value)}
                />
              </label>
            ) : null}
            <Button
              type="button" variant="primary"
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
            </Button>
            <div>
              <Button
                type="button" size="sm"
                disabled={pushState === "enabling" || pushState === "enabled"}
                onClick={() => void handleEnablePush()}
              >
                {pushState === "enabled"
                  ? t("settings.invite.pushEnabled")
                  : pushState === "enabling"
                    ? t("settings.invite.pushEnabling")
                    : t("settings.invite.enablePush")}
              </Button>
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
              <Button type="button" onClick={() => setFriendInviteLink(null)}>
                {t("settings.invite.close")}
              </Button>
              <Button type="button" variant="primary" onClick={() => void handleCopyFriendInvite()}>
                {friendInviteCopied ? t("settings.invite.copied") : t("settings.invite.copyLink")}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
