/**
 * File-derived folder entry presentation helpers.
 *
 * These helpers deliberately consume only `FolderEntry` fields. They never
 * consult catalogue/source-app metadata, preserving the "unsorted" view's
 * file-first contract while keeping the formatting Linux-testable.
 */

import type { FolderEntry } from './Types/Folders';

function nonBlank(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  return value.trim();
}

function appendUnique(parts: string[], value: string): void {
  if (value.length === 0) {
    return;
  }
  if (parts.indexOf(value) < 0) {
    parts.push(value);
  }
}

function padTwo(value: number): string {
  if (value < 10) {
    return '0' + String(value);
  }
  return String(value);
}

export function folderEntryKey(entry: FolderEntry): string {
  return entry.entry_type + ':' + entry.path;
}

export function folderEntryTitle(entry: FolderEntry): string {
  const fileTitle = nonBlank(entry.title);
  if (fileTitle.length > 0) {
    return fileTitle;
  }
  return entry.name;
}

export function formatFolderDuration(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined || durationMs < 0) {
    return '';
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return String(hours) + ':' + padTwo(minutes) + ':' + padTwo(seconds);
  }
  return String(minutes) + ':' + padTwo(seconds);
}

export function formatFolderSize(sizeBytes: number | null | undefined): string {
  if (sizeBytes === null || sizeBytes === undefined || sizeBytes < 0) {
    return '';
  }
  if (sizeBytes < 1024) {
    return String(sizeBytes) + ' B';
  }

  const units: string[] = ['KB', 'MB', 'GB', 'TB'];
  let value = sizeBytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value = value / 1024;
    unitIndex = unitIndex + 1;
  }
  const decimals = value >= 10 ? 0 : 1;
  return value.toFixed(decimals) + ' ' + units[unitIndex];
}

export function formatFolderBitrate(bitrateBps: number | null | undefined): string {
  if (bitrateBps === null || bitrateBps === undefined || bitrateBps <= 0) {
    return '';
  }
  return (bitrateBps / 1000000).toFixed(1) + ' Mbps';
}

export function folderEntryPeople(entry: FolderEntry): string {
  if (entry.entry_type === 'directory') {
    return '';
  }
  const parts: string[] = [];
  appendUnique(parts, nonBlank(entry.artist));
  appendUnique(parts, nonBlank(entry.album));
  return parts.join(' · ');
}

export function folderEntryTechnicalMetadata(entry: FolderEntry): string {
  if (entry.entry_type === 'directory') {
    return 'Folder';
  }

  const parts: string[] = [];
  const container = nonBlank(entry.container);
  if (container.length > 0) {
    appendUnique(parts, container.toUpperCase());
  }

  const width = entry.width;
  const height = entry.height;
  if (width !== null && width !== undefined && height !== null && height !== undefined) {
    appendUnique(parts, String(width) + '×' + String(height));
  }

  const videoCodec = nonBlank(entry.video_codec);
  if (videoCodec.length > 0) {
    appendUnique(parts, videoCodec.toUpperCase());
  }
  const audioCodec = nonBlank(entry.audio_codec);
  if (audioCodec.length > 0) {
    appendUnique(parts, audioCodec.toUpperCase());
  }
  appendUnique(parts, formatFolderDuration(entry.duration_ms));
  appendUnique(parts, formatFolderBitrate(entry.bitrate_bps));
  appendUnique(parts, formatFolderSize(entry.size_bytes));

  const modifiedAt = nonBlank(entry.modified_at);
  if (modifiedAt.length > 0) {
    const separatorIndex = modifiedAt.indexOf('T');
    appendUnique(parts, separatorIndex > 0 ? modifiedAt.slice(0, separatorIndex) : modifiedAt);
  }
  return parts.join(' · ');
}

export function folderEntryMetadata(entry: FolderEntry): string {
  const parts: string[] = [];
  appendUnique(parts, folderEntryPeople(entry));
  appendUnique(parts, folderEntryTechnicalMetadata(entry));
  return parts.join('\n');
}
