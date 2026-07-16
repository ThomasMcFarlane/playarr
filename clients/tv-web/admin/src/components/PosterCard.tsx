import { forwardRef } from "react";
import { Link } from "react-router-dom";
import type { Availability, Work, WorkKind } from "@streamarr-tv/api-client";
import { pickImage } from "../lib/images";

/** Streamarr's actual `WorkKind` values -- "Books" reads better than the literal "Author" for an operator. */
export const KIND_LABELS: Record<WorkKind, string> = {
  movie: "Movies",
  series: "Series",
  site: "Sites",
  artist: "Music",
  author: "Books",
};

/** Singular form of `KIND_LABELS`, for a single work's second caption line (e.g. "Available · Movie"). */
const KIND_SINGULAR_LABELS: Record<WorkKind, string> = {
  movie: "Movie",
  series: "Series",
  site: "Site",
  artist: "Artist",
  author: "Author",
};

function availabilityLabel(availability: Availability): string {
  switch (availability) {
    case "available":
      return "Available";
    case "partially_available":
      return "Partially available";
    case "pending":
      return "Pending";
    case "processing":
      return "Processing";
    case "deleted":
      return "Deleted";
    default:
      return "Unknown";
  }
}

/**
 * Status-strip color class for a work's `Availability` -- existing tokens
 * only, see the mapping table in the redesign spec. `--color-queue` is
 * documented elsewhere as "active-download/queue/progress bars only", which
 * is exactly what "pending"/"processing" are here.
 */
function statusStripClass(availability: Availability): string {
  switch (availability) {
    case "available":
      return "is-available";
    case "partially_available":
      return "is-partial";
    case "pending":
    case "processing":
      return "is-pending";
    case "deleted":
      return "is-deleted";
    default:
      return "is-unknown";
  }
}

/**
 * Poster tile for the Library grid -- title (line 1) + a colored status
 * strip + "{availability} · {kind}" (line 2). Links to `/library/{id}`, the
 * admin read-only work-detail page (`pages/WorkDetail.tsx`) -- unlike
 * Playarr Web's `web/src/components/WorkCard.tsx`, which links into a
 * playback-capable detail page, admin's detail page never exposes a
 * playback URL (same `CatalogViewer`, not `StreamingUser`, gating this
 * whole app already follows).
 *
 * `forwardRef`'d onto the rendered `<li>` so `Library.tsx` can keep a
 * `work.id -> HTMLLIElement` map for the alphabet rail's scroll-into-view
 * targets, without wrapping this `<li>` in another element (which would
 * break `.poster-grid`'s CSS Grid item layout -- every direct child of the
 * `<ul>` must be a `<li>`, not a `<li>`-wrapping `<div>`). The `<Link>`
 * lives *inside* the `<li>`, filling it via CSS, so the ref target and grid
 * item shape are unaffected.
 */
export const PosterCard = forwardRef<HTMLLIElement, { work: Work }>(function PosterCard(
  { work },
  ref
) {
  const posterUrl = pickImage(work.images, "poster");
  return (
    <li className="poster-card" ref={ref}>
      <Link to={`/library/${work.id}`} className="poster-card-link">
        <div className="poster-art">
          {posterUrl ? (
            <img src={posterUrl} alt="" loading="lazy" />
          ) : (
            <div className="poster-placeholder">{work.title}</div>
          )}
        </div>
        <div className={`poster-status-strip ${statusStripClass(work.availability)}`} />
        <span className="poster-title">{work.title}</span>
        <span className="poster-meta">
          {availabilityLabel(work.availability)} · {KIND_SINGULAR_LABELS[work.kind]}
        </span>
      </Link>
    </li>
  );
});
