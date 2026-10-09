import { describe, expect, it, vi } from "vitest";
import { runCastHandoff } from "./castHandoff";

function steps(start: () => Promise<void>) {
  return {
    pauseLocal: vi.fn(),
    resumeLocal: vi.fn(),
    endSession: vi.fn(),
    start: vi.fn(start),
  };
}

describe("runCastHandoff", () => {
  it("pauses local playback and leaves it paused when the cast starts", async () => {
    const s = steps(async () => undefined);
    await runCastHandoff(s);
    expect(s.pauseLocal).toHaveBeenCalledTimes(1);
    expect(s.resumeLocal).not.toHaveBeenCalled();
    expect(s.endSession).not.toHaveBeenCalled();
  });

  it("ends the session, resumes local playback and rethrows when the start fails", async () => {
    const failure = new Error("receiver rejected the load");
    const s = steps(async () => {
      throw failure;
    });
    await expect(runCastHandoff(s)).rejects.toBe(failure);
    expect(s.endSession).toHaveBeenCalledTimes(1);
    expect(s.resumeLocal).toHaveBeenCalledTimes(1);
  });

  it("still resumes when ending the session throws", async () => {
    const s = steps(async () => {
      throw new Error("load failed");
    });
    s.endSession.mockImplementation(() => {
      throw new Error("gone");
    });
    await expect(runCastHandoff(s)).rejects.toThrow("load failed");
    expect(s.resumeLocal).toHaveBeenCalledTimes(1);
  });
});
