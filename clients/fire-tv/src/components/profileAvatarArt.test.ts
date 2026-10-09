import {spawnSync} from 'child_process';
import fs from 'fs';
import path from 'path';
import {PROFILE_AVATAR_ART} from './profileAvatarArt.generated';
import {PROFILE_AVATAR_PRESETS} from './profileAvatarPresets';

// jest runs with clients/fire-tv as the working directory.
const shared = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '../shared/profile-avatars/presets.json'), 'utf8')) as {
  presets: {id: string; start: string; end: string; art: string[]}[];
};

describe('preset avatar art', () => {
  it('has the shared presets, in the shared order, with the shared gradient colours', () => {
    expect(PROFILE_AVATAR_PRESETS.map((preset) => ({...preset}))).toEqual(
      shared.presets.map(({id, start, end}) => ({id, start, end})),
    );
  });

  it('draws every element of the shared artwork', () => {
    for (const preset of shared.presets) {
      expect(PROFILE_AVATAR_ART[preset.id]).toHaveLength(preset.art.length);
    }
  });

  it('is up to date with the shared presets.json (run scripts/gen-avatar-art.mjs)', () => {
    const result = spawnSync(process.execPath, ['scripts/gen-avatar-art.mjs', '--check'], {cwd: process.cwd(), encoding: 'utf8'});
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
