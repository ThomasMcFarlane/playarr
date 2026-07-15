import type { RefObject } from "react";
import type { Work } from "@streamarr-tv/api-client";
import { color, radius, spacing, typeScale } from "@streamarr-tv/design-tokens";
import { useFocusable } from "../SpatialNavContext";
import { pickImage } from "../lib/images";

export interface DetailScreenProps {
  work: Work;
  onPlay: () => void;
  onBack?: () => void;
}

/** Full-bleed backdrop + synopsis + a focusable "Play" action. Skeleton, no real layout system yet. */
export function DetailScreen({ work, onPlay, onBack }: DetailScreenProps) {
  const backdropUrl = pickImage(work.images, "backdrop") ?? pickImage(work.images, "poster");

  return (
    <div
      style={{
        position: "relative",
        minHeight: "100%",
        backgroundColor: color.background.base,
        backgroundImage: backdropUrl ? `url(${backdropUrl})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(180deg, transparent 0%, ${color.background.overlay} 70%)`,
        }}
      />
      <div
        style={{
          position: "relative",
          padding: spacing.xxxl,
          maxWidth: 800,
          display: "flex",
          flexDirection: "column",
          gap: spacing.md,
        }}
      >
        <h1
          style={{
            color: color.text.primary,
            fontSize: typeScale.display.fontSize,
            fontWeight: typeScale.display.fontWeight,
            margin: 0,
          }}
        >
          {work.title}
        </h1>
        <p
          style={{
            color: color.text.secondary,
            fontSize: typeScale.body.fontSize,
            lineHeight: `${typeScale.body.lineHeight}px`,
            margin: 0,
          }}
        >
          {work.overview ?? "No synopsis available."}
        </p>
        <div style={{ display: "flex", gap: spacing.md, marginTop: spacing.lg }}>
          <ActionButton id="detail-play" label="Play" primary onSelect={onPlay} />
          {onBack && <ActionButton id="detail-back" label="Back" onSelect={onBack} />}
        </div>
      </div>
    </div>
  );
}

interface ActionButtonProps {
  id: string;
  label: string;
  primary?: boolean;
  onSelect: () => void;
}

function ActionButton({ id, label, primary, onSelect }: ActionButtonProps) {
  const { ref, isFocused } = useFocusable(id, "detail-actions");

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
        backgroundColor: primary ? color.brand.primary : color.background.raised,
        color: color.text.primary,
        fontSize: typeScale.bodyEmphasis.fontSize,
        fontWeight: typeScale.bodyEmphasis.fontWeight,
        transform: isFocused ? "scale(1.05)" : "scale(1)",
        transition: "transform 150ms cubic-bezier(0.4, 0, 0.2, 1)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
