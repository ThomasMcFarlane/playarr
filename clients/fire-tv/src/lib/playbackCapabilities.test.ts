import {VEGA_PLAYBACK_CAPABILITIES} from './playbackCapabilities';

describe('VEGA_PLAYBACK_CAPABILITIES', () => {
  it('advertises no direct-playable container or video codec, so the server can never select mode: "direct"', () => {
    expect(VEGA_PLAYBACK_CAPABILITIES.containers).toBe('');
    expect(VEGA_PLAYBACK_CAPABILITIES.videoCodecs).toBe('');
  });

  it('still lists real, informational audio codec support', () => {
    expect(VEGA_PLAYBACK_CAPABILITIES.audioCodecs).toContain('aac');
    expect(VEGA_PLAYBACK_CAPABILITIES.audioCodecs).toContain('eac3');
  });
});
