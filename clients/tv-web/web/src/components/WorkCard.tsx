import { useState } from "react";
import { Link } from "react-router-dom";
import type { Work } from "@playarr-tv/api-client";
import { CachedArtworkImage } from "../lib/artwork";
import { labelWithYear } from "../lib/workYear";
import { useMediaContextMenu } from "./MediaContextMenu";
import { useDwellPrefetch } from "../lib/prefetch";

/** Poster tile for a `Work`, shared by Home's "recently added" shelf and the full Library grid. */
export function WorkCard({ work }: { work: Work }) {
  const routeBase =
    work.kind === "series"
      ? "/series"
      : work.kind === "site"
        ? "/sites"
        : "/movies";
  const mediaContext = useMediaContextMenu();
  const [dwelling, setDwelling] = useState(false);
  useDwellPrefetch(work, dwelling);
  const itemProps = mediaContext.itemProps({
    work,
    detailRoute: `${routeBase}/${work.id}`,
    parentRoute: routeBase,
  });
  return (
    <li className="poster-card">
      <Link
        to={`${routeBase}/${work.id}`}
        {...itemProps}
        onFocus={() => setDwelling(true)}
        onBlur={() => {
          setDwelling(false);
          itemProps.onBlur();
        }}
        onMouseEnter={() => setDwelling(true)}
        onMouseLeave={() => setDwelling(false)}
      >
        <div className="poster-art">
          <CachedArtworkImage
            work={work}
            kinds={["poster"]}
            alt=""
            loading="lazy"
            fallback={<div className="poster-placeholder">{work.title}</div>}
          />
        </div>
        <span className="poster-title">{work.title}</span>
        <span className="poster-meta">{labelWithYear(work.kind, work)}</span>
      </Link>
      {mediaContext.contextMenu}
    </li>
  );
}
