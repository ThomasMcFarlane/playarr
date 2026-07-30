/**
 * Authenticated folder-root discovery and root-relative directory browsing.
 *
 * All physical paths remain server-side. Query construction lives in the
 * pure `core/FolderQuery.ts` helper so encoding and pagination are covered
 * by the Linux test tier.
 */

import { getPlayarrClient } from '../AppContainer';
import type { ApiResult } from '../net/ApiResult';
import { folderBrowsePath, folderRootsPath } from '../core/FolderQuery';
import type { WorkKind } from '../core/Types/Catalog';
import type { FolderBrowseResponse, FolderRootsResponse } from '../core/Types/Folders';

/** Server default, explicitly sent so pagination is stable across versions. */
export const folderPageSize: number = 200;

export function getFolderRoots(kind: WorkKind): Promise<ApiResult<FolderRootsResponse>> {
  return getPlayarrClient().getJson<FolderRootsResponse>(folderRootsPath(kind));
}

export function browseFolder(
  rootFolderId: string,
  path: string,
  limit: number,
  offset: number
): Promise<ApiResult<FolderBrowseResponse>> {
  return getPlayarrClient().getJson<FolderBrowseResponse>(
    folderBrowsePath(rootFolderId, path, limit, offset)
  );
}
