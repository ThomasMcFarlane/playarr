import { color, spacing, typeScale } from "@playarr-tv/design-tokens";
import type { ClientVersionEvaluation } from "@playarr-tv/domain";

export interface VersionBannerProps {
  evaluation: ClientVersionEvaluation;
}

/**
 * Non-blocking "you're running an old build" banner for the TV app shells
 * (webOS, Tizen, VIDAA fallback). Per
 * `docs/versioning-policy.md`'s per-platform update table, none of these
 * three have an OTA loophole -- every update, including a required one,
 * only arrives through a full store resubmission and review cycle -- so
 * unlike the Web app's forced-reload-below-floor behaviour, there is
 * nothing this banner can *do* about an unsupported version besides tell
 * the viewer to update via their TV's app store. It renders above the
 * current screen without blocking input to it.
 */
export function VersionBanner({ evaluation }: VersionBannerProps) {
  if (evaluation.status === "supported") return null;

  const isUnsupported = evaluation.status === "unsupported";
  const message = isUnsupported
    ? "This app is out of date and no longer fully supported. Please update it from your TV's app store."
    : "A newer version of this app is available. Please update it from your TV's app store when you can.";

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.sm,
        padding: `${spacing.sm}px ${spacing.lg}px`,
        backgroundColor: isUnsupported ? color.state.error : color.state.warning,
        color: color.text.inverse,
        fontSize: typeScale.caption.fontSize,
        fontWeight: typeScale.bodyEmphasis.fontWeight,
        textAlign: "center",
        pointerEvents: "none",
      }}
    >
      {message}
      {evaluation.latestVersion && ` (latest: ${evaluation.latestVersion})`}
    </div>
  );
}
