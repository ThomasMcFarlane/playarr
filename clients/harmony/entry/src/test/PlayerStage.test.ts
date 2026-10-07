import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromeMounted, errorPanelVisible, resolveBack, spinnerVisible } from '../main/ets/core/PlayerStage';

test('Play mounts the player chrome directly while loading', () => {
  assert.equal(chromeMounted('loading', false), true);
  assert.equal(spinnerVisible('loading'), true);
  assert.equal(errorPanelVisible('loading'), false);
});

test('only an error replaces the stage', () => {
  assert.equal(errorPanelVisible('error'), true);
  assert.equal(chromeMounted('error', false), false);
  assert.equal(spinnerVisible('ready'), false);
});

test('BACK hides the controls first, then exits', () => {
  assert.equal(resolveBack(true), 'hide-controls');
  assert.equal(resolveBack(false), 'exit');
});
