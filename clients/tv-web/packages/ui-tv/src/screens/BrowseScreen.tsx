import type { RefObject } from "react";
import type { Work } from "@streamarr-tv/domain";
import { color, radius, spacing, typeScale } from "@streamarr-tv/design-tokens";
import { useFocusable } from "../SpatialNavContext";

export interface BrowseRow {
  id: string;
  title: string;
  works: Work[];
}

export interface BrowseScreenProps {
  rows: BrowseRow[];
  onSelectWork: (work: Work) => void;
}

/**
 * Netflix-style shelves of horizontally-scrolling tiles. This is a
 * skeleton: real implementations will add windowed/virtualized rows,
 * lazy-loaded artwork, and row-level paging, but the focus-navigation
 * wiring (via `useFocusable`) is real and usable as-is.
 */
export function BrowseScreen({ rows, onSelectWork }: BrowseScreenProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing.xl,
        padding: spacing.xl,
        background: color.background.base,
        minHeight: "100%",
      }}
    >
      {rows.map((row) => (
        <section key={row.id}>
          <h2
            style={{
              color: color.text.primary,
              fontSize: typeScale.title.fontSize,
              fontWeight: typeScale.title.fontWeight,
              marginBottom: spacing.md,
            }}
          >
            {row.title}
          </h2>
          <div style={{ display: "flex", gap: spacing.md, overflowX: "auto" }}>
            {row.works.map((work) => (
              <WorkTile key={work.id} work={work} onSelect={() => onSelectWork(work)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

interface WorkTileProps {
  work: Work;
  onSelect: () => void;
}

function WorkTile({ work, onSelect }: WorkTileProps) {
  const { ref, isFocused } = useFocusable(`work-tile-${work.id}`, "browse-row");

  return (
    <button
      ref={ref as RefObject<HTMLButtonElement>}
      type="button"
      onClick={onSelect}
      style={{
        flex: "0 0 auto",
        width: 240,
        height: 135,
        borderRadius: radius.md,
        border: isFocused ? `3px solid ${color.focus.ring}` : "3px solid transparent",
        outline: "none",
        backgroundColor: color.background.raised,
        backgroundImage: work.artwork.thumbUrl ? `url(${work.artwork.thumbUrl})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
        transform: isFocused ? "scale(1.08)" : "scale(1)",
        transition: "transform 150ms cubic-bezier(0.4, 0, 0.2, 1)",
        color: color.text.primary,
        cursor: "pointer",
        padding: spacing.sm,
        textAlign: "left",
      }}
    >
      {!work.artwork.thumbUrl && (
        <span style={{ fontSize: typeScale.body.fontSize }}>{work.title}</span>
      )}
    </button>
  );
}
