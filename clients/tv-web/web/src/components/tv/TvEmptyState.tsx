import type { HTMLAttributes } from "react";

type TvEmptyStateVariant = "page" | "rail" | "track" | "compact";
type TvEmptyStateTone = "empty" | "error";
type TvEmptyStateGraphic =
  | "home"
  | "movies"
  | "series"
  | "music"
  | "search"
  | "playlist"
  | "move"
  | "details";

interface TvEmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: string;
  description?: string;
  graphic?: TvEmptyStateGraphic;
  announce?: boolean;
  tone?: TvEmptyStateTone;
  variant?: TvEmptyStateVariant;
}

function EmptyStateGraphic({ graphic }: { graphic: TvEmptyStateGraphic }) {
  const sharedProps = {
    viewBox: "0 0 48 32",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (graphic) {
    case "home":
      return (
        <svg {...sharedProps}>
          <path d="m8 16 16-11 16 11" />
          <path d="M12 14v13h24V14M20 27v-8h8v8" />
        </svg>
      );
    case "movies":
      return (
        <svg {...sharedProps}>
          <rect x="6" y="7" width="36" height="20" rx="3" />
          <path d="M13 7v20M35 7v20M6 13h7M6 21h7M35 13h7M35 21h7" />
          <path d="m21 13 8 4-8 4z" />
        </svg>
      );
    case "series":
      return (
        <svg {...sharedProps}>
          <rect x="7" y="8" width="34" height="20" rx="3" />
          <path d="m18 3 6 5 6-5M13 14h16M13 20h12M35 14v8" />
        </svg>
      );
    case "music":
      return (
        <svg {...sharedProps}>
          <path d="M19 25V8l20-4v16" />
          <circle cx="13" cy="25" r="6" />
          <circle cx="33" cy="20" r="6" />
          <path d="M19 14l20-4" />
        </svg>
      );
    case "search":
      return (
        <svg {...sharedProps}>
          <circle cx="21" cy="14" r="9" />
          <path d="m28 21 9 8M17 14h8" />
        </svg>
      );
    case "move":
      return (
        <svg {...sharedProps}>
          <path d="M7 8h23M7 16h19M7 24h23" />
          <path d="m34 12 7 4-7 4M38 8v16" />
        </svg>
      );
    case "details":
      return (
        <svg {...sharedProps}>
          <rect x="7" y="5" width="34" height="22" rx="3" />
          <path d="M13 12h14M13 17h20M13 22h12" />
          <circle cx="35" cy="11" r="2" />
        </svg>
      );
    case "playlist":
    default:
      return (
        <svg {...sharedProps}>
          <path d="M8 8h25M8 16h20M8 24h25" />
          <path d="M38 13v12M32 19h12" />
        </svg>
      );
  }
}

/** Shared, borderless TV empty state for valid collections with no content. */
export function TvEmptyState({
  title,
  description,
  graphic = "details",
  announce = true,
  tone = "empty",
  variant = "rail",
  className = "",
  ...props
}: TvEmptyStateProps) {
  return (
    <div
      className={`tv-empty-state is-${variant} graphic-${graphic} tone-${tone}${
        className ? ` ${className}` : ""
      }`}
      role={announce ? (tone === "error" ? "alert" : "status") : undefined}
      {...props}
    >
      <span className="tv-empty-state-art" aria-hidden="true">
        {graphic === "search" || graphic === "details" ? null : (
          <>
            <i />
            <i />
            <i />
          </>
        )}
        <b>
          <EmptyStateGraphic graphic={graphic} />
        </b>
      </span>
      <span className="tv-empty-state-copy">
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </span>
    </div>
  );
}
