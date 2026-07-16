import { useEffect, useRef, useState } from "react";
import {
  pollForToken,
  requestDeviceCode,
  type DeviceCodeResponse,
  type DeviceTokenSuccess,
} from "@streamarr-tv/device-auth";
import { useApiClient } from "../lib/ApiClientProvider";
import { PLAYARR_CLIENT_PLATFORM } from "../lib/clientPlatform";
import { QrCode } from "./QrCode";

export function DeviceLogin({
  onAuthenticated,
}: {
  onAuthenticated: (token: DeviceTokenSuccess) => void;
}) {
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
            <img className="app-logo-icon" src="/playarr-icon.svg" alt="" />
            <span><span className="app-logo-accent">Play</span>arr</span>
          </span>
        </div>
        <p className="page-kicker">Sign in on another device</p>
        <h1 className="auth-title">Link this TV</h1>

        {!deviceCode && !error && <p className="muted auth-description">Creating a secure sign-in code…</p>}

        {deviceCode && !error && (
          <div className="device-login-options">
            <QrCode value={deviceCode.verificationUriComplete} />
            <div className="device-login-instructions">
              <p className="muted">Scan the QR code, or visit</p>
              <p className="device-login-url">{deviceCode.verificationUri}</p>
              <p className="muted">and enter this code</p>
              <p className="device-login-code" aria-label={`Pairing code ${deviceCode.userCode}`}>
                {deviceCode.userCode}
              </p>
              <p className="hint">Waiting for approval…</p>
            </div>
          </div>
        )}

        {error && (
          <div className="device-login-error">
            <p className="error-text">{error}</p>
            <button type="button" className="btn btn-primary" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
