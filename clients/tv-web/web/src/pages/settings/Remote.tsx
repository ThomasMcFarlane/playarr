import { useCallback, useEffect, useState } from "react";
import { useVisiblePolling } from "../../lib/visiblePolling";
import type { RemotePairing, RemoteTarget } from "@playarr-tv/api-client";
import { usePrimaryApiClient } from "../../lib/ApiClientProvider";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { defaultDeviceName } from "../../lib/remote/commands";
import { IS_TV, PLAYARR_CLIENT_PLATFORM } from "../../lib/clientPlatform";
import { useRemoteHost } from "../../lib/remote/RemoteProvider";
import { RemotePad } from "../../components/remote/RemotePad";
import { SettingsSectionLayout } from "./SettingsSectionLayout";
import { Button } from "../../components/ui";

/** Device lists change rarely; a pairing in progress has its own faster poll below. */
const REFRESH_INTERVAL_MS = 15_000;

export function SettingsRemotePage() {
  const { t } = useLanguage();
  useDocumentTitle(t("settings.index.remote.title"));
  const client = usePrimaryApiClient();
  const { hostEnabled, setHostEnabled } = useRemoteHost();
  const [targets, setTargets] = useState<RemoteTarget[]>([]);
  const [pairings, setPairings] = useState<RemotePairing[]>([]);
  const [controlling, setControlling] = useState<string | null>(null);
  const [pending, setPending] = useState<RemotePairing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextTargets, nextPairings] = await Promise.all([
        client.listRemoteTargets(),
        client.listRemotePairings(),
      ]);
      setTargets(nextTargets);
      setPairings(nextPairings);
    } catch {
      setError(t("remote.settings.loadFailed"));
    }
  }, [client, t]);

  // No live event covers devices coming and going, so the lists poll gently: every 15 s, only while the
  // tab is visible, never overlapping, and once straight away when the tab returns.
  useVisiblePolling(refresh, REFRESH_INTERVAL_MS);

  // While a pairing is pending, poll until the target approves or denies it.
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => {
      if (Date.now() >= pending.expires_ms) {
        setPending(null);
        setError(t("remote.settings.pairingNotApproved"));
        return;
      }
      client
        .getRemotePairing(pending.id)
        .then((next) => {
          if (next.status === "pending") return;
          setPending(null);
          if (next.status === "active") setControlling(next.target_device_id);
          else setError(t("remote.settings.pairingNotApproved"));
          void refresh();
        })
        // A transient network error keeps waiting until the pairing expires.
        .catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [client, pending, refresh, t]);

  const activeFor = (deviceId: string) =>
    pairings.find(
      (p) => p.target_device_id === deviceId && p.status === "active" && p.is_controller
    );

  const pair = async (target: RemoteTarget) => {
    setError(null);
    try {
      const pairing = await client.requestRemotePairing({
        targetDeviceId: target.device_id,
        controllerName: defaultDeviceName(PLAYARR_CLIENT_PLATFORM, IS_TV),
      });
      if (pairing.status === "active") setControlling(target.device_id);
      else setPending(pairing);
    } catch {
      setError(t("remote.settings.pairFailed"));
    }
  };

  const revoke = async (id: string) => {
    try {
      await client.revokeRemotePairing(id);
      if (pairings.find((p) => p.id === id)?.target_device_id === controlling) setControlling(null);
      await refresh();
    } catch {
      setError(t("remote.settings.revokeFailed"));
    }
  };

  const saveRename = async () => {
    if (!renaming || !renaming.name.trim()) return;
    try {
      await client.renameRemotePairing(renaming.id, renaming.name.trim());
      setRenaming(null);
      await refresh();
    } catch {
      setError(t("remote.settings.renameFailed"));
    }
  };

  const others = targets.filter((target) => !target.is_self);
  const nameOf = (deviceId: string) =>
    targets.find((target) => target.device_id === deviceId)?.name ?? t("remote.settings.unknownDevice");
  // The label that identifies the other end of a pairing from this device's point of view.
  const pairingLabel = (p: RemotePairing) =>
    p.is_target ? p.controller_name : nameOf(p.target_device_id);
  const controlPairing = controlling ? activeFor(controlling) : undefined;
  const live = pairings.filter((p) => p.status === "active" || p.status === "pending");

  return (
    <SettingsSectionLayout>
      <section className="card settings-card settings-card-wide">
        <h3>{t("remote.host.title")}</h3>
        <label className="remote-toggle">
          <input
            type="checkbox"
            checked={hostEnabled}
            onChange={(event) => setHostEnabled(event.target.checked)}
          />
          <span>{t("remote.host.toggle")}</span>
        </label>
        <p className="hint">{t("remote.host.hint")}</p>
      </section>

      <section className="card settings-card settings-card-wide">
        <h3>{t("remote.targets.title")}</h3>
        {others.length === 0 ? <p className="muted">{t("remote.targets.empty")}</p> : null}
        <div className="server-choice-options">
          {others.map((target) => {
            const existing = activeFor(target.device_id);
            return (
              <button
                key={target.device_id}
                type="button"
                className="server-choice-option"
                disabled={!target.online || pending !== null}
                onClick={() => (existing ? setControlling(target.device_id) : void pair(target))}
              >
                <strong>{target.name}</strong>
                <span>
                  {!target.online
                    ? t("remote.targets.offline")
                    : existing
                      ? t("remote.targets.control")
                      : t("remote.targets.pair")}
                </span>
              </button>
            );
          })}
        </div>
        {pending ? (
          <p role="status">
            {t("remote.targets.pairing", {
              name: nameOf(pending.target_device_id),
              code: pending.verification_code ?? "",
            })}
          </p>
        ) : null}
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {controlPairing && controlling ? (
        <RemotePad pairing={controlPairing} targetName={nameOf(controlling)} />
      ) : null}

      <section className="card settings-card settings-card-wide">
        <h3>{t("remote.pairings.title")}</h3>
        {live.length === 0 ? <p className="muted">{t("remote.pairings.empty")}</p> : null}
        <div className="server-choice-options">
          {live.map((p) => (
            <div key={p.id} className="remote-pairing-row">
              {renaming?.id === p.id ? (
                <form
                  className="remote-pairing-rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveRename();
                  }}
                >
                  <input
                    className="input"
                    aria-label={t("remote.pairings.renameLabel")}
                    value={renaming.name}
                    maxLength={60}
                    autoFocus
                    onChange={(event) => setRenaming({ id: p.id, name: event.target.value })}
                  />
                  <Button type="submit" variant="primary">
                    {t("remote.pairings.save")}
                  </Button>
                  <Button type="button" onClick={() => setRenaming(null)}>
                    {t("remote.pairings.cancel")}
                  </Button>
                </form>
              ) : (
                <>
                  <span>
                    <strong>{pairingLabel(p)}</strong>
                    <span className="muted">
                      {" "}
                      {p.is_target ? "" : `${p.controller_name} · `}
                      {p.scopes.join(", ")}
                    </span>
                    <span className="muted remote-pairing-meta">
                      {p.status === "pending"
                        ? t("remote.pairings.pending")
                        : t("remote.pairings.pairedOn", {
                            date: new Date(p.created_ms).toLocaleDateString(),
                            expires: new Date(p.expires_ms).toLocaleDateString(),
                          })}
                    </span>
                  </span>
                  <span className="remote-pairing-actions">
                    <Button
                      type="button"
                      onClick={() => setRenaming({ id: p.id, name: p.controller_name })}
                    >
                      {t("remote.pairings.rename")}
                    </Button>
                    <Button type="button" onClick={() => void revoke(p.id)}>
                      {t("remote.pairings.revoke")}
                    </Button>
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      </section>
    </SettingsSectionLayout>
  );
}
