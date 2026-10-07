import { describe, expect, it } from "vitest";
import { applyTvStageScale, computeTvStageScale } from "./tvStageScale";

describe("computeTvStageScale", () => {
  it("leaves a 1920x1080 viewport untouched", () => {
    expect(computeTvStageScale(1920, 1080)).toEqual({ zoom: 1, vw: 19.2, vh: 10.8 });
  });

  it("scales a 1280x720 VIDAA viewport to a 1920x1080 stage", () => {
    const scale = computeTvStageScale(1280, 720);
    expect(scale.zoom).toBeCloseTo(2 / 3, 5);
    expect(scale.vw * 100).toBeCloseTo(1920, 3);
    expect(scale.vh * 100).toBeCloseTo(1080, 3);
  });

  it("scales a 960x540 viewport (devicePixelRatio 2) the same way", () => {
    const scale = computeTvStageScale(960, 540);
    expect(scale.zoom).toBeCloseTo(0.5, 5);
    expect(scale.vw * 100).toBeCloseTo(1920, 3);
  });

  it("scales a 3840x2160 viewport down to the stage", () => {
    const scale = computeTvStageScale(3840, 2160);
    expect(scale.zoom).toBeCloseTo(2, 5);
    expect(scale.vh * 100).toBeCloseTo(1080, 3);
  });

  it("keeps the stage height fixed and lets the width follow the aspect ratio", () => {
    const scale = computeTvStageScale(1366, 768);
    expect(scale.vh * 100).toBeCloseTo(1080, 3);
    expect(scale.vw * 100).toBeCloseTo(1366 / (768 / 1080), 3);
  });

  it("ignores an unusable viewport", () => {
    expect(computeTvStageScale(0, 0).zoom).toBe(1);
  });
});

describe("applyTvStageScale", () => {
  function fakeRoot() {
    const values = new Map<string, string>();
    const root = {
      style: {
        setProperty: (name: string, value: string) => void values.set(name, value),
        removeProperty: (name: string) => void values.delete(name),
      },
    } as unknown as HTMLElement;
    return { root, values };
  }

  it("writes the root zoom and the stage-pixel viewport units", () => {
    const { root, values } = fakeRoot();
    applyTvStageScale(root, 1280, 720);
    expect(Number(values.get("zoom"))).toBeCloseTo(2 / 3, 5);
    expect(values.get("--vw")).toMatch(/px$/);
    expect(values.get("--viewport-unit")).toMatch(/px$/);
  });

  it("clears them again once the viewport is the stage", () => {
    const { root, values } = fakeRoot();
    applyTvStageScale(root, 1280, 720);
    applyTvStageScale(root, 1920, 1080);
    expect(values.size).toBe(0);
  });
});
