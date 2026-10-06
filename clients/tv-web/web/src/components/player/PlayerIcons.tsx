/**
 * Small monochrome line icons for the custom player control bar, matching
 * `components/NavIcons.tsx`'s convention: inline SVG (no icon package
 * dependency), `stroke="currentColor"` so each icon inherits its parent
 * `.player-btn`'s color.
 */

type IconProps = {
  className?: string;
};

const ICON_PROPS = {
  viewBox: "0 0 24 24",
  width: 20,
  height: 20,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function PlayIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} fill="currentColor" stroke="none" className={className}>
      <path d="M7 4.5v15l13-7.5z" />
    </svg>
  );
}

export function PauseIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} fill="currentColor" stroke="none" className={className}>
      <rect x="6" y="4.5" width="4.5" height="15" rx="1" />
      <rect x="13.5" y="4.5" width="4.5" height="15" rx="1" />
    </svg>
  );
}

export function PreviousIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} fill="currentColor" stroke="none" className={className}>
      <rect x="4.5" y="5" width="2.4" height="14" rx="1" />
      <path d="M19.5 5.5v13L8.2 12z" />
    </svg>
  );
}

export function NextIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} fill="currentColor" stroke="none" className={className}>
      <rect x="17.1" y="5" width="2.4" height="14" rx="1" />
      <path d="M4.5 5.5v13L15.8 12z" />
    </svg>
  );
}

export function AudioTrackIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M5 9.5v5h4l4.5 3.5V6L9 9.5z" fill="currentColor" stroke="none" />
      <path d="M16.5 9a4.5 4.5 0 0 1 0 6" />
      <path d="M19 6.5a8 8 0 0 1 0 11" />
    </svg>
  );
}

export function SubtitlesIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M6.5 12h4" />
      <path d="M13.5 12h4" />
      <path d="M6.5 15.5h7" />
      <path d="M15.5 15.5h2" />
    </svg>
  );
}

export function PlaylistIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M4 6.5h10" />
      <path d="M4 11.5h10" />
      <path d="M4 16.5h7" />
      <path d="m16 14 4 2.5-4 2.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function HealthIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function VolumeHighIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M4 9.5v5h4l5 4V5.5l-5 4z" fill="currentColor" stroke="none" />
      <path d="M17 8.5a5 5 0 0 1 0 7" />
      <path d="M19.7 6a9 9 0 0 1 0 12" />
    </svg>
  );
}

export function VolumeMutedIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M4 9.5v5h4l5 4V5.5l-5 4z" fill="currentColor" stroke="none" />
      <path d="M16 10.5 21 15.5" />
      <path d="M21 10.5 16 15.5" />
    </svg>
  );
}

export function FullscreenEnterIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9" />
      <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9" />
      <path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15" />
      <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
    </svg>
  );
}

export function FullscreenExitIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4" />
      <path d="M15 4v3.5A1.5 1.5 0 0 0 16.5 9H20" />
      <path d="M20 15h-3.5a1.5 1.5 0 0 0-1.5 1.5V20" />
      <path d="M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20" />
    </svg>
  );
}

export function BackIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M15 5 8 12l7 7" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

export function MinimiseIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M5 15h4v4" />
      <path d="m9 15-5 5" />
      <path d="M19 9h-4V5" />
      <path d="m15 9 5-5" />
    </svg>
  );
}

export function MaximiseIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M9 15H5v4" />
      <path d="m5 19 5-5" />
      <path d="M15 9h4V5" />
      <path d="m19 5-5 5" />
    </svg>
  );
}

export function SpinnerIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={40} height={40} className={className} aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="9.5"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2.5"
      />
      <path
        d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ErrorIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} width={40} height={40} className={className}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 7.5v6" />
      <circle cx="12" cy="16.7" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function LockIcon({ className }: IconProps) {
  return (
    <svg {...ICON_PROPS} width={40} height={40} className={className}>
      <rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
