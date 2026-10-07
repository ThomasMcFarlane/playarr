import type {Work} from '@playarr-tv/api-client';
import {preferredArtworkKind, workArtworkUrl} from '../api/artworkUrl';

/** The stage's key art for a work: its backdrop, else its poster (the web's `kinds={["backdrop", "poster"]}`). */
export function stageArtUrl(baseUrl: string, work: Pick<Work, 'id' | 'images'> | undefined): string | undefined {
  if (!work) return undefined;
  const kind = preferredArtworkKind(work, ['backdrop', 'poster']);
  return kind ? workArtworkUrl(baseUrl, work.id, kind) : undefined;
}

/** A 16:9 card's art: backdrop first (`view` thumbnails), poster as the fallback. */
export function cardArtUrl(baseUrl: string, work: Pick<Work, 'id' | 'images'>): string | undefined {
  const kind = preferredArtworkKind(work, ['backdrop', 'poster']);
  return kind ? workArtworkUrl(baseUrl, work.id, kind) : undefined;
}
