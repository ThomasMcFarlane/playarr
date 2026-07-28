import type { RefObject } from "react";
import { color, radius, spacing, typeScale } from "@playarr-tv/design-tokens";
import { useFocusable } from "../SpatialNavContext";
import { QrCode } from "../QrCode";

export interface PairingScreenProps {
  /** RFC 8628 §3.2's short user-facing code, e.g. "ABCD-1234". */
  userCode?: string;
  verificationUri?: string;
  /** RFC 8628 §3.3.1: verification URI with the user code pre-filled, if the server supports it. */
  verificationUriComplete?: string;
  status: "requesting" | "pending" | "slow_down" | "error";
  errorMessage?: string;
  onRetry?: () => void;
}

/**
 * Shown before a TV app has an access token: requests a device code, then
 * displays it full-screen so the viewer can approve it from a phone/laptop,
 * per RFC 8628's device authorization grant. No spatial-nav focusables are
 * needed while waiting -- only the retry action (shown on `"error"`) is
 * focusable.
 */
export function PairingScreen({
  userCode,
  verificationUri,
  verificationUriComplete,
  status,
  errorMessage,
  onRetry,
}: PairingScreenProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100%",
        gap: spacing.lg,
        background: color.background.base,
        color: color.text.primary,
        padding: spacing.xxxl,
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: typeScale.display.fontSize, margin: 0 }}>Playarr Server</h1>

      {status === "requesting" && (
        <p style={{ fontSize: typeScale.body.fontSize, color: color.text.secondary }}>
          Requesting a pairing code...
        </p>
      )}

      {(status === "pending" || status === "slow_down") && userCode && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: spacing.xxxl,
              width: "100%",
            }}
          >
            {verificationUriComplete && <QrCode value={verificationUriComplete} size={260} />}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: spacing.md }}>
              <p style={{ fontSize: typeScale.subtitle.fontSize, color: color.text.secondary, margin: 0 }}>
                Scan the QR code, or visit
              </p>
              <p style={{ fontSize: typeScale.title.fontSize, fontWeight: 700, margin: 0 }}>
                {verificationUri}
              </p>
              <p style={{ fontSize: typeScale.subtitle.fontSize, color: color.text.secondary, margin: 0 }}>
                and enter the code
              </p>
              <p
                style={{
                  fontSize: 64,
                  fontWeight: 700,
                  letterSpacing: 8,
                  margin: 0,
                  padding: `${spacing.md}px ${spacing.xl}px`,
                  borderRadius: radius.lg,
                  backgroundColor: color.background.raised,
                }}
              >
                {userCode}
              </p>
            </div>
          </div>
          {status === "slow_down" && (
            <p style={{ fontSize: typeScale.caption.fontSize, color: color.text.disabled }}>
              Still waiting...
            </p>
          )}
        </>
      )}

      {status === "error" && (
        <>
          <p style={{ fontSize: typeScale.body.fontSize, color: color.state.error }}>
            {errorMessage ?? "Pairing failed."}
          </p>
          {onRetry && <RetryButton onSelect={onRetry} />}
        </>
      )}
    </div>
  );
}

function RetryButton({ onSelect }: { onSelect: () => void }) {
  const { ref, isFocused } = useFocusable("pairing-retry", "pairing-actions");

  return (
    <button
      ref={ref as RefObject<HTMLButtonElement>}
      type="button"
      onClick={onSelect}
      style={{
        padding: `${spacing.sm}px ${spacing.xl}px`,
        borderRadius: radius.sm,
        border: isFocused ? `3px solid ${color.focus.ring}` : "3px solid transparent",
        outline: "none",
        backgroundColor: color.brand.primary,
        color: color.text.primary,
        fontSize: typeScale.bodyEmphasis.fontSize,
        fontWeight: typeScale.bodyEmphasis.fontWeight,
        transform: isFocused ? "scale(1.05)" : "scale(1)",
        transition: "transform 150ms cubic-bezier(0.4, 0, 0.2, 1)",
        cursor: "pointer",
      }}
    >
      Try again
    </button>
  );
}
