import {resumeSecondsFromServer, settleWithin, shouldWriteProgress} from './progressRules';

describe('resumeSecondsFromServer', () => {
  it('resumes a part-watched row', () => {
    expect(resumeSecondsFromServer({state: 'part_watched', position_ms: 12_500})).toBe(12.5);
  });
  it('starts from the beginning for unseen, watched, zero or missing rows', () => {
    expect(resumeSecondsFromServer({state: 'unseen', position_ms: 0})).toBeUndefined();
    expect(resumeSecondsFromServer({state: 'watched', position_ms: 9000})).toBeUndefined();
    expect(resumeSecondsFromServer({state: 'part_watched', position_ms: 0})).toBeUndefined();
    expect(resumeSecondsFromServer(undefined)).toBeUndefined();
  });
});

describe('shouldWriteProgress', () => {
  it('never writes when playback never started', () => {
    expect(shouldWriteProgress({positionMs: 5000, completed: false, playbackStarted: false})).toBe(false);
    expect(shouldWriteProgress({positionMs: 0, completed: true, playbackStarted: false})).toBe(false);
  });
  it('never writes position 0 unless completed', () => {
    expect(shouldWriteProgress({positionMs: 0, completed: false, playbackStarted: true})).toBe(false);
    expect(shouldWriteProgress({positionMs: 0, completed: true, playbackStarted: true})).toBe(true);
  });
  it('writes a started position', () => {
    expect(shouldWriteProgress({positionMs: 1, completed: false, playbackStarted: true})).toBe(true);
  });
});

describe('settleWithin', () => {
  it('resolves when the work rejects', async () => {
    await expect(settleWithin(Promise.reject(new Error('x')), 1000)).resolves.toBeUndefined();
  });
  it('resolves after the timeout for work that never settles', async () => {
    jest.useFakeTimers();
    const done = settleWithin(new Promise(() => undefined), 3000);
    jest.advanceTimersByTime(3000);
    await expect(done).resolves.toBeUndefined();
    jest.useRealTimers();
  });
});
