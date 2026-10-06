import {
  TV_STAGE_EASING,
  TV_STAGE_ENTRANCE,
  TV_STAGE_KEY_ART,
  computeTvStageGeometry,
} from './tvStageGeometry';

describe('computeTvStageGeometry', () => {
  it('matches the hand-evaluated 1920px baseline from design doc §4.7 (7.5vw=144 clamps to neither bound; 27vw=518.4 sits under the 520px cap)', () => {
    const geometry = computeTvStageGeometry(1920);

    expect(geometry.titlePanel.left).toBeCloseTo(144, 5);
    expect(geometry.titlePanel.width).toBeCloseTo(518.4, 5);
    expect(geometry.titlePanel.topPercent).toBe(31);
  });

  it('clamps the title panel left offset to its 44px floor on a narrow viewport', () => {
    // 7.5% of 400px = 30px, below the 44px floor.
    const geometry = computeTvStageGeometry(400);
    expect(geometry.titlePanel.left).toBe(44);
  });

  it('clamps the title panel left offset to its 150px ceiling on a very wide viewport', () => {
    // 7.5% of 3000px = 225px, above the 150px ceiling.
    const geometry = computeTvStageGeometry(3000);
    expect(geometry.titlePanel.left).toBe(150);
  });

  it('caps the title panel width at 520px once 27vw would exceed it (e.g. a 4K 3840px panel)', () => {
    // 27% of 3840px = 1036.8px, far past the 520px cap.
    const geometry = computeTvStageGeometry(3840);
    expect(geometry.titlePanel.width).toBe(520);
  });

  it('never caps the title panel width below its natural 27vw value on a narrow viewport', () => {
    // 27% of 1000px = 270px, comfortably under the 520px cap.
    const geometry = computeTvStageGeometry(1000);
    expect(geometry.titlePanel.width).toBeCloseTo(270, 5);
  });

  it('keeps the rail panel geometry constant regardless of viewport width -- it has no vw/clamp() component', () => {
    const narrow = computeTvStageGeometry(400).railPanel;
    const wide = computeTvStageGeometry(3840).railPanel;
    expect(narrow).toEqual(wide);
    expect(narrow).toEqual({
      topPercent: 24,
      rightPercent: 3.8,
      widthPercent: 45,
      minHeightPercent: 39,
    });
  });
});

describe('TV_STAGE_KEY_ART', () => {
  it('locks the exact percentages harvested from .tv-key-art img in global.css', () => {
    expect(TV_STAGE_KEY_ART).toEqual({
      widthPercent: 52,
      heightPercent: 106,
      objectPositionYPercent: 20,
    });
  });
});

describe('TV_STAGE_ENTRANCE', () => {
  it('locks the exact stagger design doc §4.7 specifies: key art first, then copy +90ms, then rail +120ms', () => {
    expect(TV_STAGE_ENTRANCE).toEqual({
      keyArt: {durationMs: 760, delayMs: 0},
      titlePanel: {durationMs: 620, delayMs: 90},
      railPanel: {durationMs: 700, delayMs: 120},
    });
  });
});

describe('TV_STAGE_EASING', () => {
  it('is the exact cubic-bezier every entrance keyframe in global.css shares', () => {
    expect(TV_STAGE_EASING).toEqual([0.16, 1, 0.3, 1]);
  });
});
