import type { ImageAsset, ImageKind } from "@playarr-tv/api-client";

/** Picks the URL of the first image of a given kind, e.g. the poster or a backdrop, off a real `Work`. */
export function pickImage(images: ImageAsset[], kind: ImageKind): string | undefined {
  return images.find((image) => image.kind === kind)?.url;
}
