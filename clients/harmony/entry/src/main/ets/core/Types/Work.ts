/**
 * Wire DTOs for a catalogue `Work` -- the shared shape returned by
 * `/api/v1/catalog`, `/api/v1/catalog/search`, `/api/v1/catalog/{id}/similar`
 * and embedded inside `WorkDetail`.
 *
 * This file lives under `core/` and is deliberately plain TypeScript: no
 * ArkUI, no `@kit.*` / `@ohos.*` imports, no decorators. It is Linux
 * testable with `node --test` and has zero dependency on the HarmonyOS SDK.
 *
 * Field names match the JSON wire contract verbatim (snake_case) -- this
 * layer only decodes server responses, it does not remap field casing.
 * See the implementation brief section 4.8 ("Catalog").
 *
 * `WorkKind` is owned by `./Catalog` (brief section 2.5 assigns it there),
 * imported back here rather than re-declared, so a `Work.kind` value and a
 * `BrowseQuery.kind` filter can never silently drift onto two different
 * literal unions. Both this module and `./Catalog` are pure type/interface
 * declarations with no runtime values, so the resulting import cycle is
 * erased entirely by `tsc` -- there is no runtime circular `require`.
 */

import { WorkKind } from "./Catalog";

/**
 * `ExternalProvider::Other` serialises as an OBJECT, not a bare string:
 * `{"other": "anidb"}` (brief 4.8). Every other provider variant serialises
 * as a plain lowercase string. The brief does not enumerate the closed set
 * of known scalar provider identifiers, so the scalar case is modelled as
 * an open `string` rather than a guessed literal union.
 */
export interface ExternalProviderOther {
  other: string;
}

export type ExternalProvider = string | ExternalProviderOther;

/** One external identifier attached to a `Work` (brief 4.8: `external_refs`). */
export interface ExternalRef {
  provider: ExternalProvider;
  external_id: string;
}

export type ImageKind = "poster" | "backdrop" | "banner" | "logo" | "thumb";

/**
 * One artwork reference on a `Work`. Never fetch `.url` directly (brief
 * 4.9) -- resolve artwork bytes through `data/ArtworkRepository.ets`
 * instead.
 *
 * `width`/`height` are shown without a nullability mark in the brief's own
 * `{kind, url, width, height}` shorthand (4.8), but the backend model
 * (`playarr-model::work::ImageAsset`) declares both as `Option<u32>` --
 * modelled as nullable here so a still-processing or dimension-less
 * provider image can never be mistaken for a guaranteed number. ArkTS bans
 * optional chaining, so a false non-null guarantee here would be a real
 * crash risk the moment `design/components/PosterCard.ets` reads either
 * field.
 */
export interface Image {
  kind: ImageKind;
  url: string;
  width: number | null;
  height: number | null;
}

export type Availability =
  | "unknown"
  | "pending"
  | "processing"
  | "partially_available"
  | "available"
  | "deleted";

/** `GET /api/v1/catalog{,/search,/{id}/similar}` item shape (brief 4.8). */
export interface Work {
  id: string;
  kind: WorkKind;
  external_refs: ExternalRef[];
  title: string;
  sort_title: string;
  overview: string | null;
  images: Image[];
  genres: string[];
  tags: string[];
  added_at: string;
  release_date: string | null;
  monitored: boolean;
  availability: Availability;
}

/**
 * One peer's reported availability for a `Work` -- the §4.3 cross-peer
 * hydration step's per-badge shape. Not spelled out field-by-field
 * anywhere in the implementation brief's own prose, so this is sourced
 * directly from the backend contract rather than the brief text:
 * `playarr-catalog::AvailabilityBadge` (mirrored verbatim on the wire by
 * `playarr-api::catalog::AvailabilityBadge`). All fields are always
 * present -- there is no `Option<T>` anywhere in the Rust struct.
 */
export interface AvailabilityBadge {
  peer_node_id: string;
  peer_name: string;
  availability: Availability;
  updated_at: string;
}

/**
 * A title a full peer reports having but this node has zero local record
 * of at all -- the partial-cache-node case (brief 4.3/4.8). Sourced from
 * `playarr-catalog::RemoteOnlyWork` (mirrored on the wire by
 * `playarr-api::catalog::RemoteOnlyWork`) since the brief's own prose
 * only names this type, without spelling out its fields. Deliberately not
 * a fabricated local `Work` -- there is no `id`/`media_file_id` here, so a
 * client that wants to play one of these needs a dedicated by-external-ref
 * entry point instead (out of scope for this brief).
 */
export interface RemoteOnlyWork {
  provider: ExternalProvider;
  external_id: string;
  title: string;
  kind: WorkKind;
  release_date?: string | null;
  available_on: AvailabilityBadge[];
}
