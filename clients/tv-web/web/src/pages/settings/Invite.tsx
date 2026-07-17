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
import { SettingsSectionLayout } from "./SettingsSectionLayout";

type FriendInviteState =
  | { status: "loading" }
  | { status: "ready"; request: UserInviteRequestResponse | null }
  | { status: "saving"; request: UserInviteRequestResponse | null }
  | { status: "error"; request: UserInviteRequestResponse | null; message: string };

type PushState = "idle" | "enabling" | "enabled" | "error";

export function SettingsInvitePage() {
  useDocumentTitle("Invite a friend — Settings");
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
      showToast("Invite request sent to your Streamarr admin.");
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
      showToast("Friend invite generated. It is valid for 24 hours.");
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
      showToast("Invite link copied.");
    } catch {
      setFriendInviteState((current) => ({
        status: "error",
        request: current.status === "loading" ? null : current.request,
        message: "Could not copy the link. Select and copy it manually.",
      }));
    }
  }

  async function handleEnablePush() {
    setPushState("enabling");
    setPushError(null);
    try {
      await enableApprovalPushNotifications(client);
      setPushState("enabled");
      showToast("Invite approval notifications enabled.");
    } catch (error) {
      setPushState("error");
      setPushError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <>
      <SettingsSectionLayout
        kicker="Make it yours"
        title="Invite a friend"
        description="Ask your Streamarr admin for one friend-invite QR code."
      >
      <section className="card settings-card settings-card-wide">
        {friendInviteState.status === "loading" ? (
          <p className="muted">Checking invite status…</p>
        ) : (
          <>
            <p className="muted" aria-live="polite">
              {!friendInviteState.request
                ? "You have not requested an invite yet."
                : friendInviteState.request.status === "pending"
                  ? "Waiting for an admin to review your request."
                  : friendInviteState.request.status === "approved"
                    ? "Approved — generate your QR code when you are ready to share it."
                    : friendInviteState.request.status === "denied"
                      ? "Your previous request was not approved. You can ask again."
                      : "Your approved invite was generated. Request another when you need one."}
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
                ? "Working…"
                : friendInviteState.request?.status === "approved"
                  ? "Generate invite QR"
                  : friendInviteState.request?.status === "pending"
                    ? "Request pending"
                    : "Request invite QR"}
            </button>
            <div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={pushState === "enabling" || pushState === "enabled"}
                onClick={() => void handleEnablePush()}
              >
                {pushState === "enabled"
                  ? "Approval notifications enabled"
                  : pushState === "enabling"
                    ? "Enabling…"
                    : "Enable approval notifications"}
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
            <p className="page-kicker">Ready to share</p>
            <h2 id="friend-invite-title">Invite a friend to Playarr</h2>
            <p className="muted">
              This one-use code opens Playarr with your Streamarr server already locked in.
            </p>
            <QrCode
              value={friendInviteLink}
              size={260}
              label="QR code for a Playarr friend invitation"
            />
            <label className="form-label" htmlFor="friend-invite-link">Invite link</label>
            <input
              id="friend-invite-link"
              className="input"
              value={friendInviteLink}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            {friendInviteExpiresAt ? (
              <p className="hint">
                Expires {new Date(friendInviteExpiresAt).toLocaleString()}. The invite can be used once.
              </p>
            ) : null}
            <div className="connection-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setFriendInviteLink(null)}>
                Close
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void handleCopyFriendInvite()}>
                {friendInviteCopied ? "Copied" : "Copy link"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
