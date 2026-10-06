/**
 * Smoke-tests the one piece of real logic this screen has: which action its
 * single button takes, driven off `navigation.canGoBack` -- everything else
 * is static copy, already covered by the fact that this renders at all under
 * `react-test-renderer` without a real Vega host.
 */
// See NotFoundScreen.tsx's own import comment: this project's classic JSX
// runtime means every file with JSX -- test files included -- needs `React`
// as a real value import, not just a type import, or `<Foo />` fails at
// render time with `ReferenceError: React is not defined` despite
// typechecking cleanly.
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Text} from 'react-native';
import {NotFoundScreen, type NotFoundScreenNavigation} from './NotFoundScreen';

function fakeNavigation(canGoBack: boolean): NotFoundScreenNavigation & {
  goBack: jest.Mock;
  navigateHome: jest.Mock;
} {
  return {
    canGoBack,
    goBack: jest.fn(),
    navigateHome: jest.fn(),
  };
}

function allText(renderer: ReactTestRenderer): string {
  return renderer
    .root.findAllByType(Text)
    .map((node) => node.props.children)
    .flat()
    .join(' ');
}

describe('NotFoundScreen', () => {
  it('renders the "lost in the library" copy', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<NotFoundScreen navigation={fakeNavigation(false)} />);
    });

    expect(allText(renderer)).toContain('Page not found');
  });

  it('goes back when navigation.canGoBack is true', () => {
    const navigation = fakeNavigation(true);
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<NotFoundScreen navigation={navigation} />);
    });

    act(() => {
      renderer.root.findByProps({accessibilityRole: 'button'}).props.onPress();
    });

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(navigation.navigateHome).not.toHaveBeenCalled();
  });

  it('navigates home when there is nowhere to go back to', () => {
    const navigation = fakeNavigation(false);
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<NotFoundScreen navigation={navigation} />);
    });

    act(() => {
      renderer.root.findByProps({accessibilityRole: 'button'}).props.onPress();
    });

    expect(navigation.navigateHome).toHaveBeenCalledTimes(1);
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});
