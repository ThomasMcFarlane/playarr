import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  folderEntryKey,
  folderEntryMetadata,
  folderEntryTechnicalMetadata,
  folderEntryTitle,
  formatFolderBitrate,
  formatFolderDuration,
  formatFolderSize,
} from '../main/ets/core/FolderPresentation';
import { FolderEntry } from '../main/ets/core/Types/Folders';

function mediaEntry(): FolderEntry {
  return {
    entry_type: 'media',
    name: 'raw-file.mkv',
    path: 'Concerts/raw-file.mkv',
    media_file_id: '66666666-6666-6666-6666-666666666666',
    media_kind: 'movie',
    title: 'Live at Home',
    artist: 'The Example Band',
    album: 'Kitchen Sessions',
    container: 'mkv',
    video_codec: 'hevc',
    audio_codec: 'aac',
    duration_ms: 3723000,
    bitrate_bps: 8000000,
    size_bytes: 1610612736,
    width: 3840,
    height: 2160,
    modified_at: '2026-07-31T10:30:00Z',
    thumbnail_url: '/thumbnail',
  };
}

describe('folder entry presentation', () => {
  it('prefers the file-derived embedded title and falls back to the filename', () => {
    const entry = mediaEntry();
    assert.equal(folderEntryTitle(entry), 'Live at Home');
    entry.title = ' ';
    assert.equal(folderEntryTitle(entry), 'raw-file.mkv');
  });

  it('presents directories without invented media metadata', () => {
    const entry: FolderEntry = {
      entry_type: 'directory',
      name: 'Season 1',
      path: 'Season 1',
    };
    assert.equal(folderEntryTitle(entry), 'Season 1');
    assert.equal(folderEntryTechnicalMetadata(entry), 'Folder');
    assert.equal(folderEntryMetadata(entry), 'Folder');
  });

  it('formats file-derived people and technical metadata', () => {
    assert.equal(
      folderEntryMetadata(mediaEntry()),
      'The Example Band · Kitchen Sessions\nMKV · 3840×2160 · HEVC · AAC · 1:02:03 · 8.0 Mbps · 1.5 GB · 2026-07-31'
    );
  });

  it('creates stable keys from entry type and root-relative path', () => {
    assert.equal(folderEntryKey(mediaEntry()), 'media:Concerts/raw-file.mkv');
  });
});

describe('folder media units', () => {
  it('formats short and long durations', () => {
    assert.equal(formatFolderDuration(62000), '1:02');
    assert.equal(formatFolderDuration(3723000), '1:02:03');
    assert.equal(formatFolderDuration(null), '');
  });

  it('formats bytes using binary units', () => {
    assert.equal(formatFolderSize(512), '512 B');
    assert.equal(formatFolderSize(1024), '1.0 KB');
    assert.equal(formatFolderSize(1610612736), '1.5 GB');
    assert.equal(formatFolderSize(undefined), '');
  });

  it('formats positive bitrates in megabits per second', () => {
    assert.equal(formatFolderBitrate(8000000), '8.0 Mbps');
    assert.equal(formatFolderBitrate(0), '');
    assert.equal(formatFolderBitrate(null), '');
  });
});
