import type { ReactNode } from "react";

/** The one icon map for header actions. Pages name an icon; they never draw an inline SVG. */
export type ActionIcon = "filters" | "bell" | "add" | "customise" | "calendar" | "prev" | "next" | "back";

/** Arrow icons keep the text glyphs the round header buttons have always used. */
const ARROWS: Partial<Record<ActionIcon, string>> = { prev: "←", next: "→", back: "←" };

const PATHS: Record<Exclude<ActionIcon, "prev" | "next" | "back">, ReactNode> = {
  filters: (
    <>
      <path d="M4 6h16M7 12h10m-7 6h4" />
      <circle cx="8" cy="6" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="12" cy="18" r="1.5" />
    </>
  ),
  bell: <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0" />,
  add: <path d="M12 5v14M5 12h14" />,
  calendar: <path d="M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM4 10h16M8 4v4m8-4v4" />,
  customise: <path d="M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 16h6M16 13v6" />,
};

export function isArrowIcon(icon: ActionIcon): boolean {
  return icon in ARROWS;
}

export function ActionIconGlyph({ icon }: { icon: ActionIcon }) {
  const arrow = ARROWS[icon];
  if (arrow) return <span aria-hidden="true">{arrow}</span>;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[icon as keyof typeof PATHS]}
    </svg>
  );
}
