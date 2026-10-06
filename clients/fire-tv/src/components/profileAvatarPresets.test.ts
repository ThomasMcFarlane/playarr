import {PROFILE_AVATAR_PRESETS, pickProfileAvatarPreset} from './profileAvatarPresets';

describe('pickProfileAvatarPreset', () => {
  it('is deterministic -- the same id always yields the same preset', () => {
    const first = pickProfileAvatarPreset('11111111-1111-4111-8111-111111111111');
    const second = pickProfileAvatarPreset('11111111-1111-4111-8111-111111111111');
    expect(second).toBe(first);
  });

  it('always returns one of the six real presets, never a synthesised value', () => {
    const ids = ['alice', 'bob', 'carol', 'dwayne', 'edwina', 'freya', 'gary', 'holly'];
    for (const id of ids) {
      const preset = pickProfileAvatarPreset(id);
      expect(PROFILE_AVATAR_PRESETS).toContainEqual(preset);
    }
  });

  it('spreads different ids across more than one preset (not a constant-hash bug)', () => {
    const ids = ['alice', 'bob', 'carol', 'dwayne', 'edwina', 'freya', 'gary', 'holly', 'ivy', 'jack'];
    const seen = new Set(ids.map((id) => pickProfileAvatarPreset(id).id));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('matches the exact hash the web app uses for a known id, so the two clients agree pixel-for-pixel on which gradient a shared profile gets', () => {
    // Hand-computed against profileAvatarPresets.ts's own algorithm (and
    // character-for-character identical to
    // clients/tv-web/web/src/lib/profileAvatar.ts's
    // defaultProfileAvatarPreset): for the literal id "profile-1",
    // hash = 0; for each char: hash = (hash*31 + charCode) >>> 0.
    let hash = 0;
    for (const char of 'profile-1') hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const expected = PROFILE_AVATAR_PRESETS[hash % PROFILE_AVATAR_PRESETS.length];

    expect(pickProfileAvatarPreset('profile-1')).toEqual(expected);
  });

  it('treats the empty string as a valid (if degenerate) input rather than throwing', () => {
    expect(() => pickProfileAvatarPreset('')).not.toThrow();
    expect(pickProfileAvatarPreset('')).toEqual(PROFILE_AVATAR_PRESETS[0]);
  });
});
