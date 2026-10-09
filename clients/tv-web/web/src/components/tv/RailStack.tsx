import { forwardRef, useCallback, type ReactNode } from "react";
import { isNavigationLayerRestoring } from "../../lib/navigationLayer";
import { smoothScrollTo, setScrollInstant } from "../../lib/smoothScroll";
import { SkeletonBlock } from "../shell/Skeleton";
import { mergeRefs } from "../../lib/mergeRefs";
import { TvMediaTrack, TvRailSurface, TvTrackSpacingContext, type TvTrackSpacing } from "./TvStage";

/** A track change glides to the vertical centre in this long: about 200 ms, owner motion rule. */
export const RAIL_CENTRE_MS = 180;

/**
 * Scrolls the stack that holds `track` so the track sits at its vertical centre.
 *
 * The target comes from layout alone (the track's position inside the scroller's content), never from where a
 * running glide happens to be, so a reverse press mid-glide lands exactly on the centre instead of overshooting.
 */
/** The track each stack was last centred on: the vertical position is decided once per rail change. */
const centredTrack = new WeakMap<HTMLElement, HTMLElement>();

export function centreTrackInStack(track: HTMLElement, options: { animate?: boolean } = {}): void {
  const stack = track.closest<HTMLElement>(".tv-rail-surface.is-vertical-tracks");
  if (!stack) return;
  centredTrack.set(stack, track);
  const trackRect = track.getBoundingClientRect();
  const stackRect = stack.getBoundingClientRect();
  const contentTop = trackRect.top - stackRect.top + stack.scrollTop;
  // Whole pixels, so text and art land on the pixel grid the same way every time.
  const target = Math.round(contentTop + trackRect.height / 2 - stack.clientHeight / 2);
  const max = Math.max(0, stack.scrollHeight - stack.clientHeight);
  const top = Math.max(0, Math.min(max, target));
  if (options.animate === false) setScrollInstant(stack, { top });
  else smoothScrollTo(stack, { top }, undefined, { duration: RAIL_CENTRE_MS });
}

/**
 * The shared vertical stack of media tracks (Home's rails, a show's seasons, Cast, Similar titles). Moving focus
 * into a track centres that track through the one scroll engine, and `spacing` sets the default gap between its
 * tracks: `related` (small) or `section` (larger).
 */
export const RailStack = forwardRef<
  HTMLDivElement,
  {
    className?: string;
    ariaLabel?: string;
    scrollKey?: string;
    spacing?: TvTrackSpacing;
    /**
     * Loading mode: the same stack, tracks and cards (same classes, so the same top, left, card size, gap and
     * spacing) with shimmering blocks instead of titles and art. Not focusable; announced through `skeletonLabel`.
     */
    skeleton?: { tracks: number; cards: number; label: string };
    children?: ReactNode;
  }
>(function RailStack({ spacing = "related", skeleton, children, ...surface }, ref) {
  // The loaded stack opens with its first track centred; the skeleton starts there too.
  const centreFirst = useCallback((node: HTMLDivElement | null) => {
    const first = node?.querySelector<HTMLElement>(".tv-media-track");
    if (first) centreTrackInStack(first, { animate: false });
  }, []);
  if (skeleton) {
    return (
      <TvRailSurface {...surface} ref={mergeRefs(ref, centreFirst)} mode="vertical-tracks">
        <TvTrackSpacingContext.Provider value={spacing}>
          <div role="status" aria-busy="true" aria-label={skeleton.label} style={{ display: "contents" }}>
            {Array.from({ length: skeleton.tracks }, (_, track) => (
              <TvMediaTrack
                key={track}
                title={<i className="skeleton-title-line">Recently added</i>}
                scrollKey={`skeleton:track:${track}`}
                itemsKey={`skeleton:${track}`}
                dataTrackId={`skeleton-${track}`}
              >
                {Array.from({ length: skeleton.cards }, (_, card) => (
                  <div className="media-card tv-home-card is-skeleton" key={card} aria-hidden="true">
                    <span className="tv-home-card-art">
                      <SkeletonBlock width="100%" height="100%" />
                    </span>
                    <strong className="skeleton skeleton-text-line">{"\u00a0"}</strong>
                    <small className="skeleton skeleton-text-line">{"\u00a0"}</small>
                  </div>
                ))}
              </TvMediaTrack>
            ))}
          </div>
        </TvTrackSpacingContext.Provider>
      </TvRailSurface>
    );
  }
  return (
    <TvRailSurface
      {...surface}
      ref={ref}
      mode="vertical-tracks"
      onFocusCapture={(event) => {
        if (isNavigationLayerRestoring()) return;
        const track = (event.target as HTMLElement).closest<HTMLElement>(".tv-media-track");
        if (!track) return;
        // Under remote keys real focus trails the marker by a few hundred ms. Focus arriving on a card the marker has
        // already left (a quick Down then Up) must not pull the stack back to that old rail: the marker's own rail has
        // been centring since its key, and the stack would otherwise glide away and return (the overshoot).
        const marker = document.querySelector<HTMLElement>("[data-remote-active]");
        if (marker && marker.closest(".tv-media-track") !== track) return;
        // Moving along a rail never moves the stack: the rail was centred when it was entered, and a later focus on one
        // of its cards (the real focus trailing the marker) must not re-measure and nudge it. Remote keys only; a
        // pointer or a wheel scroll still re-centres on focus.
        const stack = track.closest<HTMLElement>(".tv-rail-surface.is-vertical-tracks");
        if (stack && document.body.dataset.inputMode === "remote" && centredTrack.get(stack) === track) return;
        centreTrackInStack(track);
      }}
    >
      <TvTrackSpacingContext.Provider value={spacing}>{children}</TvTrackSpacingContext.Provider>
    </TvRailSurface>
  );
});
