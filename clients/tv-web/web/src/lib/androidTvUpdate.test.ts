import { describe, expect, it, vi } from "vitest";
import {
  canCheckForAndroidTvUpdates,
  parseAndroidTvUpdateState,
  requestAndroidTvUpdate,
} from "./androidTvUpdate";

describe("Android TV native updates", () => {
  it("calls the native bridge only when it is available", () => {
    const checkForUpdates = vi.fn();

    expect(requestAndroidTvUpdate({ checkForUpdates })).toBe(true);
    expect(checkForUpdates).toHaveBeenCalledOnce();
    expect(canCheckForAndroidTvUpdates(undefined)).toBe(false);
  });

  it("normalises progress and rejects unknown native events", () => {
    expect(
      parseAndroidTvUpdateState({
        status: "downloading",
        versionName: "1.2.3",
        progress: 104.4,
      })
    ).toEqual({ status: "downloading", versionName: "1.2.3", progress: 100 });
    expect(parseAndroidTvUpdateState({ status: "unexpected" })).toBeNull();
  });
});
