import { useEffect, useMemo, useRef, useState } from "react";
import { ApiClient } from "@playarr-tv/api-client";
import {
  parseServersParam,
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
  HOSTED_LINK_CLAIM_REDEMPTION_GRACE_MS,
  pollHostedDeviceLink,
  requestHostedDeviceLink,
  shouldUseHostedDeviceLink,
  type HostedLinkClientPlatform,
} from "../lib/hostedDeviceLink";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import { createLocalNetworkFetch } from "../lib/localNetworkFetch";
import { QrCode } from "./QrCode";
import { Button } from "./ui";

const PLAYARR_ICON_URL = `${import.meta.env.BASE_URL}playarr-icon.svg`;
const MAX_DEVICE_CODE_LIFETIME_SECONDS = 5 * 60;
const MAX_DEVICE_CODE_LIFETIME_MS =
  MAX_DEVICE_CODE_LIFETIME_SECONDS * 1000;
const browserFetch = createLocalNetworkFetch();

export interface DeviceLoginConnection {
  serverUrl: string;
  serverUrls: string[];
}

export function deviceCodeExpiresAt(
  code: DeviceCodeResponse,
  now = Date.now()
): number {
  const hostedExpiry = (code as DeviceCodeResponse & { expiresAt?: number }).expiresAt;
  const expiresAt = hostedExpiry ?? now + code.expiresInSeconds * 1000;
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now
  ) {
    throw new Error("Playarr returned an invalid device-code expiry.");
  }
  return Math.min(expiresAt, now + MAX_DEVICE_CODE_LIFETIME_MS);
}

export function deviceCodeSecondsRemaining(
  expiresAt: number,
  now = Date.now()
): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export function formatDeviceCodeCountdown(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(clamped / 60);
  return `${minutes}:${String(clamped % 60).padStart(2, "0")}`;
}

export function directDeviceLoginConnection(
  serverUrl: string,
  verificationUriComplete: string
): DeviceLoginConnection {
  let bundledServerUrls: string[] = [];
  try {
    bundledServerUrls =
      parseServersParam(new URL(verificationUriComplete, serverUrl).search) ?? [];
  } catch {
    // A valid device response should contain a URL, but the selected server
    // remains sufficient if an older or non-conforming server omits one.
  }
  return {
    serverUrl,
    serverUrls: [...new Set([serverUrl, ...bundledServerUrls])],
  };
}

function isExpiredCodeError(reason: unknown): boolean {
  return reason instanceof Error && /\bexpired\b/i.test(reason.message);
}

export function DeviceLogin({
  embedded = false,
  hostedLink = false,
  onBack,
  onAuthenticated,
  serverUrl,
}: {
  embedded?: boolean;
  hostedLink?: boolean;
  onBack?: () => void;
  onAuthenticated: (
    token: DeviceTokenSuccess,
    connection?: DeviceLoginConnection
  ) => void;
  serverUrl?: string;
}) {
  const { t } = useLanguage();
  const providerClient = useApiClient();
  const client = useMemo(
    () =>
      serverUrl
        ? new ApiClient({
            baseUrl: serverUrl,
            fetchImpl: browserFetch,
            defaultHeaders: {
              "X-Playarr-Client-Platform": PLAYARR_CLIENT_PLATFORM,
              "X-Playarr-Client-Version": __APP_VERSION__,
            },
          })
        : providerClient,
    [providerClient, serverUrl]
  );
  // A brokered `/login/qr` attempt must not restart when the global provider
  // discovers or switches a remembered server in the background.
  const directClient = hostedLink ? null : client;
  const directServerUrl = hostedLink ? undefined : serverUrl;
  const callbackRef = useRef(onAuthenticated);
  const [deviceCode, setDeviceCode] = useState<DeviceCodeResponse | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  callbackRef.current = onAuthenticated;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let countdownInterval: number | undefined;
    let blankTimeout: number | undefined;
    let refreshTimeout: number | undefined;
    setDeviceCode(null);
    setSecondsRemaining(null);
    setError(null);

    const clearExpiryTimers = () => {
      if (countdownInterval !== undefined) {
        window.clearInterval(countdownInterval);
      }
      if (blankTimeout !== undefined) {
        window.clearTimeout(blankTimeout);
      }
      if (refreshTimeout !== undefined) {
        window.clearTimeout(refreshTimeout);
      }
    };

    const renewCode = () => {
      if (cancelled) return;
      cancelled = true;
      clearExpiryTimers();
      controller.abort();
      setDeviceCode(null);
      setSecondsRemaining(MAX_DEVICE_CODE_LIFETIME_SECONDS);
      setAttempt((value) => value + 1);
    };

    const completeAuthentication = (
      token: DeviceTokenSuccess,
      connection?: DeviceLoginConnection
    ) => {
      if (cancelled) return;
      clearExpiryTimers();
      callbackRef.current(token, connection);
      cancelled = true;
      controller.abort();
    };

    const showCode = (
      code: DeviceCodeResponse,
      renewalGraceMilliseconds = 0
    ) => {
      const expiresAt = deviceCodeExpiresAt(code);
      const expiresInMilliseconds = Math.max(0, expiresAt - Date.now());
      const updateCountdown = () => {
        if (!cancelled) {
          setSecondsRemaining(deviceCodeSecondsRemaining(expiresAt));
        }
      };
      setDeviceCode(code);
      updateCountdown();
      countdownInterval = window.setInterval(updateCountdown, 1000);
      blankTimeout = window.setTimeout(() => {
        if (cancelled) return;
        if (countdownInterval !== undefined) {
          window.clearInterval(countdownInterval);
        }
        setDeviceCode(null);
        setSecondsRemaining(MAX_DEVICE_CODE_LIFETIME_SECONDS);
      }, expiresInMilliseconds);
      refreshTimeout = window.setTimeout(
        renewCode,
        expiresInMilliseconds + renewalGraceMilliseconds
      );
    };

    void (async () => {
      if (
        hostedLink ||
        shouldUseHostedDeviceLink(
          IS_PACKAGED_TV,
          window.PlayarrPackagedConfig?.apiBaseUrl,
          PLAYARR_CLIENT_PLATFORM
        )
      ) {
        const platform =
          PLAYARR_CLIENT_PLATFORM as HostedLinkClientPlatform;
        const code = await requestHostedDeviceLink(platform);
        if (cancelled) return;
        showCode(code, HOSTED_LINK_CLAIM_REDEMPTION_GRACE_MS);
        const claim = await pollHostedDeviceLink(code, { signal: controller.signal });
        if (cancelled) return;
        clearExpiryTimers();
        const serverUrl = publicIpv4RelayUrl(claim.server_url);
        const serverUrls = [...new Set([claim.server_url, ...claim.server_urls])].map(
          (url) => publicIpv4RelayUrl(url)
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
            expiresInSeconds: MAX_DEVICE_CODE_LIFETIME_SECONDS,
            intervalSeconds: 0,
          },
          { signal: controller.signal }
        );
        completeAuthentication(token, { serverUrl, serverUrls });
        return;
      }

      if (!directClient) {
        throw new Error("Brokered device login could not start.");
      }
      const code = await requestDeviceCode(
        directClient,
        PLAYARR_CLIENT_PLATFORM
      );
      if (cancelled) return;
      showCode(code);
      const token = await pollForToken(directClient, code, {
        signal: controller.signal,
      });
      completeAuthentication(
        token,
        directServerUrl
          ? directDeviceLoginConnection(
              directServerUrl,
              code.verificationUriComplete
            )
          : undefined
      );
    })().catch((reason: unknown) => {
      if (!cancelled) {
        if (isExpiredCodeError(reason)) {
          renewCode();
        } else {
          clearExpiryTimers();
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    });

    return () => {
      cancelled = true;
      clearExpiryTimers();
      controller.abort();
    };
  }, [attempt, directClient, directServerUrl, hostedLink]);

  const loginState = (
    <>
      {!error && (
        <div
          className="device-login-options"
          aria-busy={deviceCode ? undefined : true}
        >
          {deviceCode ? (
            <QrCode value={deviceCode.verificationUriComplete} />
          ) : (
            <div
              className="device-login-qr device-login-qr-placeholder"
              aria-hidden="true"
            />
          )}
          <div className="device-login-instructions">
            <p className={`muted${deviceCode ? "" : " device-login-blank"}`}>
              {t("components.deviceLogin.scanQr")}
            </p>
            <p
              className={`device-login-url${
                deviceCode ? "" : " device-login-blank"
              }`}
            >
              {deviceCode?.verificationUri ?? "\u00a0"}
            </p>
            <p className={`muted${deviceCode ? "" : " device-login-blank"}`}>
              {t("components.deviceLogin.enterCode")}
            </p>
            <p
              className={`device-login-code${
                deviceCode ? "" : " device-login-blank"
              }`}
              aria-label={
                deviceCode
                  ? t("components.deviceLogin.pairingCode", {
                      code: deviceCode.userCode,
                    })
                  : undefined
              }
            >
              {deviceCode?.userCode ?? "\u00a0"}
            </p>
            <p className={`hint${deviceCode ? "" : " device-login-blank"}`}>
              {t("components.deviceLogin.waitingApproval")}
            </p>
            <time
              className="device-login-timer"
              dateTime={`PT${
                secondsRemaining ?? MAX_DEVICE_CODE_LIFETIME_SECONDS
              }S`}
              role="timer"
            >
              {t("components.deviceLogin.refreshesIn", {
                time: formatDeviceCodeCountdown(
                  secondsRemaining ?? MAX_DEVICE_CODE_LIFETIME_SECONDS
                ),
              })}
            </time>
          </div>
        </div>
      )}

      {error && (
        <div className="device-login-error">
          <p className="error-text">{error}</p>
          <Button
            type="button" variant="primary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t("components.deviceLogin.tryAgain")}
          </Button>
        </div>
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="device-login-embedded">
        {loginState}
        {onBack && (
          <Button
            type="button" className="device-login-manual"
            onClick={onBack}
          >
            {t("components.deviceLogin.signInManually")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="auth-page device-login-page">
      <div className="auth-backdrop" aria-hidden="true" />
      <div
        className="auth-card device-login-card"
        data-tv-scroll-container
        data-tv-scroll-axis="vertical"
        data-navigation-scroll-key="auth:device-login"
      >
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
        {loginState}
      </div>
    </div>
  );
}
