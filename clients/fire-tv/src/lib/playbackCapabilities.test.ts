import {VEGA_PLAYBACK_CAPABILITIES} from './playbackCapabilities';

describe('VEGA_PLAYBACK_CAPABILITIES', () => {
  it('advertises the containers and video codecs the device decodes, so the server can pick direct play', () => {
    expect(VEGA_PLAYBACK_CAPABILITIES.containers?.split(',')).toEqual(expect.arrayContaining(['mp4', 'mkv']));
    expect(VEGA_PLAYBACK_CAPABILITIES.videoCodecs?.split(',')).toEqual(expect.arrayContaining(['h264', 'hevc']));
  });

  it('lists real audio codec support', () => {
    expect(VEGA_PLAYBACK_CAPABILITIES.audioCodecs).toContain('aac');
    expect(VEGA_PLAYBACK_CAPABILITIES.audioCodecs).toContain('eac3');
  });
});
