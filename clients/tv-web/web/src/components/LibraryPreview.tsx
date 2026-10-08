import { useEffect, useState, useSyncExternalStore } from "react";
import type { ImageKind, Work } from "@playarr-tv/api-client";
import { CachedArtworkImage } from "../lib/artwork";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { PreviewStore } from "../lib/previewStore";
import { yearRangeLabel } from "../lib/workYear";

/**
 * The left preview of a library page. It shows the work the remote is on right now (the store), or the page's
 * settled selection before the first move. Everything comes from the list response, so it never waits on a
 * detail request, and it changes in place: no remount, so the text is never blank and the enter animation does
 * not replay on every key.
 */
export function LibraryPreview({
  store,
  fallback,
  singular,
}: {
  store: PreviewStore<Work>;
  fallback: Work;
  singular: string;
}) {
  const { t } = useLanguage();
  const work = useSyncExternalStore(store.subscribe, store.get, store.get) ?? fallback;
  const year = yearRangeLabel(work);
  return (
    <aside className="tv-library-preview">
      <p className="tv-provider">{work.genres[0] ?? singular}</p>
      <h2>{work.title}</h2>
      <p className="tv-preview-meta">
        {year !== null ? <span>{year}</span> : null}
        <span>{work.genres.slice(0, 2).join(" · ") || singular}</span>
      </p>
      <p className="tv-preview-overview">{work.overview ?? t("pages.library.noSynopsis")}</p>
    </aside>
  );
}

/** How long the incoming art may take before it fades in anyway (no art, or a slow fetch). */
const ART_READY_FALLBACK_MS = 900;
/** Matches the opacity transition of `.tv-key-art-layer`. */
const ART_FADE_MS = 420;

interface ArtLayer {
  work: Work;
  ready: boolean;
}

/**
 * Backdrop art that cross-fades. A new work's art is mounted hidden over the current one and fades in once its
 * image has loaded (or after a short fallback), then the older layer goes. The previous art stays until then, so
 * the backdrop never blanks while the next image is on its way.
 */
export function CrossfadeArt({
  work,
  kinds,
}: {
  work: Work;
  kinds: readonly ImageKind[];
}) {
  const [layers, setLayers] = useState<ArtLayer[]>([{ work, ready: true }]);
  const top = layers[layers.length - 1]!;
  if (top.work.id !== work.id) {
    // Adjust state while rendering (the changed prop): keep the last visible layer and add the new one hidden.
    const visible = layers.filter((layer) => layer.ready).slice(-1);
    setLayers([...visible, { work, ready: false }]);
  }
  const topId = layers[layers.length - 1]!.work.id;
  const topReady = layers[layers.length - 1]!.ready;
  const markReady = (id: string) =>
    setLayers((current) => current.map((layer) => (layer.work.id === id ? { ...layer, ready: true } : layer)));

  useEffect(() => {
    if (topReady) return;
    const timer = window.setTimeout(() => markReady(topId), ART_READY_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [topId, topReady]);

  const count = layers.length;
  useEffect(() => {
    if (count < 2 || !topReady) return;
    const timer = window.setTimeout(() => setLayers((current) => current.slice(-1)), ART_FADE_MS + 60);
    return () => window.clearTimeout(timer);
  }, [count, topReady, topId]);

  return (
    <>
      {layers.map((layer) => (
        <div key={layer.work.id} className={`tv-key-art-layer${layer.ready ? "" : " is-pending"}`}>
          <CachedArtworkImage
            work={layer.work}
            kinds={kinds}
            alt=""
            onLoad={() => markReady(layer.work.id)}
            fallback={<span>{layer.work.title}</span>}
          />
        </div>
      ))}
    </>
  );
}
