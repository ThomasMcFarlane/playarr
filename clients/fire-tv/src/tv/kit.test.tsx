/** BalancedT: narrows a wrapped title to its widest line, but never below a whole word. */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Dimensions, Text, View} from 'react-native';
import {ThemeProvider} from '../theme/ThemeProvider';
import {BalancedT} from './kit';

(globalThis as unknown as {React: typeof React}).React = React;

function layout(renderer: ReactTestRenderer, lines: Array<{text: string; width: number}>): void {
  const unit = Dimensions.get('window').width / 1920;
  act(() => renderer.root.findByType(Text).props.onTextLayout({nativeEvent: {lines: lines.map((line) => ({...line, width: line.width * unit}))}}));
}
const width = (renderer: ReactTestRenderer): number => renderer.root.findAllByType(View)[0].props.style.width;

test('stops at the last whole-word width when the next pass breaks inside a word', () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <ThemeProvider>
        <BalancedT width={373} size={69} color="#fff">
          Wordy (2021)
        </BalancedT>
      </ThemeProvider>,
    );
  });
  const full = width(renderer);
  layout(renderer, [{text: 'Wordy ', width: 290}, {text: '(2021)', width: 200}]);
  expect(width(renderer)).toBeLessThan(full);
  layout(renderer, [{text: 'Wordy ', width: 280}, {text: '(2021)', width: 200}]);
  const lastWhole = width(renderer);
  // A line without its trailing space is still a whole-word break (Vega may trim it), so the search goes on.
  layout(renderer, [{text: 'Wordy', width: 275}, {text: '(2021)', width: 200}]);
  expect(width(renderer)).toBeLessThan(lastWhole);
  // "Word" / "y (2021)" breaks inside a word: back to the last width laid out with whole words.
  layout(renderer, [{text: 'Word', width: 250}, {text: 'y (2021)', width: 270}]);
  const good = width(renderer);
  expect(good).toBe(lastWhole);
  // Done: later layouts change nothing.
  layout(renderer, [{text: 'Wordy ', width: 100}, {text: '(2021)', width: 100}]);
  expect(width(renderer)).toBe(good);
});
