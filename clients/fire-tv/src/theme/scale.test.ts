import {Dimensions} from 'react-native';
import {sf, sh, sw} from './scale';

describe('theme/scale', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is a no-op at exactly the 1920x1080 baseline', () => {
    jest.spyOn(Dimensions, 'get').mockReturnValue({
      width: 1920,
      height: 1080,
      scale: 1,
      fontScale: 1,
    });

    expect(sw(86)).toBe(86);
    expect(sh(38)).toBe(38);
    expect(sf(24)).toBe(24);
  });

  it('scales proportionally on a smaller (e.g. 1280x720) panel', () => {
    jest.spyOn(Dimensions, 'get').mockReturnValue({
      width: 1280,
      height: 720,
      scale: 1,
      fontScale: 1,
    });

    // 1280 / 1920 = 2/3
    expect(sw(1920)).toBe(1280);
    // 720 / 1080 = 2/3
    expect(sh(1080)).toBe(720);
  });

  it('scales proportionally on a larger (e.g. 3840x2160 / 4K) panel', () => {
    jest.spyOn(Dimensions, 'get').mockReturnValue({
      width: 3840,
      height: 2160,
      scale: 1,
      fontScale: 1,
    });

    expect(sw(960)).toBe(1920);
    expect(sh(540)).toBe(1080);
  });

  it('reads Dimensions fresh on every call rather than caching at import time', () => {
    // A persistent mockReturnValue, reassigned between the two sw() calls
    // below, rather than a mockReturnValueOnce() queue: PixelRatio's own
    // roundToNearestPixel implementation (node_modules/react-native/
    // Libraries/Utilities/PixelRatio.js) calls Dimensions.get('window')
    // again internally to read `scale`, so each sw() call consumes MORE
    // than one Dimensions.get() call -- a fixed-size once-queue would be
    // sensitive to exactly how many, which is react-native's own
    // implementation detail, not something this test should assume.
    const getSpy = jest.spyOn(Dimensions, 'get');

    getSpy.mockReturnValue({width: 1920, height: 1080, scale: 1, fontScale: 1});
    expect(sw(100)).toBe(100);

    getSpy.mockReturnValue({width: 3840, height: 2160, scale: 1, fontScale: 1});
    expect(sw(100)).toBe(200);
  });
});
