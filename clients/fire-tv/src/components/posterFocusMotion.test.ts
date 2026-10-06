import {focusMotion} from '../theme/tokens';
import {effectiveFocusScale} from './posterFocusMotion';

describe('effectiveFocusScale', () => {
  it('is exactly restScale (1) when not focused, regardless of activeRailFactor', () => {
    expect(effectiveFocusScale(false, 1)).toBe(focusMotion.restScale);
    expect(effectiveFocusScale(false, 0)).toBe(focusMotion.restScale);
  });

  it('is exactly focusScale (1.08) when focused on the active rail', () => {
    expect(effectiveFocusScale(true, 1)).toBe(focusMotion.focusScale);
  });

  it('defaults activeRailFactor to 1 (fully active) when omitted', () => {
    expect(effectiveFocusScale(true)).toBe(focusMotion.focusScale);
  });

  it('suppresses the scale-up entirely when the rail is fully inactive, even while focused', () => {
    expect(effectiveFocusScale(true, 0)).toBe(focusMotion.restScale);
  });

  it('interpolates linearly for a partial activeRailFactor', () => {
    expect(effectiveFocusScale(true, 0.5)).toBeCloseTo(
      focusMotion.restScale + 0.5 * (focusMotion.focusScale - focusMotion.restScale),
      10
    );
  });

  it('clamps an out-of-range activeRailFactor rather than producing a scale outside [restScale, focusScale]', () => {
    expect(effectiveFocusScale(true, 5)).toBe(focusMotion.focusScale);
    expect(effectiveFocusScale(true, -3)).toBe(focusMotion.restScale);
  });
});
