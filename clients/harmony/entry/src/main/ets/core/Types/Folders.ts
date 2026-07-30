/**
 * Wire DTOs for source-independent, root-relative folder browsing.
 *
 * The server never exposes a physical filesystem path. `FolderRoot.id` is
 * opaque and every `path` below is relative to that root. Media metadata is
 * extracted from the file by Playarr Server rather than inherited from an
 * upstream source application.
 *
 * This is plain TypeScript so the contract remains covered by the Harmony
 * client's Linux core-test tier.
 */

import type { WorkKind } from './Catalog';

export interface FolderRoot {
  id: string;
  source_instance_id: string;
  source_name: string;
  library_kind: WorkKind;
  name: string;
  available: boolean;
  unavailable_reason?: string | null;
}

export interface FolderRootError {
  source_instance_id: string;
  source_name: string;
  message: string;
}

export interface FolderRootsResponse {
  roots: FolderRoot[];
  errors: FolderRootError[];
}

export interface FolderBreadcrumb {
  name: string;
  path: string;
}

export type FolderEntryType = 'directory' | 'media';

export interface FolderEntry {
  entry_type: FolderEntryType;
  name: string;
  path: string;
  media_file_id?: string | null;
  media_kind?: WorkKind | null;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  container?: string | null;
  video_codec?: string | null;
  audio_codec?: string | null;
  duration_ms?: number | null;
  bitrate_bps?: number | null;
  size_bytes?: number | null;
  width?: number | null;
  height?: number | null;
  modified_at?: string | null;
  thumbnail_url?: string | null;
}

export interface FolderBrowseResponse {
  root: FolderRoot;
  path: string;
  breadcrumbs: FolderBreadcrumb[];
  entries: FolderEntry[];
  total: number;
  offset: number;
  limit: number;
}
