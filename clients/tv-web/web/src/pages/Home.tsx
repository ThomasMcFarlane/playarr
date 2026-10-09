import { DetailsPanel } from "../components/DetailsPanel";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageLayout } from "../components/shell";
import type {
  ResumeOption,
  ResumePlan,
  WatchProgress,
  Work,
} from "@playarr-tv/api-client";
import { useCatalogBrowse, useHomeRails } from "@playarr-tv/api-client/react";
import { useApiClient } from "../lib/ApiClientProvider";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import {
  indexWatchProgressByWork,
  WatchStateOverlay,
} from "../components/WatchStateOverlay";
import { MediaThumbnailArtwork } from "../components/MediaThumbnailArtwork";
import { useMediaContextMenu } from "../components/MediaContextMenu";
import { CachedArtworkImage, useCachedArtwork } from "../lib/artwork";
import { setScrollInstant, smoothScrollTo } from "../lib/smoothScroll";
import { createPreviewStore, type PreviewStore } from "../lib/previewStore";
import { useRemoteMarkerFollow } from "../lib/remoteMarkerFollow";
import { useDwellPrefetch, warmSectionsAtIdle } from "../lib/prefetch";
import { railNeighbours, railsByDistance } from "../lib/detailNeighbours";
import { useFocusedDetail, useFocusedDetailsController } from "../lib/useFocusedDetails";
import { runtimeLabel } from "../lib/detailMeta";
import {
  isNavigationLayerRestoring,
  useNavigationLayer,
} from "../lib/navigationLayer";
import { labelWithYear } from "../lib/workYear";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useHomeView, type HomeViewPreference } from "../lib/homeView";
import { rememberWorks } from "../lib/knownWorks";
import { useLiveRevision, useLiveSubscription } from "../lib/liveEvents";
import { TvMediaTrack } from "../components/tv/TvStage";
import { RailStack, centreTrackInStack } from "../components/tv/RailStack";
import { ResumeChooserModal } from "../components/ResumeChooserModal";
import {
  resumePlayerState,
  seriesPlaylist,
} from "../lib/resumePlan";
import { loadOnDeck, type OnDeckEntry } from "../lib/onDeck";

const ON_DECK_CACHE_KEY = "home:ondeck";
interface StoredOnDeck {
  entries: OnDeckEntry[];
  progress: WatchProgress[];
  plans: Map<string, ResumePlan>;
}

const NO_WORK = { id: "", images: [] as Work["images"] };

function detailRoute(work: Work): string {
  return work.kind === "site"
    ? `/sites/${work.id}`
    : work.kind === "series"
      ? `/series/${work.id}`
      : work.kind === "artist"
        ? `/music/${work.id}`
      : `/movies/${work.id}`;
}

function workKindLabel(work: Work, t: ReturnType<typeof useLanguage>["t"]): string {
  return work.kind === "site"
    ? t("pages.home.workKind.site")
    : work.kind === "series"
      ? t("pages.home.workKind.series")
      : work.kind === "artist"
        ? t("pages.home.workKind.artist")
      : t("pages.home.workKind.movie");
}

function mergeRecent(...groups: Work[][]): Work[] {
  return groups
    .flat()
    .sort((a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime());
}

/** `primary`, `sites-new` / `sites-more`, or a server rail's definition id. */
type HomeRailId = string;

interface HomeRailDefinition {
  id: HomeRailId;
  title: string;
  items: Work[];
}

const EMPTY_WORKS: Work[] = [];

/** Longest Home holds its first render for the On Deck detail calls. */
const ON_DECK_WAIT_MS = 2500;

/** How long focus must rest before the page-level selection (backdrop art, prefetch) follows it under remote keys. */
const REMOTE_SELECT_SETTLE_MS = 140;

/** What the left panel shows: a work as it sits in one rail (the primary rail may carry an On Deck episode). */
interface HomeFocus {
  rail: HomeRailId;
  work: Work;
}

/** TV-first landing page: a mixed library spotlight plus on-deck and recent rails. */
export function HomePage() {
  const { t, language } = useLanguage();
  const { preference: homeView } = useHomeView();
  useDocumentTitle(t("pages.home.title"));
  const client = useApiClient();
  const liveCatalog = useLiveSubscription({ areas: ["catalog"] });
  const liveOnDeckRevision = useLiveRevision({ areas: ["progress", "catalog"] });
  const [railsAttempt, setRailsAttempt] = useState(0);
  const railsState = useHomeRails(client, { lang: language }, { subscribe: liveCatalog, retryKey: railsAttempt });
  const siteState = useCatalogBrowse(client, {
    kind: "site",
    available_only: true,
    sort: "recent",
    limit: 36,
  }, { subscribe: liveCatalog });
  const [activeRail, setActiveRail] = useState<HomeRailId>("primary");
  const [selectedByRail, setSelectedByRail] = useState<Record<HomeRailId, string | null>>({});
  // Stale-while-revalidate on the first render: the last resolved On Deck paints with the page on a revisit (Back),
  // instead of an empty, unsettled frame that the effect below then fills.
  const [seed] = useState(() => client.queries.peek<StoredOnDeck>(ON_DECK_CACHE_KEY)?.data ?? null);
  const [onDeck, setOnDeck] = useState<OnDeckEntry[]>(seed?.entries ?? []);
  const [onDeckSettled, setOnDeckSettled] = useState(seed !== null);
  const [resumeChooser, setResumeChooser] = useState<{ work: Work; plan: ResumePlan } | null>(
    null
  );
  const [stackedPlans, setStackedPlans] = useState<Map<string, ResumePlan>>(() => seed?.plans ?? new Map());
  const navigate = useNavigate();
  const [watchProgress, setWatchProgress] = useState<WatchProgress[] | null>(seed?.progress ?? null);
  const railsRef = useRef<HTMLDivElement>(null);
  const focusedRailRef = useRef<HomeRailId | null>(null);
  const homeSelectTimerRef = useRef(0);
  // Latest focus handler behind a stable identity so memoised rails never re-render for it.
  const focusFromRailRef = useRef<
    (rail: HomeRailId, id: string, section: HTMLElement) => void
  >(() => undefined);
  const stableFocusFromRail = useCallback(
    (rail: HomeRailId, id: string, section: HTMLElement) =>
      focusFromRailRef.current(rail, id, section),
    []
  );
  const pendingHomeSelectRef = useRef<{ rail: HomeRailId; id: string } | null>(
    null
  );
  // The panel on the left follows the focus marker through this store (no page re-render per key).
  const [featureStore] = useState(() => createPreviewStore<HomeFocus>());
  const followedRef = useRef<{ rail: HomeRailId; id: string } | null>(null);
  const handleProgressChanged = useCallback(
    (workId: string, updated: WatchProgress[]) => {
      const updatedIds = new Set(updated.map((progress) => progress.media_file_id));
      setWatchProgress((current) => [
        ...(current ?? []).filter(
          (progress) => !updatedIds.has(progress.media_file_id)
        ),
        ...updated,
      ]);
      setOnDeck((current) => current.filter((entry) => entry.work.id !== workId));
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    // On Deck is resolved through one detail call per title. The rails must not
    // be swapped under the viewer once they are interactive, so Home waits for
    // On Deck, but never longer than ON_DECK_WAIT_MS. That deadline only stops
    // the wait: results that arrive later are still applied (the rail then
    // fills in place and focus is kept, see the layout effect below). A live
    // refresh (revision > 0) updates in place and has no deadline.
    // Stale-while-revalidate: the last resolved On Deck paints at once on a revisit; any watch-state
    // write drops it (the "progress" tag), so it is never shown after the viewer changed progress.
    const stored = client.queries.peek<StoredOnDeck>(ON_DECK_CACHE_KEY);
    if (stored && liveOnDeckRevision === 0) {
      setWatchProgress(stored.data.progress);
      setStackedPlans(stored.data.plans);
      setOnDeck(stored.data.entries);
      setOnDeckSettled(true);
    }
    // Title details are shared with the detail pages through the query cache.
    const detailTags = ["catalog", "progress", "watchlist"] as const;
    let latestProgress: WatchProgress[] = [];
    let latestPlans = new Map<string, ResumePlan>();
    if (liveOnDeckRevision > 0) client.queries.invalidate(["progress"]);

    loadOnDeck(
      {
        listResumePlans: () => client.listResumePlans(),
        listWatchProgress: () => client.listWatchProgress(),
        getWork: (id) =>
          client.queries.fetch(`work:${id}`, () => client.getWork(id), { tags: detailTags, ttlMs: 30_000 }),
      },
      {
      isActive: () => !cancelled,
      onProgress: (rows) => {
        latestProgress = rows;
        setWatchProgress(rows);
      },
      onStackedPlans: (plans) => {
        latestPlans = plans;
        setStackedPlans(plans);
      },
      onEntries: (entries) => {
        client.queries.set(
          ON_DECK_CACHE_KEY,
          { entries, progress: latestProgress, plans: latestPlans } satisfies StoredOnDeck,
          ["progress", "catalog"]
        );
        setOnDeck((current) => (JSON.stringify(current) === JSON.stringify(entries) ? current : entries));
        setOnDeckSettled(true);
      },
    }).catch(() => {
      if (!cancelled && liveOnDeckRevision === 0) {
        setOnDeck([]);
        setWatchProgress(null);
        setOnDeckSettled(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [client, liveOnDeckRevision]);

  const serverRails = useMemo(
    () => (railsState.status === "ready" ? railsState.data.rails : []),
    [railsState]
  );
  const siteItems = siteState.status === "ready" ? siteState.data.items : EMPTY_WORKS;
  const items = useMemo(
    () => mergeRecent(...serverRails.map((rail) => rail.items), siteItems),
    [serverRails, siteItems]
  );
  useEffect(() => rememberWorks(items), [items]);
  const onDeckItems = useMemo(() => onDeck.map((entry) => entry.work), [onDeck]);
  const onDeckByWork = useMemo(
    () => new Map(onDeck.map((entry) => [entry.work.id, entry])),
    [onDeck]
  );
  const rails = useMemo<HomeRailDefinition[]>(() => {
    const usedIds = new Set<string>();
    const takeUnused = (source: Work[], count: number) => {
      const selectedItems: Work[] = [];
      for (const work of source) {
        if (usedIds.has(work.id)) continue;
        usedIds.add(work.id);
        selectedItems.push(work);
        if (selectedItems.length >= count) break;
      }
      return selectedItems;
    };

    const primaryItems =
      onDeckItems.length > 0
        ? takeUnused(onDeckItems, 10)
        : takeUnused(items, 8);

    const definitions: HomeRailDefinition[] = [
      {
        id: "primary",
        title: onDeckItems.length > 0 ? t("pages.home.rail.onDeck") : t("pages.home.rail.startWatching"),
        items: primaryItems,
      },
      ...serverRails.map((rail) => ({
        id: rail.id,
        title: rail.title,
        items: rail.items,
      })),
      {
        id: "sites-new",
        title: t("pages.home.rail.newSites"),
        items: takeUnused(siteItems, 12),
      },
      {
        id: "sites-more",
        title: t("pages.home.rail.moreSites"),
        items: takeUnused(siteItems, 12),
      },
    ];
    return definitions.filter((rail) => rail.items.length > 0);
  }, [items, onDeckItems, serverRails, siteItems, t]);
  const progressByWork = useMemo(
    () => indexWatchProgressByWork(watchProgress ?? []),
    [watchProgress]
  );
  // An empty server response is still "settled": Home then shows what it has.
  const homeDataSettled =
    (railsState.status === "ready" ||
      railsState.status === "empty" ||
      railsState.status === "error") &&
    siteState.status !== "idle" &&
    siteState.status !== "loading";
  // Home has painted: warm the likeliest next sections while the browser is idle, so their first visit renders
  // from the cache instead of a skeleton. Bounded, low priority, dropped when Home goes away.
  useEffect(() => {
    if (!homeDataSettled) return;
    return warmSectionsAtIdle(client, language);
  }, [homeDataSettled, client, language]);
  // The wait for On Deck is counted from the moment the rails themselves are ready, not from mount: on a cold
  // start the page mounts long before the first request can go out (sign-in refresh, version probe), and a
  // deadline counted from mount ran out before On Deck had even been asked for. Home then painted "Start
  // watching", and the rail swapped to "On deck" a second later (cards replaced and the stack re-centred).
  useEffect(() => {
    if (onDeckSettled || !homeDataSettled) return;
    const giveUp = window.setTimeout(() => setOnDeckSettled(true), ON_DECK_WAIT_MS);
    return () => window.clearTimeout(giveUp);
  }, [onDeckSettled, homeDataSettled]);
  const railsKey = useMemo(() => rails.map((rail) => rail.id).join(":"), [rails]);
  const navigationLayer = useNavigationLayer(
    rails
      .map((rail) => `${rail.id}:${rail.items.map((item) => item.id).join(",")}`)
      .join("|"),
    onDeckSettled && homeDataSettled,
    onDeckSettled && homeDataSettled
  );

  useLayoutEffect(() => {
    if (navigationLayer.hasSnapshot) return;
    // The rail set changed (first paint, or a rail appearing or going a few seconds later). The stack opens on the
    // first rail, but when the viewer has already moved on it stays on the rail they are on: re-centring the first
    // one would snap the page back to the top with no key press.
    const marker = document.querySelector<HTMLElement>("[data-remote-active]") ?? document.activeElement;
    const current = marker instanceof HTMLElement && railsRef.current?.contains(marker)
      ? marker.closest<HTMLElement>(".tv-media-track")
      : null;
    const section = current ?? railsRef.current?.querySelector<HTMLElement>(".tv-media-track");
    if (!section) return;
    centreTrackInStack(section, { animate: false });
    focusedRailRef.current = (section.dataset.tvTrackId as HomeRailId | undefined) ?? null;
  }, [navigationLayer.hasSnapshot, railsKey]);

  // A late On Deck result swaps the primary rail's cards. If the viewer was
  // focused on one that was replaced, hand focus to the new first card instead
  // of dropping it to the page.
  const primaryItemsKey = rails.find((rail) => rail.id === "primary")?.items
    .map((item) => item.id)
    .join(",");
  useLayoutEffect(() => {
    if (focusedRailRef.current !== "primary") return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    railsRef.current
      ?.querySelector<HTMLElement>("[data-tv-focus-default]")
      ?.focus({ preventScroll: true });
  }, [primaryItemsKey]);

  const activeItems = rails.find((rail) => rail.id === activeRail)?.items ?? rails[0]?.items ?? [];
  const selected =
    activeItems.find((work) => work.id === selectedByRail[activeRail]) ??
    activeItems[0] ??
    rails[0]?.items[0];
  // The selected card's detail page and hero art are fetched once focus has dwelt on it.
  useDwellPrefetch(selected ?? NO_WORK, Boolean(selected));
  // Details follow the remote at once; neighbours (three either side, and the cards of the rails above and
  // below) are prefetched after the focus rests, and every rail is warmed on idle time.
  const details = useFocusedDetailsController();
  const detailFocusRef = useRef<{ rail: HomeRailId; id: string } | null>(null);
  const detailRailsRef = useRef(rails);
  detailRailsRef.current = rails;
  useEffect(() => {
    details.setNear(() => {
      const at = detailFocusRef.current;
      return at ? railNeighbours(detailRailsRef.current, at.rail, at.id) : [];
    });
    details.setWarm(() => {
      const at = detailFocusRef.current;
      return at ? railsByDistance(detailRailsRef.current, at.rail, at.id) : [];
    });
    return () => details.release();
  }, [details]);
  const isLoading =
    !onDeckSettled ||
    railsState.status === "idle" ||
    railsState.status === "loading" ||
    siteState.status === "idle" ||
    siteState.status === "loading";
  const error =
    railsState.status === "error" && siteItems.length === 0 ? railsState.message : null;

  const focusByKey = useMemo(() => {
    const map = new Map<string, HomeFocus>();
    for (const rail of rails) {
      for (const work of rail.items) map.set(`home:${rail.id}:${work.id}`, { rail: rail.id, work });
    }
    return map;
  }, [rails]);
  const focusByKeyRef = useRef(focusByKey);
  focusByKeyRef.current = focusByKey;
  // Under remote keys real focus trails the marker by 320 ms: the panel and the rail glide follow the marker.
  useRemoteMarkerFollow(
    railsRef,
    (card) => {
      const focus = focusByKeyRef.current.get(card.dataset.navigationFocusKey ?? "");
      const section = card.closest<HTMLElement>(".tv-media-track");
      if (focus && section) focusFromRailRef.current(focus.rail, focus.work.id, section);
    },
    !isLoading && !error && Boolean(selected)
  );

  // Home has no back, no title and no action button (Customise Home lives in Settings).
  const homeHeader = { kind: "none" as const };

  if (isLoading && !error) {
    // The skeleton is the rail stack itself in loading mode, so it sits exactly where the loaded rails render.
    return (
      <PageLayout pageId="home" className="tv-home" ariaLabel={t("pages.home.title")} header={homeHeader}>
        <RailStack
          className="tv-home-rails"
          spacing="section"
          scrollKey="home:rails"
          ariaLabel={t("pages.home.mediaTracksAriaLabel")}
          skeleton={{ tracks: 3, cards: 10, label: t("pages.home.preparingHome") }}
        />
      </PageLayout>
    );
  }

  if (error || !selected) {
    // The header actions stay up while Home loads, fails or is empty.
    return (
      <PageLayout
        pageId="home"
        className="tv-home"
        ariaLabel={t("pages.home.title")}
        header={homeHeader}
        state={
          isLoading
            ? { kind: "loading", skeleton: "rails", label: t("pages.home.preparingHome") }
            : error
              ? { kind: "error", props: { graphic: "home", title: t("pages.home.error.title"), description: error, onRetry: () => setRailsAttempt((value) => value + 1), retryLabel: t("components.states.retry") } }
              : {
                  kind: "empty",
                  props: { graphic: "home", title: t("pages.home.empty.title"), description: t("pages.home.empty.description") },
                }
        }
      />
    );
  }

  function selectFromRail(rail: HomeRailId, id: string) {
    setActiveRail(rail);
    setSelectedByRail((current) =>
      current[rail] === id ? current : { ...current, [rail]: id }
    );
  }

  function focusFromRail(rail: HomeRailId, id: string, section: HTMLElement) {
    // Real focus trails the marker by a few hundred ms under remote keys. When it lands on a card the marker has
    // already left (a quick Down then Up), it is stale: acting on it would glide the rails and swap the panel back to
    // the old card, then forward again (the overshoot). The marker's own card is handled by its key.
    const marker = document.querySelector<HTMLElement>("[data-remote-active]");
    if (marker && marker.dataset.navigationFocusKey !== `home:${rail}:${id}`) return;
    // Real focus catching up with a card the marker already handled changes nothing.
    const followed = followedRef.current;
    if (followed && followed.rail === rail && followed.id === id) return;
    followedRef.current = { rail, id };
    const enteredNewRail = focusedRailRef.current !== rail;
    focusedRailRef.current = rail;
    detailFocusRef.current = { rail, id };
    details.focus(id);
    const remote = document.body.dataset.inputMode === "remote";
    // The left panel follows at once, from the card data (no request, no re-render of the page).
    const focus = focusByKeyRef.current.get(`home:${rail}:${id}`);
    if (focus) featureStore.set(focus);
    // Backdrop art and prefetch follow once focus rests, so a held key does not re-render the whole stage.
    pendingHomeSelectRef.current = { rail, id };
    window.clearTimeout(homeSelectTimerRef.current);
    homeSelectTimerRef.current = window.setTimeout(() => {
      const pending = pendingHomeSelectRef.current;
      if (!pending) return;
      selectFromRail(pending.rail, pending.id);
    }, remote ? REMOTE_SELECT_SETTLE_MS : 0);
    if (!enteredNewRail || isNavigationLayerRestoring()) return;

    // The rail glide starts in the key's own frame under remote keys; the stack centres pointer focus itself.
    if (remote && section.isConnected) centreTrackInStack(section);
  }

  focusFromRailRef.current = focusFromRail;

  function openResumeChooser(work: Work, plan: ResumePlan) {
    setResumeChooser({ work, plan });
  }

  async function playResumeOption(work: Work, option: ResumeOption) {
    setResumeChooser(null);
    // Report the pick so declined gaps and rewatch answers are remembered.
    void client.recordResumeChoice(work.id, option).catch(() => undefined);
    try {
      const detail = await client.getWork(work.id);
      navigate(`/player/${option.media_file_id}`, {
        state: resumePlayerState(
          option,
          work.title,
          seriesPlaylist(detail, t),
          {
            backTo: detailRoute(work),
            detailParentBackTo: "/",
            navigationOrigin: navigationLayer.origin,
          },
          t
        ),
      });
    } catch {
      navigate(detailRoute(work));
    }
  }

  return (
    <PageLayout
      pageId="home"
      className={`tv-home${homeView === "cover" ? " is-cover-view" : ""}`}
      ariaLabel={t("pages.home.title")}
      backdrop={{
        artKey: selected.id,
        art: (
          <CachedArtworkImage
            work={selected}
            kinds={["backdrop", "poster"]}
            artWidth={1920}
            alt=""
            fallback={<span>{selected.title}</span>}
          />
        ),
      }}
      header={homeHeader}
    >
      <HomeFeature
        store={featureStore}
        focusByKey={focusByKey}
        fallback={{ rail: activeRail, work: selected }}
        onDeckByWork={onDeckByWork}
      />

      <RailStack
        className="tv-home-rails"
        ref={railsRef}
        spacing="section"
        scrollKey="home:rails"
        ariaLabel={t("pages.home.mediaTracksAriaLabel")}
      >
        {rails.map((rail) => (
          <HomeRail
            key={rail.id}
            railId={rail.id}
            title={rail.title}
            items={rail.items}
            selectedId={selectedByRail[rail.id] ?? rail.items[0]?.id ?? null}
            isActive={activeRail === rail.id}
            onFocusItem={stableFocusFromRail}
            progressByWork={progressByWork}
            progressReady={watchProgress !== null}
            onDeckByWork={rail.id === "primary" ? onDeckByWork : undefined}
            stackedPlans={rail.id === "primary" ? stackedPlans : undefined}
            onOpenStack={openResumeChooser}
            onProgressChanged={handleProgressChanged}
            navigationOrigin={navigationLayer.origin}
            onNavigate={navigationLayer.captureLink}
            view={homeView}
          />
        ))}
      </RailStack>
      {resumeChooser ? (
        <ResumeChooserModal
          plan={resumeChooser.plan}
          seriesTitle={resumeChooser.work.title}
          onCancel={() => setResumeChooser(null)}
          onSelect={(option) => void playResumeOption(resumeChooser.work, option)}
        />
      ) : null}
    </PageLayout>
  );
}

/**
 * The left panel of Home: genre line, title and synopsis of the card the remote is on. It reads the focus store, so
 * a key press re-renders only this component, and it changes in place (no remount, so no blank and no replayed
 * enter animation). Everything comes from the rail data already loaded.
 */
function HomeFeature({
  store,
  focusByKey,
  fallback,
  onDeckByWork,
}: {
  store: PreviewStore<HomeFocus>;
  focusByKey: Map<string, HomeFocus>;
  fallback: HomeFocus;
  onDeckByWork: Map<string, OnDeckEntry>;
}) {
  const { t } = useLanguage();
  const stored = useSyncExternalStore(store.subscribe, store.get, store.get);
  // A stored focus from before the rails changed (a late On Deck swap) is not shown.
  const current =
    stored && focusByKey.get(`home:${stored.rail}:${stored.work.id}`) === stored ? stored : fallback;
  const work = current.work;
  const episode = current.rail === "primary" ? onDeckByWork.get(work.id)?.episode : undefined;
  const title =
    episode?.detail.episode.title ??
    (episode
      ? t("pages.home.episodeLabel", { number: episode.detail.episode.episode_number })
      : work.title);
  const overview = episode?.detail.episode.overview ?? work.overview ?? t("pages.home.noSynopsis");
  const runtime = runtimeLabel(useFocusedDetail(work.id), t);
  return (
    <DetailsPanel
      className="tv-home-feature"
      eyebrow={
        episode
          ? t("pages.home.episodeProvider", {
              title: work.title,
              season: String(episode.seasonNumber).padStart(2, "0"),
              episode: String(episode.detail.episode.episode_number).padStart(2, "0"),
            })
          : t("pages.home.kindGenre", {
              kind: workKindLabel(work, t),
              genre: work.genres[0] ?? t("pages.home.defaultGenre"),
            })
      }
      title={title}
      meta={runtime !== null ? <span data-detail-field="runtime">{runtime}</span> : undefined}
      overview={overview}
    />
  );
}

function HomeRailArtwork({
  work,
  mediaFileId,
  title,
  children,
  view,
}: {
  work: Work;
  mediaFileId?: string | null;
  title: string;
  children: ReactNode;
  view: HomeViewPreference;
}) {
  const kinds =
    view === "cover"
      ? (["poster", "backdrop"] as const)
      : (["backdrop", "poster"] as const);
  // Only a thumbnail card needs the work art as its fallback; every other card loads its art lazily
  // (near the viewport) through `CachedArtworkImage`. Loading it for every mounted card fetched the
  // art of every title in every rail up front.
  const fallback = useCachedArtwork(work, kinds, Boolean(mediaFileId && view === "thumbnail")).url;
  if (mediaFileId && view === "thumbnail") {
    return (
      <MediaThumbnailArtwork
        mediaFileId={mediaFileId}
        fallback={fallback}
        className="tv-home-card-art"
        intersectionRootSelector=".tv-media-track-scroll"
      >
        {!fallback ? <span>{title}</span> : null}
        {children}
      </MediaThumbnailArtwork>
    );
  }

  return (
    <span className="tv-home-card-art">
      <CachedArtworkImage
        work={work}
        kinds={kinds}
        alt=""
        loading="lazy"
        fallback={<span>{title}</span>}
      />
      {children}
    </span>
  );
}

const HomeRail = memo(function HomeRail({
  railId,
  title,
  items,
  selectedId,
  isActive,
  onFocusItem,
  progressByWork = new Map(),
  progressReady,
  onDeckByWork = new Map(),
  stackedPlans = new Map(),
  onOpenStack,
  onProgressChanged,
  navigationOrigin,
  onNavigate,
  view,
}: {
  railId: HomeRailId;
  title: string;
  items: Work[];
  selectedId: string | null;
  isActive: boolean;
  onFocusItem: (
    rail: HomeRailId,
    id: string,
    section: HTMLElement
  ) => void;
  progressByWork?: Map<string, WatchProgress>;
  progressReady: boolean;
  onDeckByWork?: Map<string, OnDeckEntry>;
  stackedPlans?: Map<string, ResumePlan>;
  onOpenStack: (work: Work, plan: ResumePlan) => void;
  onProgressChanged: (workId: string, progress: WatchProgress[]) => void;
  navigationOrigin: ReturnType<typeof useNavigationLayer>["origin"];
  onNavigate: ReturnType<typeof useNavigationLayer>["captureLink"];
  view: HomeViewPreference;
}) {
  const mediaContext = useMediaContextMenu({ onProgressChanged });
  const { t } = useLanguage();

  return (
    <TvMediaTrack
      title={title}
      active={isActive}
      ariaLabel={title}
      scrollKey={`home:rail:${railId}`}
      itemsKey={items.map((item) => item.id).join(":")}
      dataTrackId={railId}
      overlay={mediaContext.contextMenu}
    >
      {items.map((work) => {
            const onDeckEntry = onDeckByWork.get(work.id);
            const episode = onDeckEntry?.episode;
            const mediaFileId =
              episode?.detail.media_file_id ??
              (work.kind === "artist"
                ? onDeckEntry?.progress?.media_file_id
                : undefined);
            const progress = onDeckEntry?.progress ?? progressByWork.get(work.id);
            const stackedPlan = stackedPlans.get(work.id);
            const title =
              episode?.detail.episode.title ??
              (episode
                ? t("pages.home.episodeLabel", { number: episode.detail.episode.episode_number })
                : work.title);
            const subtitle = episode
              ? t("pages.home.episodeProvider", {
                  title: work.title,
                  season: String(episode.seasonNumber).padStart(2, "0"),
                  episode: String(episode.detail.episode.episode_number).padStart(2, "0"),
                })
              : labelWithYear(workKindLabel(work, t), work);
            return (
              <Link
                key={work.id}
                to={detailRoute(work)}
                state={{
                  backTo: "/",
                  episodeId: episode?.detail.episode.id,
                  mediaFileId,
                  navigationOrigin,
                }}
                className={`media-card tv-home-card${
                  isActive && work.id === selectedId ? " is-selected" : ""
                }${stackedPlan ? " is-stacked" : ""}`}
                data-resume-stack={stackedPlan ? stackedPlan.options.length : undefined}
                data-tv-focus-default={
                  railId === "primary" && work.id === items[0]?.id ? true : undefined
                }
                data-navigation-focus-key={`home:${railId}:${work.id}`}
                onClick={(event) => {
                  if (stackedPlan) {
                    // Several ways to continue: ask here instead of opening the series.
                    event.preventDefault();
                    onOpenStack(work, stackedPlan);
                    return;
                  }
                  onNavigate(event);
                }}
                onFocus={(event) => {
                  const section = event.currentTarget.closest<HTMLElement>(
                    ".tv-media-track"
                  );
                  if (section) onFocusItem(railId, work.id, section);
                }}
                {...mediaContext.itemProps({
                  work,
                  detailRoute: detailRoute(work),
                  parentRoute: "/",
                  progress: progress ?? undefined,
                  preferredMediaFileId: mediaFileId,
                  preferredEpisodeId: episode?.detail.episode.id,
                })}
              >
                <HomeRailArtwork
                  work={work}
                  mediaFileId={mediaFileId}
                  title={title}
                  view={view}
                >
                  <WatchStateOverlay
                    progress={progress ?? undefined}
                    showUnwatched={progressReady && !stackedPlan}
                  />
                  {stackedPlan ? (
                    <i className="tv-home-card-stack-badge">
                      {t("pages.home.resumeOptions", { count: stackedPlan.options.length })}
                    </i>
                  ) : null}
                </HomeRailArtwork>
                <strong>{title}</strong>
                <small>{subtitle}</small>
              </Link>
            );
      })}
    </TvMediaTrack>
  );
});
