import { useCallback, useEffect, useState } from "react";
import type { RemotePairing, RemoteTarget } from "@playarr-tv/api-client";
import { usePrimaryApiClient } from "../../lib/ApiClientProvider";
import { useLanguage } from "../../lib/i18n/LanguageProvider";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { defaultDeviceName } from "../../lib/remote/commands";
import { IS_TV, PLAYARR_CLIENT_PLATFORM } from "../../lib/clientPlatform";
import { useRemoteHost } from "../../lib/remote/RemoteProvider";
import { RemotePad } from "../../components/remote/RemotePad";
import { SettingsSectionLayout } from "./SettingsSectionLayout";

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

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // While a pairing is pending, poll until the target approves or denies it.
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => {
      void client.getRemotePairing(pending.id).then((next) => {
        if (next.status === "pending") return;
        setPending(null);
        if (next.status === "active") setControlling(next.target_device_id);
        else setError(t("remote.settings.pairingNotApproved"));
        void refresh();
      });
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

  const others = targets.filter((target) => !target.is_self);
  const nameOf = (deviceId: string) =>
    targets.find((target) => target.device_id === deviceId)?.name ?? t("remote.settings.unknownDevice");
  const controlPairing = controlling ? activeFor(controlling) : undefined;
  const live = pairings.filter((p) => p.status === "active" || p.status === "pending");

  return (
    <SettingsSectionLayout
      kicker={t("settings.index.remote.title")}
      title={t("settings.index.remote.title")}
      description={t("settings.index.remote.description")}
    >
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
              <span>
                <strong>{p.is_target ? p.controller_name : nameOf(p.target_device_id)}</strong>
                <span className="muted"> {p.scopes.join(", ")}</span>
              </span>
              <button type="button" className="btn btn-secondary" onClick={() => void revoke(p.id)}>
                {t("remote.pairings.revoke")}
              </button>
            </div>
          ))}
        </div>
      </section>
    </SettingsSectionLayout>
  );
}
