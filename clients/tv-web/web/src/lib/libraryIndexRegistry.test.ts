import { describe, expect, it, vi } from "vitest";
import { ensureLibraryIndex, registerEnsureLibraryIndex } from "./libraryIndexRegistry";

const fakeGrid = () => ({}) as HTMLElement;

describe("libraryIndexRegistry (audit A15)", () => {
  it("calls the function registered for that grid only", () => {
    const a = fakeGrid();
    const b = fakeGrid();
    const ensureA = vi.fn();
    registerEnsureLibraryIndex(a, ensureA);
    ensureLibraryIndex(a, 7);
    ensureLibraryIndex(b, 9);
    expect(ensureA).toHaveBeenCalledOnce();
    expect(ensureA).toHaveBeenCalledWith(7);
  });

  it("stops calling after the unregister function runs, and tolerates a missing grid", () => {
    const grid = fakeGrid();
    const ensure = vi.fn();
    const unregister = registerEnsureLibraryIndex(grid, ensure);
    unregister();
    ensureLibraryIndex(grid, 1);
    ensureLibraryIndex(null, 1);
    expect(ensure).not.toHaveBeenCalled();
  });

  it("does not let a stale cleanup remove a newer registration", () => {
    const grid = fakeGrid();
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registerEnsureLibraryIndex(grid, first);
    registerEnsureLibraryIndex(grid, second);
    unregisterFirst();
    ensureLibraryIndex(grid, 3);
    expect(second).toHaveBeenCalledWith(3);
  });
});
