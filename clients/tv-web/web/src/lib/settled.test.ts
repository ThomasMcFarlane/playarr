import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSettled } from "./settled";

describe("createSettled", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("commits only the last value of a burst, after the delay", () => {
    const commit = vi.fn();
    const settled = createSettled<string>(700, commit);
    for (const label of ["Oct", "Nov", "Dec"]) {
      settled.push(label);
      vi.advanceTimersByTime(120);
    }
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(700);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("Dec");
  });

  it("commits nothing once cancelled", () => {
    const commit = vi.fn();
    const settled = createSettled<number>(50, commit);
    settled.push(1);
    settled.cancel();
    vi.advanceTimersByTime(500);
    expect(commit).not.toHaveBeenCalled();
  });
});
