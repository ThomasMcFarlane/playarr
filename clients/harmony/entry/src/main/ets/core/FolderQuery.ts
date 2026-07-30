/**
 * Pure request-path construction for folder browsing.
 *
 * Keeping query assembly here makes percent-encoding and pagination
 * independently testable without importing the ArkTS network layer.
 */

import { folderBrowseUrl, folderRootsUrl } from './Endpoints';
import type { WorkKind } from './Types/Catalog';

export function folderRootsPath(kind: WorkKind): string {
  return folderRootsUrl() + '?kind=' + encodeURIComponent(kind);
}

export function folderBrowsePath(rootFolderId: string, path: string, limit: number, offset: number): string {
  const parts: string[] = [];
  if (path.length > 0) {
    parts.push('path=' + encodeURIComponent(path));
  }
  parts.push('limit=' + encodeURIComponent(String(limit)));
  parts.push('offset=' + encodeURIComponent(String(offset)));
  return folderBrowseUrl(rootFolderId) + '?' + parts.join('&');
}
