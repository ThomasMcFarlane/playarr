import { describe, expect, it, vi } from "vitest";
import {
  enterPictureInPicture,
  exitPictureInPicture,
  isPictureInPictureSupported,
} from "./pictureInPicture";

function fakeDoc(over: Record<string, unknown> = {}) {
  return { pictureInPictureEnabled: true, ...over } as unknown as Document;
}
function fakeVideo(over: Record<string, unknown> = {}) {
  return { requestPictureInPicture: vi.fn().mockResolvedValue({}), ...over } as unknown as HTMLVideoElement;
}

describe("isPictureInPictureSupported", () => {
  it("is true when the document and element both support it", () => {
    expect(isPictureInPictureSupported(fakeVideo(), fakeDoc())).toBe(true);
  });
  it("is false when disabled, unsupported or the element opts out", () => {
    expect(isPictureInPictureSupported(fakeVideo(), fakeDoc({ pictureInPictureEnabled: false }))).toBe(false);
    expect(isPictureInPictureSupported(fakeVideo(), {} as Document)).toBe(false);
    expect(isPictureInPictureSupported(fakeVideo({ requestPictureInPicture: undefined }), fakeDoc())).toBe(false);
    expect(isPictureInPictureSupported(fakeVideo({ disablePictureInPicture: true }), fakeDoc())).toBe(false);
    expect(isPictureInPictureSupported(null, fakeDoc())).toBe(false);
  });
});

describe("enterPictureInPicture", () => {
  it("requests PiP and reports success", async () => {
    const video = fakeVideo();
    await expect(enterPictureInPicture(video, fakeDoc())).resolves.toBe(true);
    expect(video.requestPictureInPicture).toHaveBeenCalledOnce();
  });
  it("reports false (use the in-app mini player) when unsupported", async () => {
    const video = fakeVideo({ requestPictureInPicture: undefined });
    await expect(enterPictureInPicture(video, fakeDoc())).resolves.toBe(false);
  });
  it("reports false when the browser rejects the request", async () => {
    const video = fakeVideo({ requestPictureInPicture: vi.fn().mockRejectedValue(new Error("no video track")) });
    await expect(enterPictureInPicture(video, fakeDoc())).resolves.toBe(false);
  });
});

describe("exitPictureInPicture", () => {
  it("exits only when this video is the PiP element", async () => {
    const video = fakeVideo();
    const exit = vi.fn().mockResolvedValue(undefined);
    await exitPictureInPicture(video, fakeDoc({ pictureInPictureElement: video, exitPictureInPicture: exit }));
    expect(exit).toHaveBeenCalledOnce();
    await exitPictureInPicture(video, fakeDoc({ pictureInPictureElement: null, exitPictureInPicture: exit }));
    expect(exit).toHaveBeenCalledOnce();
  });
});
