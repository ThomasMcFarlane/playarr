import {resolveBack, showSpinner, transportChromeMounted} from './playerStage';

describe('player stage', () => {
  it('opens straight into the player with a spinner while negotiating', () => {
    expect(transportChromeMounted()).toBe(true);
    expect(showSpinner({negotiation: 'loading', buffering: false, failed: false})).toBe(true);
    expect(showSpinner({negotiation: 'idle', buffering: false, failed: false})).toBe(true);
  });

  it('shows only the standard spinner for mid-playback buffering', () => {
    expect(showSpinner({negotiation: 'ready', buffering: true, failed: false})).toBe(true);
    expect(showSpinner({negotiation: 'ready', buffering: false, failed: false})).toBe(false);
  });

  it('hides the spinner when playback failed', () => {
    expect(showSpinner({negotiation: 'error', buffering: false, failed: true})).toBe(false);
  });

  it('BACK closes visible controls first, then exits', () => {
    expect(resolveBack(true)).toBe('hide-controls');
    expect(resolveBack(false)).toBe('exit');
  });
});
