/**
 * Builds authed artwork URLs directly, rather than fetching a `Blob` the
 * way `@playarr-tv/api-client`'s `getWorkArtwork`/`getAlbumArtwork` (and
 * the web app's own `lib/artwork.tsx`) do.
 *
 * That Blob-based approach cannot port to Vega as-is: it exists specifically
 * so a browser can wrap the response in `URL.createObjectURL(blob)` for a
 * plain `<img src>`, keeping the bearer token out of the URL entirely.
 * React Native's `Blob` is not spec-complete and there is no
 * `URL.createObjectURL` at all (design doc assumption A4). The RN
 * replacement strategy is the opposite of hiding the token: hand
 * `<Image source={{uri, headers}}>` the real URL these functions build,
 * plus an `Authorization` header (assumed to actually reach the native
 * image loader -- `platform/capabilities.ts`'s `artworkRequestHeaders`
 * flag is the one place that assumption is recorded and would need
 * flipping if it turns out wrong; `components/ArtworkImage.tsx`, a later
 * step, is what actually renders against these two exports and owns the
 * data-URI fallback for if it does).
 *
 * Every path template below is copied character-for-character from
 * `@playarr-tv/api-client/src/index.ts`'s own `getWorkArtwork`/
 * `getAlbumArtwork` -- both of those operations are also in that file's
 * `PROTECTED_OPERATIONS` list, confirming the `Authorization` header these
 * URLs need is not optional.
 */
import type {Album, ImageKind, Work} from '@playarr-tv/api-client';

/** `GET /api/v1/artwork/work/{work_id}/{kind}` -- a work's own poster/backdrop/etc. */
export function workArtworkUrl(baseUrl: string, workId: string, kind: ImageKind): string {
  return `${baseUrl}/api/v1/artwork/work/${encodeURIComponent(workId)}/${encodeURIComponent(kind)}`;
}

/** `GET /api/v1/artwork/album/{artist_work_id}/{album_id}/{kind}` -- an album's own artwork, scoped to the artist's visible library. */
export function albumArtworkUrl(
  baseUrl: string,
  artistWorkId: string,
  albumId: string,
  kind: ImageKind
): string {
  return `${baseUrl}/api/v1/artwork/album/${encodeURIComponent(artistWorkId)}/${encodeURIComponent(
    albumId
  )}/${encodeURIComponent(kind)}`;
}

/** The one header every artwork request needs -- `undefined` (no header at all) when no token is available yet, matching every other protected call's convention in this app. */
export function artworkAuthHeaders(accessToken: string | undefined): Record<string, string> | undefined {
  return accessToken ? {Authorization: `Bearer ${accessToken}`} : undefined;
}

/**
 * The first `kind` (in caller-supplied preference order) this work or
 * album actually has an image for, or `null` if none of the requested
 * kinds are available. Ported from the web app's `lib/artwork.tsx` --
 * pure, DOM-free logic over `Work`/`Album`'s own `images` field, unchanged
 * by the Blob-vs-URL difference above.
 */
export function preferredArtworkKind(
  work: Pick<Work, 'images'> | Pick<Album, 'images'>,
  kinds: readonly ImageKind[]
): ImageKind | null {
  return kinds.find((kind) => work.images.some((image) => image.kind === kind)) ?? null;
}
