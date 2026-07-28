/**
 * Fetches work artwork with the receiver's own bearer token
 * (`ApiClient.getWorkArtwork`) and converts it to a `blob:` object URL, so
 * `metadata.images = [new cast.framework.messages.Image(blobUrl)]` never
 * needs to carry an `Authorization` header on an image URL. On any
 * failure -- missing artwork for this work, network error -- artwork is
 * omitted silently; it is never worth failing a load over.
 */
import type { ImageKind } from "@playarr-tv/api-client";

/** The one `ApiClient` method this module needs. */
export type ArtworkFetcher = (workId: string, kind: ImageKind) => Promise<Blob>;

/** Poster reads best in CAF's default media-overlay chrome; backdrop is the fallback for kinds with no poster registered. */
export const ARTWORK_KIND_PREFERENCE: readonly ImageKind[] = ["poster", "backdrop"];

/**
 * Tries each preferred image kind in turn, returning the first blob: URL
 * that resolves. Never throws -- returns `undefined` once every kind has
 * failed, so the caller can simply omit artwork rather than fail the whole
 * load.
 */
export async function loadWorkArtworkBlobUrl(
  fetchArtwork: ArtworkFetcher,
  workId: string,
  kinds: readonly ImageKind[] = ARTWORK_KIND_PREFERENCE
): Promise<string | undefined> {
  for (const kind of kinds) {
    try {
      const blob = await fetchArtwork(workId, kind);
      return URL.createObjectURL(blob);
    } catch {
      // Try the next preferred kind before giving up entirely.
    }
  }
  return undefined;
}
