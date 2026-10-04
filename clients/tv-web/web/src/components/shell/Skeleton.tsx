import type { CSSProperties } from "react";

/** Shimmering placeholder block; size it with `width`/`height` so loaded content swaps in without layout shift. */
export function SkeletonBlock({
  width,
  height,
  className,
  style,
}: {
  width?: string | number;
  height?: string | number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`skeleton${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      style={{ width, height, ...style }}
    />
  );
}

/** A stack of text-line placeholders; the last line is shorter. */
export function SkeletonLines({ count = 3, lineHeight = "0.9rem" }: { count?: number; lineHeight?: string }) {
  return (
    <span className="skeleton-lines" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonBlock key={i} height={lineHeight} width={i === count - 1 ? "55%" : "100%"} />
      ))}
    </span>
  );
}
