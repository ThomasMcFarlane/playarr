/**
 * Library-management tools Streamarr can read from.
 *
 * Only the six general-media *arr applications are listed. Streamarr's source
 * enum contains further variants that are deliberately not surfaced on this
 * site. Every description here must stay on the correct side of one line:
 * Streamarr reads what these tools have already organised. It performs no
 * indexing and obtains no media itself.
 *
 * Accuracy note, verified against the backend: Streamarr has NO filesystem
 * scanner. The catalogue write path is fed entirely by streamarr-arr-sync, so
 * a server with no connection registered has an empty catalogue. Never
 * describe these integrations as optional extras that merely improve matching.
 */
export interface Integration {
  name: string
  role: string
  /** Exactly what Streamarr takes from it. */
  reads: string
  /** What the operator does not get if it is not connected. */
  without: string
}

export const INTEGRATIONS: readonly Integration[] = [
  {
    name: 'Sonarr',
    role: 'Series library',
    reads: 'Series, seasons and episodes, the file paths they resolve to, and their metadata identifiers.',
    without: 'No series appear in the catalogue.',
  },
  {
    name: 'Radarr',
    role: 'Film library',
    reads: 'Films, the file paths they resolve to, and their metadata identifiers.',
    without: 'No films appear in the catalogue.',
  },
  {
    name: 'Lidarr',
    role: 'Music library',
    reads: 'Artists, albums and tracks, with their MusicBrainz identifiers.',
    without: 'No music appears in the catalogue.',
  },
  {
    name: 'Readarr',
    role: 'Book library',
    reads: 'Authors and books, with their identifiers.',
    without: 'No books appear in the catalogue.',
  },
  {
    name: 'Bazarr',
    role: 'Subtitles',
    reads: 'Which subtitle files exist for an item, and in which languages.',
    without: 'Only subtitle tracks already inside the media file are offered.',
  },
  {
    name: 'Prowlarr',
    role: 'Fleet management',
    reads: 'The list of applications it manages, so Streamarr can be pointed at them consistently.',
    without: 'Each application is registered individually instead. Nothing is lost.',
  },
]

export const TDARR = {
  name: 'Tdarr',
  role: 'Background transcoding',
  reads:
    'Streamarr dispatches library-wide re-encode work to a Tdarr worker pool and tracks its progress, keeping that work entirely separate from latency-sensitive playback.',
} as const
