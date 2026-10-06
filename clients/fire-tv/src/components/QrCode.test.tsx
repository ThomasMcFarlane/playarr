/**
 * `@amazon-devices/react-native-svg` reaches all the way down to
 * `requireNativeComponent` the moment it is imported (verified directly: an
 * un-mocked `import Svg from '@amazon-devices/react-native-svg'` under this
 * project's plain `jest` config throws `Invariant Violation:
 * __fbBatchedBridgeConfig is not set, cannot invoke native modules` before a
 * single test even runs, since there is no real Kepler/RN host backing it
 * here -- design doc §8.2's boundary, the same reason `platform/focus.tsx`
 * has no test of its own). A local, file-scoped `jest.mock()` (hoisted
 * above the `import` below by babel-plugin-jest-hoist, so it takes effect
 * before `QrCode.tsx`'s own `import Svg, {Path} from
 * '@amazon-devices/react-native-svg'` ever runs) swaps in trivial string
 * tags instead -- enough for `react-test-renderer` to build a tree and this
 * file to assert on it, without touching `jest.config.json` or
 * `jest.setup.ts` (this task's own constraint: those are shared surfaces
 * other concurrent feature work may also be touching).
 */
jest.mock('@amazon-devices/react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Path: 'Path',
}));

import * as React from 'react';
import renderer, {act} from 'react-test-renderer';
import {parseQrCodeSvg, QrCode} from './QrCode';

const BACKGROUND_AND_MODULES_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 33 33" shape-rendering="crispEdges">' +
  '<path fill="#ffffff" d="M0 0h33v33H0z"/>' +
  '<path stroke="#000000" d="M2 2.5h7m2 0h2"/>' +
  '</svg>\n';

describe('parseQrCodeSvg', () => {
  it("parses qrcode's real two-path SVG shape (background fill + modules stroke)", () => {
    expect(parseQrCodeSvg(BACKGROUND_AND_MODULES_SVG)).toEqual({
      viewBoxWidth: 33,
      viewBoxHeight: 33,
      backgroundD: 'M0 0h33v33H0z',
      backgroundFill: '#ffffff',
      modulesPath: 'M2 2.5h7m2 0h2',
      moduleColor: '#000000',
    });
  });

  it('parses correctly regardless of which path comes first', () => {
    const reordered =
      '<svg viewBox="0 0 21 21"><path stroke="#111111" d="M1 1h1"/><path fill="#eeeeee" d="M0 0h21v21H0z"/></svg>';
    expect(parseQrCodeSvg(reordered)).toEqual({
      viewBoxWidth: 21,
      viewBoxHeight: 21,
      backgroundD: 'M0 0h21v21H0z',
      backgroundFill: '#eeeeee',
      modulesPath: 'M1 1h1',
      moduleColor: '#111111',
    });
  });

  it('parses a modules-only SVG (no background path) as having no background', () => {
    const noBackground = '<svg viewBox="0 0 21 21"><path stroke="#000000" d="M1 1h1"/></svg>';
    expect(parseQrCodeSvg(noBackground)).toEqual({
      viewBoxWidth: 21,
      viewBoxHeight: 21,
      backgroundD: undefined,
      backgroundFill: undefined,
      modulesPath: 'M1 1h1',
      moduleColor: '#000000',
    });
  });

  it('returns undefined for a string with no viewBox', () => {
    expect(parseQrCodeSvg('<svg><path stroke="#000" d="M1 1h1"/></svg>')).toBeUndefined();
  });

  it('returns undefined for a string with no modules (stroke) path', () => {
    expect(parseQrCodeSvg('<svg viewBox="0 0 21 21"><path fill="#fff" d="M0 0h21v21H0z"/></svg>')).toBeUndefined();
  });

  it('returns undefined for a string that is not SVG at all', () => {
    expect(parseQrCodeSvg('not svg')).toBeUndefined();
  });
});

describe('<QrCode>', () => {
  it('renders nothing until the async QR encoding resolves', () => {
    const tree = renderer.create(<QrCode value="https://playarr.app/link?user_code=ABCD-2345" />);
    expect(tree.toJSON()).toBeNull();
  });

  it('renders an Svg/Path tree with the real qrcode-encoded geometry once resolved', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <QrCode value="https://playarr.app/link?user_code=ABCD-2345" size={240} accessibilityLabel="Pairing QR code" />
      );
      // Flush the createQrCodeSvg() promise microtask queue.
      await Promise.resolve();
      await Promise.resolve();
    });

    const svg = tree.root.findByType('Svg' as never);
    expect(svg.props.width).toBe(240);
    expect(svg.props.height).toBe(240);
    expect(svg.props.accessibilityLabel).toBe('Pairing QR code');
    expect(svg.props.viewBox).toMatch(/^0 0 \d+ \d+$/);

    const paths = tree.root.findAllByType('Path' as never);
    // Background fill + modules stroke -- qrcode's real output for a
    // non-trivial value always includes both (design doc: verified against
    // `qrcode`'s own renderer source, see QrCode.tsx's top comment).
    expect(paths).toHaveLength(2);
    expect(paths[1]?.props.strokeWidth).toBe(1);
    expect(paths[1]?.props.fill).toBe('none');
    expect(typeof paths[1]?.props.d).toBe('string');
    expect(paths[1]?.props.d.length).toBeGreaterThan(0);
  });

  it('re-renders (clearing the previous QR) when the value prop changes', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<QrCode value="https://playarr.app/link?user_code=AAAA-0000" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const firstPaths = tree.root.findAllByType('Path' as never);
    const firstModulesD = firstPaths[1]?.props.d as string;

    await act(async () => {
      tree.update(<QrCode value="https://playarr.app/link?user_code=ZZZZ-9999" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const secondPaths = tree.root.findAllByType('Path' as never);
    const secondModulesD = secondPaths[1]?.props.d as string;

    expect(secondModulesD).not.toBe(firstModulesD);
  });
});
