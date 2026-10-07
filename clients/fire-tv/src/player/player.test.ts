/** Pure helpers of the player controls: time formatting and the Original quality label. */
import {formatTime} from './PlayerChrome';
import {originalLabel} from './QualityMenu';

jest.mock('@amazon-devices/react-linear-gradient', () => 'LinearGradient');

describe('formatTime', () => {
  it('reads minutes and seconds under an hour', () => {
    expect(formatTime(2)).toBe('0:02');
    expect(formatTime(754)).toBe('12:34');
  });
  it('adds hours past one', () => {
    expect(formatTime(6006)).toBe('1:40:06');
  });
  it('treats junk as zero', () => {
    expect(formatTime(NaN)).toBe('0:00');
    expect(formatTime(-5)).toBe('0:00');
  });
});

describe('originalLabel', () => {
  it('shows the real bitrate', () => {
    expect(originalLabel({id: 'original', label: 'Original', video_bitrate_bps: 12_600_000})).toBe('Original · 12.6 Mbps');
  });
  it('never shows 0 Mbps', () => {
    expect(originalLabel({id: 'original', label: 'Original', video_bitrate_bps: 0})).toBe('Original');
    expect(originalLabel(undefined)).toBe('Original');
  });
});
