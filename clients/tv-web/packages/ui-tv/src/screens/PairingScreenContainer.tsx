import { useEffect, useRef, useState } from "react";
import type { ApiClient, ClientPlatform } from "@playarr-tv/api-client";
import {
  pollForToken,
  requestDeviceCode,
  type DeviceCodeResponse,
  type DeviceTokenSuccess,
} from "@playarr-tv/device-auth";
import { PairingScreen } from "./PairingScreen";

export interface PairingScreenContainerProps {
  client: ApiClient;
  clientPlatform: ClientPlatform;
  onAuthenticated: (token: DeviceTokenSuccess) => void;
}

type State =
  | { phase: "requesting" }
  | { phase: "pending"; deviceCode: DeviceCodeResponse; slowDown: boolean }
  | { phase: "error"; message: string };

/**
 * Drives the real RFC 8628 device authorization flow end to end on TV app
 * startup: `POST /api/v1/oauth/device/code`, display the user code, then
 * poll `POST /api/v1/oauth/token` until the viewer approves it elsewhere
 * (or the flow is denied/expires), handling every §3.5 error code the spec
 * defines. `onAuthenticated` is called once with the resulting access token.
 */
export function PairingScreenContainer({ client, clientPlatform, onAuthenticated }: PairingScreenContainerProps) {
  const [state, setState] = useState<State>({ phase: "requesting" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    setState({ phase: "requesting" });

    (async () => {
      const deviceCode = await requestDeviceCode(client, clientPlatform);
      if (cancelled) return;
      setState({ phase: "pending", deviceCode, slowDown: false });

      const token = await pollForToken(client, deviceCode, {
        signal: controller.signal,
        onPending: () => {
          // authorization_pending ticks; nothing to surface beyond staying on the "pending" phase.
        },
      });
      if (cancelled) return;
      onAuthenticated(token);
    })().catch((error: unknown) => {
      if (cancelled) return;
      setState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, clientPlatform, attempt]);

  const slowDownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (state.phase !== "pending" || state.slowDown) return;
    // Purely cosmetic: nudge the UI to the "slow_down"-flavored copy if a pairing attempt
    // runs long, without needing device-auth to expose its internal poll interval state.
    slowDownTimer.current = setTimeout(() => {
      setState((current) => (current.phase === "pending" ? { ...current, slowDown: true } : current));
    }, 30_000);
    return () => {
      if (slowDownTimer.current) clearTimeout(slowDownTimer.current);
    };
  }, [state]);

  if (state.phase === "requesting") {
    return <PairingScreen status="requesting" />;
  }
  if (state.phase === "error") {
    return (
      <PairingScreen
        status="error"
        errorMessage={state.message}
        onRetry={() => setAttempt((current) => current + 1)}
      />
    );
  }

  return (
    <PairingScreen
      status={state.slowDown ? "slow_down" : "pending"}
      userCode={state.deviceCode.userCode}
      verificationUri={state.deviceCode.verificationUri}
      verificationUriComplete={state.deviceCode.verificationUriComplete}
    />
  );
}
