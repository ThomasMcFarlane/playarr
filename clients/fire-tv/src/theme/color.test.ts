import {blend, mix, withAlpha} from './color';

describe('theme/color mix', () => {
  it('scales the alpha of a hex colour', () => {
    expect(mix('#211d21', 0.56)).toBe('rgba(33, 29, 33, 0.56)');
  });

  it('multiplies the alpha of an rgba colour', () => {
    expect(mix('rgba(223, 220, 221, 0.11)', 0.48)).toBe('rgba(223, 220, 221, 0.053)');
  });

  it('rejects colours it cannot parse', () => {
    expect(() => mix('red', 0.5)).toThrow();
  });
});

describe('theme/color blend and withAlpha', () => {
  it('mixes like color-mix in srgb', () => {
    expect(blend('#312a30', '#211d21', 0.44)).toBe('rgb(40, 35, 40)');
  });

  it('re-alphas a colour', () => {
    expect(withAlpha('#211d21', 0)).toBe('rgba(33, 29, 33, 0)');
  });
});
