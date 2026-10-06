import {computeScrollEdges} from './scrollEdges';

describe('computeScrollEdges', () => {
  it('reports neither edge when all content fits within the viewport', () => {
    expect(computeScrollEdges(0, 800, 800)).toEqual({start: false, end: false});
  });

  it('reports only "end" at the very start of a rail with more content off-screen', () => {
    expect(computeScrollEdges(0, 800, 2400)).toEqual({start: false, end: true});
  });

  it('reports only "start" once scrolled all the way to the trailing edge', () => {
    expect(computeScrollEdges(1600, 800, 2400)).toEqual({start: true, end: false});
  });

  it('reports both edges when scrolled to the middle of a long rail', () => {
    expect(computeScrollEdges(800, 800, 2400)).toEqual({start: true, end: true});
  });

  it('absorbs sub-pixel noise within the tolerance band rather than flickering', () => {
    expect(computeScrollEdges(1, 800, 2400)).toEqual({start: false, end: true});
    expect(computeScrollEdges(4, 800, 2400)).toEqual({start: true, end: true});
  });

  it('accepts a custom tolerance for callers with a different noise floor', () => {
    expect(computeScrollEdges(1, 800, 2400, 0)).toEqual({start: true, end: true});
  });
});
