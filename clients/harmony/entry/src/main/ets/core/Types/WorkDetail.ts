/**
 * Wire DTOs for `GET /api/v1/catalog/{id}` -- a `Work` plus its full
 * kind-specific tree (seasons/episodes, albums/tracks, or books).
 *
 * This file lives under `core/` and is deliberately plain TypeScript: no
 * ArkUI, no `@kit.*` / `@ohos.*` imports, no decorators. It is Linux
 * testable with `node --test` and has zero dependency on the HarmonyOS SDK.
 *
 * Field names match the JSON wire contract verbatim (snake_case) -- this
 * layer only decodes server responses, it does not remap field casing.
 * See the implementation brief section 4.8 ("Catalog").
 *
 * `Season`/`Episode`/`Album`/`Track`/`Book` are not named as their own
 * top-level exports in the brief's section 2.5 file list (only their
 * `*Detail` wrappers are), but each wrapper's own field needs a real type,
 * and the brief does not give one inline -- so, per the "don't guess, cite
 * your source" rule already established in `./Work`, these five are
 * sourced directly from the backend contract (`playarr-model::series`,
 * `playarr-model::music`, `playarr-model::publishing`) rather than left
 * as `any` (banned) or invented from nothing.
 */

import { Availability, AvailabilityBadge, Image, Work } from "./Work";

/**
 * `playarr-model::series::Season`. `title`/`overview` are `Option<String>`
 * on the backend with no brief-text nullability mark of their own -- see
 * `./Work`'s `Image.width`/`height` doc comment for why an `Option<T>` the
 * brief is silent on is still modelled as nullable here rather than
 * guessed as always-present.
 */
export interface Season {
  id: string;
  series_work_id: string;
  season_number: number;
  title?: string | null;
  overview?: string | null;
  monitored: boolean;
  availability: Availability;
}

/** `playarr-model::series::Episode`. `air_date` is an ISO date string
 * (`Option<NaiveDate>` on the backend), not a full RFC3339 timestamp. */
export interface Episode {
  id: string;
  season_id: string;
  episode_number: number;
  title?: string | null;
  overview?: string | null;
  images: Image[];
  air_date?: string | null;
  runtime_minutes?: number | null;
  monitored: boolean;
  availability: Availability;
}

/**
 * A season plus its episodes, as returned inside `WorkDetail.children` for
 * a `WorkKind::Series`/`WorkKind::Site` work (brief 4.8:
 * `SeasonDetail = {season, episodes: EpisodeDetail[]}`).
 */
export interface SeasonDetail {
  season: Season;
  episodes: EpisodeDetail[];
}

/**
 * An `Episode` plus the resolved id of the `MediaFile` that plays it, or
 * `null`/absent when no file has synced for this episode yet (brief 4.8:
 * `EpisodeDetail = {episode, media_file_id, runtime_ms}`). `MediaFile`
 * itself is never returned over HTTP -- this resolved id is the only way a
 * client ever learns it.
 */
export interface EpisodeDetail {
  episode: Episode;
  media_file_id?: string | null;
  runtime_ms?: number | null;
}

/** `playarr-model::music::AlbumType`, snake_case on the wire. */
export type AlbumType = "studio" | "live" | "compilation" | "ep" | "single" | "soundtrack";

/** `playarr-model::music::Album`. `release_date` is an ISO date string. */
export interface Album {
  id: string;
  artist_work_id: string;
  title: string;
  images: Image[];
  album_type: AlbumType;
  release_date?: string | null;
  monitored: boolean;
  availability: Availability;
}

/** `playarr-model::music::Track`. */
export interface Track {
  id: string;
  album_id: string;
  disc_number: number;
  track_number: number;
  title: string;
  duration_seconds?: number | null;
  availability: Availability;
}

/**
 * An album plus its tracks, as returned inside `WorkDetail.children` for a
 * `WorkKind::Artist` work (brief 4.8:
 * `AlbumDetail = {album, tracks: TrackDetail[]}`).
 */
export interface AlbumDetail {
  album: Album;
  tracks: TrackDetail[];
}

/** A `Track` plus its resolved `media_file_id` (brief 4.8:
 * `TrackDetail = {track, media_file_id, runtime_ms}`); see `EpisodeDetail`. */
export interface TrackDetail {
  track: Track;
  media_file_id?: string | null;
  runtime_ms?: number | null;
}

/** `playarr-model::publishing::Book`. `release_date` is an ISO date
 * string; `series_position` is a fractional position within a book series
 * (e.g. `2.5` for a novella between books 2 and 3). */
export interface Book {
  id: string;
  author_work_id: string;
  title: string;
  isbn?: string | null;
  release_date?: string | null;
  series_name?: string | null;
  series_position?: number | null;
  monitored: boolean;
  availability: Availability;
}

/** A `Book` plus its resolved `media_file_id` (brief 4.8:
 * `BookDetail = {book, media_file_id}`); see `EpisodeDetail`. */
export interface BookDetail {
  book: Book;
  media_file_id?: string | null;
}

/**
 * `{"Series": SeasonDetail[]}` -- one of `WorkDetail.children`'s three
 * object-shaped variants (brief 4.8). `WorkKind::Site` reuses this exact
 * shape (Whisparr exposes sites/scenes through Sonarr-compatible
 * series/episode resources).
 */
export interface WorkChildrenSeries {
  Series: SeasonDetail[];
}

/** `{"Artist": AlbumDetail[]}` (brief 4.8). */
export interface WorkChildrenArtist {
  Artist: AlbumDetail[];
}

/** `{"Author": BookDetail[]}` (brief 4.8). */
export interface WorkChildrenAuthor {
  Author: BookDetail[];
}

/**
 * `WorkDetail.children` -- an EXTERNALLY-TAGGED enum whose JSON is either
 * the bare string `"Movie"` (a `WorkKind::Movie` work has no children of
 * its own) or one of three single-key objects (brief 4.8). Variant names
 * are CAPITALISED here, unlike every other enum on this wire -- copy this
 * casing verbatim, it is not a typo.
 */
export type WorkChildren = "Movie" | WorkChildrenSeries | WorkChildrenArtist | WorkChildrenAuthor;

/**
 * `GET /api/v1/catalog/{id}` response. Brief 4.8 pins this shape and its
 * nullability precisely -- "`media_file_id` (uuid|null, only for a Movie's
 * own leaf), `runtime_ms` (u64|null)" -- so, unlike the nested
 * `*Detail` types above (where the brief's shorthand is silent on
 * nullability), both fields are modelled as always-present-but-nullable
 * here, matching the brief's own "|null" notation exactly rather than the
 * "optional key" treatment used elsewhere in this file.
 *
 * `media_file_id`/`runtime_ms` are only ever populated for a
 * `WorkKind::Movie` work -- every other kind's playable leaves are its
 * children instead, resolved on each `EpisodeDetail`/`TrackDetail`/
 * `BookDetail`. `available_on` is the cross-peer availability hydration for
 * `work` itself (§4.3) -- always present, possibly empty, never `null`.
 */
export interface WorkDetail {
  work: Work;
  children: WorkChildren;
  media_file_id: string | null;
  runtime_ms: number | null;
  available_on: AvailabilityBadge[];
}
