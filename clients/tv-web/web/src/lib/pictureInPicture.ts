/** Browser Picture-in-Picture helpers for the web player's minimise action. */

interface PipVideo {
  requestPictureInPicture?: () => Promise<unknown>;
  disablePictureInPicture?: boolean;
}

interface PipDocument {
  pictureInPictureEnabled?: boolean;
  pictureInPictureElement?: Element | null;
  exitPictureInPicture?: () => Promise<void>;
}

export function isPictureInPictureSupported(
  video: HTMLVideoElement | null | undefined,
  doc: Document = document
): boolean {
  if (!video) return false;
  const pipVideo = video as unknown as PipVideo;
  return (
    (doc as unknown as PipDocument).pictureInPictureEnabled === true &&
    typeof pipVideo.requestPictureInPicture === "function" &&
    pipVideo.disablePictureInPicture !== true
  );
}

/** Resolves true when the video entered Picture-in-Picture; false means use the in-app mini player. */
export async function enterPictureInPicture(
  video: HTMLVideoElement | null | undefined,
  doc: Document = document
): Promise<boolean> {
  if (!isPictureInPictureSupported(video, doc)) return false;
  try {
    await (video as unknown as PipVideo).requestPictureInPicture!();
    return true;
  } catch {
    // No video track (audio-only), blocked by policy or no user activation.
    return false;
  }
}

export function isInPictureInPicture(
  video: HTMLVideoElement | null | undefined,
  doc: Document = document
): boolean {
  return Boolean(video) && (doc as unknown as PipDocument).pictureInPictureElement === video;
}

export async function exitPictureInPicture(
  video: HTMLVideoElement | null | undefined,
  doc: Document = document
): Promise<void> {
  if (!isInPictureInPicture(video, doc)) return;
  try {
    await (doc as unknown as PipDocument).exitPictureInPicture?.();
  } catch {
    // Already closed.
  }
}
