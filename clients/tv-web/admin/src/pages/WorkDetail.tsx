import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  describeApiError,
  type Availability,
  type EpisodeDetail,
  type SeasonDetail,
  type AlbumDetail,
  type WorkDetail as WorkDetailDto,
} from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { KIND_LABELS } from "../components/PosterCard";
import {
  CachedAlbumArtworkImage,
  CachedWorkArtworkImage,
  useCachedWorkArtwork,
} from "../components/CachedArtwork";

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

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function formatYear(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return String(new Date(iso).getFullYear());
}

function formatRuntime(ms: number | null | undefined): string | null {
  if (!ms) return null;
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours > 0 ? `${hours}h ${remaining}m` : `${remaining}m`;
}

function WorkDetailBackdrop({ work }: { work: WorkDetailDto["work"] }) {
  const backdrop = useCachedWorkArtwork(work, ["backdrop", "poster"]);
  if (backdrop.url) {
    return (
      <div
        className="work-detail-hero-backdrop"
        style={{ backgroundImage: `url(${backdrop.url})` }}
      />
    );
  }
  return backdrop.loading ? (
    <div className="work-detail-hero-backdrop artwork-loading" />
  ) : null;
}

/**
 * Read-only detail page for a single catalog work -- deliberately built
 * against real, live-verified Sonarr/Radarr detail pages (full-width
 * backdrop hero with poster + title + two metadata rows + overview, then a
 * collapsible per-season/per-album accordion below), not a generic form
 * layout, per this app's established "match the real *arr design system
 * exactly" rule (see `LibraryToolbarMenus.tsx`/`DESIGN.md`). Backed by
 * `client.getWork(id)`, the same `GET /api/v1/catalog/{id}` endpoint
 * Playarr Web's own (playback-capable) `WorkDetail.tsx` uses -- this page
 * never surfaces a playback URL or exposes *arr-only fields Streamarr's own
 * catalog model doesn't carry (quality profile, root path, cast/crew) --
 * those stay in Sonarr/Radarr's own UI, not duplicated here.
 */
export function WorkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const client = useApiClient();
  const [detail, setDetail] = useState<WorkDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useDocumentTitle(detail?.work.title ?? "Library item");

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    client
      .getWork(id)
      .then(setDetail)
      .catch((err: unknown) => setError(describeApiError(err)))
      .finally(() => setLoading(false));
  }, [client, id]);

  if (loading) {
    return (
      <div className="page">
        <p className="muted">Loading...</p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="page">
        <p className="error-text">{error ?? "Not found."}</p>
        <Link to="/library" className="btn btn-secondary">
          Back to Library
        </Link>
      </div>
    );
  }

  const { work } = detail;
  const releaseDate = formatDate(work.release_date);
  const year = formatYear(work.release_date) ?? String(new Date(work.added_at).getFullYear());
  const runtime = formatRuntime(detail.runtime_ms);

  return (
    <div className="page work-detail-page">
      <div className="work-detail-hero">
        <WorkDetailBackdrop work={work} />
        <div className="work-detail-hero-overlay" />
        <div className="work-detail-hero-content">
          <div className="work-detail-poster">
            <CachedWorkArtworkImage
              work={work}
              kinds={["poster", "backdrop"]}
              alt=""
              loadingFallback={<div className="artwork-loading" aria-hidden="true" />}
              fallback={<div className="poster-placeholder">{work.title}</div>}
            />
          </div>
          <div className="work-detail-info">
            <h1 className="work-detail-title">{work.title}</h1>
            <div className="work-detail-meta-row">
              <span className={`badge badge-pill ${work.availability === "available" ? "badge-success" : "badge-neutral"}`}>
                {availabilityLabel(work.availability)}
              </span>
              <span>{KIND_LABELS[work.kind]}</span>
              <span>{year}</span>
              {runtime && <span>{runtime}</span>}
              {!work.monitored && (
                <span className="badge badge-pill badge-neutral">Unmonitored</span>
              )}
            </div>
            <div className="work-detail-facts-row">
              {releaseDate && (
                <span>
                  <strong>Released</strong> {releaseDate}
                </span>
              )}
              {work.genres.length > 0 && (
                <span>
                  <strong>Genres</strong> {work.genres.join(", ")}
                </span>
              )}
              {work.tags.length > 0 && (
                <span>
                  <strong>Tags</strong> {work.tags.join(", ")}
                </span>
              )}
              {detail.children === "Movie" && (
                <span>
                  <strong>File</strong> {detail.media_file_id ? "Synced" : "Not synced"}
                </span>
              )}
            </div>
            {work.overview && <p className="work-detail-overview">{work.overview}</p>}
          </div>
        </div>
      </div>

      <WorkChildrenSection detail={detail} />
    </div>
  );
}

/** `true` if every leaf under a season/album is `Availability.available`. */
function allAvailable(availabilities: Availability[]): boolean {
  return availabilities.length > 0 && availabilities.every((a) => a === "available");
}

function AccordionRow({
  title,
  artwork,
  availableCount,
  totalCount,
  isFullyAvailable,
  children,
}: {
  title: string;
  artwork?: React.ReactNode;
  availableCount: number;
  totalCount: number;
  isFullyAvailable: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="work-detail-accordion-item">
      <button
        type="button"
        className="work-detail-accordion-header"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        {artwork}
        <span className="work-detail-accordion-title">{title}</span>
        <span className={`badge badge-pill ${isFullyAvailable ? "badge-success" : "badge-neutral"}`}>
          {availableCount} / {totalCount}
        </span>
        <span className="work-detail-accordion-chevron">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && <div className="work-detail-accordion-body">{children}</div>}
    </div>
  );
}

function EpisodeTable({ episodes }: { episodes: EpisodeDetail[] }) {
  return (
    <table className="table" style={{ width: "100%" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left" }}>#</th>
          <th style={{ textAlign: "left" }}>Title</th>
          <th style={{ textAlign: "left" }}>Air date</th>
          <th style={{ textAlign: "left" }}>Status</th>
        </tr>
      </thead>
      <tbody>
        {episodes.map(({ episode }) => (
          <tr key={episode.id}>
            <td>{episode.episode_number}</td>
            <td>{episode.title}</td>
            <td className="muted">{formatDate(episode.air_date) ?? "—"}</td>
            <td className="muted">{availabilityLabel(episode.availability)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WorkChildrenSection({ detail }: { detail: WorkDetailDto }) {
  const children = detail.children;

  if (children === "Movie") {
    return null;
  }

  if ("Series" in children) {
    const seasons: SeasonDetail[] = [...children.Series].sort(
      (a, b) => b.season.season_number - a.season.season_number
    );
    return (
      <div className="card work-detail-accordion">
        {seasons.map((season) => {
          const availabilities = season.episodes.map((e) => e.episode.availability);
          return (
            <AccordionRow
              key={season.season.id}
              title={season.season.title ?? `Season ${season.season.season_number}`}
              availableCount={availabilities.filter((a) => a === "available").length}
              totalCount={availabilities.length}
              isFullyAvailable={allAvailable(availabilities)}
            >
              <EpisodeTable episodes={season.episodes} />
            </AccordionRow>
          );
        })}
      </div>
    );
  }

  if ("Artist" in children) {
    const albums: AlbumDetail[] = children.Artist;
    return (
      <div className="card work-detail-accordion">
        {albums.map((album) => {
          const availabilities = album.tracks.map((t) => t.track.availability);
          return (
            <AccordionRow
              key={album.album.id}
              title={album.album.title}
              artwork={
                <span className="work-detail-album-artwork">
                  <CachedAlbumArtworkImage
                    artistWorkId={detail.work.id}
                    album={album.album}
                    kinds={["poster", "backdrop"]}
                    alt=""
                    loading="lazy"
                    loadingFallback={<span className="artwork-loading" aria-hidden="true" />}
                    fallback={<span className="album-artwork-placeholder" aria-hidden="true" />}
                  />
                </span>
              }
              availableCount={availabilities.filter((a) => a === "available").length}
              totalCount={availabilities.length}
              isFullyAvailable={allAvailable(availabilities)}
            >
              <table className="table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>#</th>
                    <th style={{ textAlign: "left" }}>Title</th>
                    <th style={{ textAlign: "left" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {album.tracks.map(({ track }) => (
                    <tr key={track.id}>
                      <td>{track.track_number}</td>
                      <td>{track.title}</td>
                      <td className="muted">{availabilityLabel(track.availability)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AccordionRow>
          );
        })}
      </div>
    );
  }

  return (
    <div className="card work-detail-season">
      <h2 className="work-detail-section-title">Books</h2>
      <table className="table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Title</th>
            <th style={{ textAlign: "left" }}>Released</th>
            <th style={{ textAlign: "left" }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {children.Author.map(({ book }) => (
            <tr key={book.id}>
              <td>{book.title}</td>
              <td className="muted">{formatDate(book.release_date) ?? "—"}</td>
              <td className="muted">{availabilityLabel(book.availability)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
