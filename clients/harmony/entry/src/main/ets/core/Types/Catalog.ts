/**
 * Wire DTOs for browsing and searching the catalogue: `GET /api/v1/catalog`,
 * `GET /api/v1/catalog/kinds`, `GET /api/v1/catalog/search` and
 * `GET /api/v1/views` / `GET /api/v1/views/{id}/resolve`.
 *
 * This file lives under `core/` and is deliberately plain TypeScript: no
 * ArkUI, no `@kit.*` / `@ohos.*` imports, no decorators. It is Linux
 * testable with `node --test` and has zero dependency on the HarmonyOS SDK.
 *
 * Field names match the JSON wire contract verbatim (snake_case) -- this
 * layer only decodes server responses, it does not remap field casing.
 * See the implementation brief section 4.8 ("Catalog").
 *
 * `WorkKind` is owned here (brief section 2.5) and imported back into
 * `./Work` for `Work.kind` / `RemoteOnlyWork.kind`, rather than being
 * re-declared there, so the two can never silently drift onto different
 * literal unions. Both this module and `./Work` are pure type/interface
 * declarations with no runtime values, so the resulting import cycle is
 * erased entirely by `tsc` -- there is no runtime circular `require`.
 */

import { AvailabilityBadge, RemoteOnlyWork, Work } from "./Work";

/**
 * The five top-level taxonomy kinds Playarr Server understands (brief 4.8).
 * `GET /api/v1/catalog/kinds` returns only the subset actually backed by a
 * configured, allowed source instance -- nav destinations must be driven
 * from that response, never hard-coded to this full set.
 */
export type WorkKind = "movie" | "series" | "site" | "artist" | "author";

/**
 * Client-side query parameters for `GET /api/v1/catalog` (brief 4.8). Every
 * field is optional -- this is a request-construction helper, not a
 * decoded server response, so "optional" here means "the caller may omit
 * this key when building the query string", not "the server may omit it
 * from a JSON body".
 *
 * Playarr must always send `available_only: true` (brief 4.8, 9 Slice 6).
 * `limit` defaults to 50, `offset` to 0, `sort` to `"title"` server-side
 * when omitted.
 */
export interface BrowseQuery {
  kind?: WorkKind;
  available_only?: boolean;
  source_instance_id?: string;
  genre?: string;
  tag?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

/**
 * `GET /api/v1/catalog` / `GET /api/v1/views/{id}/resolve` response (brief
 * 4.8). `available_on` is keyed by `Work.id` -- modelled as a `Map`, never
 * an indexed object literal, since ArkTS bans index signatures and bracket
 * property access outright. A decoder building this value from the raw
 * `{[work_id]: AvailabilityBadge[]}` JSON object must do so via
 * `Object.keys(...)`/`Object.entries(...)` in the repository layer that
 * consumes this type, never a `for...in` loop (also banned).
 *
 * `total` is `null` when the caller asked for a cheap page that skips the
 * count query (brief 4.8: `total: i64|null`). `available_on`/`remote_only`
 * are always present -- possibly empty -- never `null`.
 */
export interface CatalogPage {
  items: Work[];
  total: number | null;
  available_on: Map<string, AvailabilityBadge[]>;
  remote_only: RemoteOnlyWork[];
}

/**
 * `GET /api/v1/catalog/search` response (brief 4.8). Deliberately NOT a
 * `CatalogPage` -- no `total`, no `available_on`.
 */
export interface SearchResult {
  items: Work[];
  remote_only: RemoteOnlyWork[];
}

/**
 * `GET /api/v1/views` list entry. Not spelled out field-by-field in the
 * brief's own prose (it only names the type: "brief 4.8: `GET
 * /api/v1/views` -> `ViewSummary[]`"), so this is sourced directly from the
 * backend contract: `playarr-api::views::ViewSummary`. `default_order`
 * is the one genuinely optional/nullable field -- `null`/absent when this
 * view has no explicit ordering override.
 */
export interface ViewSummary {
  id: string;
  name: string;
  is_default: boolean;
  default_order?: number | null;
}
