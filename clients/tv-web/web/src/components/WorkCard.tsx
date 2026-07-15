import { Link } from "react-router-dom";
import type { Availability, Work } from "@streamarr-tv/api-client";
import { pickImage } from "../lib/images";

/** Poster tile for a `Work`, shared by Home's "recently added" shelf and the full Library grid. */
export function WorkCard({ work }: { work: Work }) {
  const posterUrl = pickImage(work.images, "poster");

  return (
    <li className="poster-card">
      <Link to={`/library/${work.id}`}>
        <div className="poster-art">
          {posterUrl ? (
            <img src={posterUrl} alt="" loading="lazy" />
          ) : (
            <div className="poster-placeholder">{work.title}</div>
          )}
        </div>
        <span className="poster-title">{work.title}</span>
        <span className="poster-meta">
          {work.kind}
          {work.availability !== "available" ? ` · ${availabilityBadgeLabel(work.availability)}` : ""}
        </span>
      </Link>
    </li>
  );
}

function availabilityBadgeLabel(availability: Availability): string {
  return availability.replace(/_/g, " ");
}
