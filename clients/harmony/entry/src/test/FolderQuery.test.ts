import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { folderBrowsePath, folderRootsPath } from '../main/ets/core/FolderQuery';

describe('folder request paths', () => {
  it('includes the selected library kind for root discovery', () => {
    assert.equal(folderRootsPath('artist'), '/api/v1/folders/roots?kind=artist');
  });

  it('omits the empty root path while retaining explicit pagination', () => {
    assert.equal(
      folderBrowsePath('33333333-3333-3333-3333-333333333333', '', 200, 0),
      '/api/v1/folders/33333333-3333-3333-3333-333333333333?limit=200&offset=0'
    );
  });

  it('percent-encodes nested relative paths without exposing a physical path', () => {
    assert.equal(
      folderBrowsePath('33333333-3333-3333-3333-333333333333', 'Season 1/Disc & Extras', 50, 100),
      '/api/v1/folders/33333333-3333-3333-3333-333333333333?path=Season%201%2FDisc%20%26%20Extras&limit=50&offset=100'
    );
  });
});
