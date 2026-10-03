/**
 * Small monochrome line icons for the sidebar nav (`.sidebar-link-icon`).
 * Inline SVG rather than a package dependency -- `package.json` has no icon
 * set installed, and these four are simple enough not to warrant adding one.
 * Every path uses `stroke="currentColor"` so each icon inherits its parent
 * `.sidebar-link`'s color (secondary text at rest, accent on hover/active).
 */

type IconProps = {
  className?: string;
};

const ICON_PROPS = {
  viewBox: "0 0 24 24",
  width: 16,
  height: 16,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function HomeIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" />
    </svg>
  );
}

export function LibraryIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <rect x="3.5" y="4" width="17" height="16" rx="1.5" />
      <path d="M3.5 9h17" />
      <path d="M10 13.2v4.3l4-2.15z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MoviesIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m7 5 2-3M13 5l2-3M19 5l2-3" />
      <path d="m10 10 5 2.5-5 2.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SeriesIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 13h8M8 17h5" />
      <path d="m10 1 2 3 2-3" />
    </svg>
  );
}

export function SitesIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5S14.2 18.2 12 20.5M12 3.5C9.8 5.8 8.7 8.6 8.7 12s1.1 6.2 3.3 8.5" />
    </svg>
  );
}

export function MusicIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
      <path d="M9 10l10-2" />
    </svg>
  );
}

export function DownloadsIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M12 3v12" />
      <path d="m7 10.5 5 4.5 5-4.5" />
      <path d="M4.5 18.5v1.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-1.5" />
    </svg>
  );
}

export function PlaylistsIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M5 6h10M5 10h10M5 14h6" />
      <path d="M17 13.5v6" />
      <path d="m17 13.5 4-1.5v5.5" />
      <circle cx="15.5" cy="19.5" r="1.5" />
      <circle cx="19.5" cy="17.5" r="1.5" />
    </svg>
  );
}

export function WatchlistIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.5L5 21V4.5a1 1 0 0 1 1-1Z" />
      <path d="M12 7.5v5M9.5 10h5" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.5 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9c.77.66 1.65 1.17 2.6 1.5l.5 2.5h4l.5-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3.9 2-3.4z" />
    </svg>
  );
}

export function AdminIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M12 3 4.5 6v5.5C4.5 16.2 7.7 20.4 12 21.5c4.3-1.1 7.5-5.3 7.5-10V6z" />
      <path d="M9 12.2 11.2 14.5 15.5 10" />
    </svg>
  );
}
