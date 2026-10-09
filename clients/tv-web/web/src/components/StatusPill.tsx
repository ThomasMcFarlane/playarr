import type { HTMLAttributes, ReactNode } from "react";

/** The state a pill reports. Neutral is plain information (a kind, a date). */
export type StatusPillTone =
  | "neutral"
  | "available"
  | "downloading"
  | "upcoming"
  | "missing"
  | "requested";

/**
 * A small rounded chip for a short, user-facing state ("Available", "Upcoming"). It replaces label/value rows
 * in the details panel. Colours come from the design tokens and follow the theme.
 */
export function StatusPill({
  tone = "neutral",
  className,
  children,
  ...rest
}: { tone?: StatusPillTone; children: ReactNode } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`status-pill is-${tone}${className ? ` ${className}` : ""}`} {...rest}>
      {children}
    </span>
  );
}
