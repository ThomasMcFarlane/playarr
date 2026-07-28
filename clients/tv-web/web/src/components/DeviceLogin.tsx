import { useEffect, useRef, useState } from "react";
import { ApiClient } from "@playarr-tv/api-client";
import {
  pollForToken,
  requestDeviceCode,
  type DeviceCodeResponse,
  type DeviceTokenSuccess,
} from "@playarr-tv/device-auth";
import { publicIpv4RelayUrl } from "../lib/loginServerUrl";
import { useApiClient } from "../lib/ApiClientProvider";
import {
  IS_PACKAGED_TV,
  PLAYARR_CLIENT_PLATFORM,
} from "../lib/clientPlatform";
import {
  pollHostedDeviceLink,
  requestHostedDeviceLink,
  shouldUseHostedDeviceLink,
} from "../lib/hostedDeviceLink";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import { createLocalNetworkFetch } from "../lib/localNetworkFetch";
import { QrCode } from "./QrCode";

const PLAYARR_ICON_URL = `${import.meta.env.BASE_URL}playarr-icon.svg`;
const browserFetch = createLocalNetworkFetch();

export interface DeviceLoginConnection {
  serverUrl: string;
  serverUrls: string[];
}

export function DeviceLogin({
  onAuthenticated,
}: {
  onAuthenticated: (
    token: DeviceTokenSuccess,
    connection?: DeviceLoginConnection
  ) => void;
}) {
  const { t } = useLanguage();
  const client = useApiClient();
  const callbackRef = useRef(onAuthenticated);
  const [deviceCode, setDeviceCode] = useState<DeviceCodeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  callbackRef.current = onAuthenticated;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setDeviceCode(null);
    setError(null);

    void (async () => {
      if (
        shouldUseHostedDeviceLink(
          IS_PACKAGED_TV,
          window.PlayarrPackagedConfig?.apiBaseUrl,
          PLAYARR_CLIENT_PLATFORM
        )
      ) {
        const platform = PLAYARR_CLIENT_PLATFORM as "tv-webos" | "tv-tizen" | "tv-vidaa" | "xbox";
        const code = await requestHostedDeviceLink(platform);
        if (cancelled) return;
        setDeviceCode(code);
        const claim = await pollHostedDeviceLink(code, { signal: controller.signal });
        const serverUrl = publicIpv4RelayUrl(claim.server_url);
        const serverUrls = [...new Set([claim.server_url, ...claim.server_urls])].map(
          publicIpv4RelayUrl
        );
        const serverClient = new ApiClient({
          baseUrl: serverUrl,
          fetchImpl: browserFetch,
          defaultHeaders: {
            "X-Playarr-Client-Platform": platform,
            "X-Playarr-Client-Version": __APP_VERSION__,
          },
        });
        const token = await pollForToken(
          serverClient,
          {
            deviceCode: claim.server_device_code,
            userCode: claim.user_code,
            verificationUri: code.verificationUri,
            verificationUriComplete: code.verificationUriComplete,
            expiresInSeconds: Math.max(
              1,
              Math.floor((code.expiresAt - Date.now()) / 1000)
            ),
            intervalSeconds: 1,
          },
          { signal: controller.signal }
        );
        if (!cancelled) callbackRef.current(token, { serverUrl, serverUrls });
        return;
      }

      const code = await requestDeviceCode(client, PLAYARR_CLIENT_PLATFORM);
      if (cancelled) return;
      setDeviceCode(code);
      const token = await pollForToken(client, code, { signal: controller.signal });
      if (!cancelled) callbackRef.current(token);
    })().catch((reason: unknown) => {
      if (!cancelled) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [attempt, client]);

  return (
    <div className="auth-page device-login-page">
      <div className="auth-backdrop" aria-hidden="true" />
      <div className="auth-card device-login-card">
        <div className="auth-header">
          <span className="app-logo">
            <img
              className="app-logo-icon"
              src={PLAYARR_ICON_URL}
              alt=""
            />
            <span><span className="app-logo-accent">Play</span>arr</span>
          </span>
        </div>
        <p className="page-kicker">{t("components.deviceLogin.kicker")}</p>
        <h1 className="auth-title">{t("components.deviceLogin.title")}</h1>

        {!deviceCode && !error && <p className="muted auth-description">{t("components.deviceLogin.creatingCode")}</p>}

        {deviceCode && !error && (
          <div className="device-login-options">
            <QrCode value={deviceCode.verificationUriComplete} />
            <div className="device-login-instructions">
              <p className="muted">{t("components.deviceLogin.scanQr")}</p>
              <p className="device-login-url">{deviceCode.verificationUri}</p>
              <p className="muted">{t("components.deviceLogin.enterCode")}</p>
              <p
                className="device-login-code"
                aria-label={t("components.deviceLogin.pairingCode", { code: deviceCode.userCode })}
              >
                {deviceCode.userCode}
              </p>
              <p className="hint">{t("components.deviceLogin.waitingApproval")}</p>
            </div>
          </div>
        )}

        {error && (
          <div className="device-login-error">
            <p className="error-text">{error}</p>
            <button type="button" className="btn btn-primary" onClick={() => setAttempt((value) => value + 1)}>
              {t("components.deviceLogin.tryAgain")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
