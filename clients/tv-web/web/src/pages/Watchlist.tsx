import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  describeApiError,
  type TitleAction,
  type WatchlistEntry,
} from "@playarr-tv/api-client";
import { RequestButton } from "../components/RequestButton";
import { EmptyState, ErrorState, PageLayout, ScrollArea, SkeletonState } from "../components/shell";
import { TvRailSurface } from "../components/tv/TvStage";
import { useApiClient } from "../lib/ApiClientProvider";
import { useLiveRevision } from "../lib/liveEvents";
import {
  actionLabelKey,
  discoveryUnsupportedByServer,
  explainedDisabledActions,
  libraryDetailRoute,
  playerTargetFor,
  primaryAction,
  sourceChipKey,
  uniqueSourceKinds,
} from "../lib/discovery";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import { useNavigationLayer } from "../lib/navigationLayer";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { loadWatchlist, peekWatchlist } from "../lib/watchlistData";

type State =
  | { status: "loading" }
  | { status: "ready"; items: WatchlistEntry[] }
  | { status: "error"; message: string };

export function WatchlistPage() {
  const { t } = useLanguage();
  useDocumentTitle(t("pages.watchlist.title"));
  const client = useApiClient();
  // Stale-while-revalidate on the first render: a watchlist the cache holds (warmed from the nav) paints at once.
  const [state, setState] = useState<State>(() => {
    const stored = peekWatchlist(client);
    return stored ? { status: "ready", items: stored } : { status: "loading" };
  });
  const [removeError, setRemoveError] = useState<string | null>(null);
  // Back from an opened title or the player lands on the same row (audit A19).
  const navigationLayer = useNavigationLayer(
    state.status === "ready" ? `watchlist:${state.items.length}` : state.status,
    true,
    state.status === "ready"
  );
  const [attempt, setAttempt] = useState(0);

  const liveRevision = useLiveRevision({ areas: ["watchlist"] });
  useEffect(() => {
    let cancelled = false;
    void loadWatchlist(client)
      .then((items) => {
        if (cancelled) return;
        // Revalidating a copy painted from the cache keeps that copy when nothing changed.
        setState((current) =>
          current.status === "ready" && JSON.stringify(current.items) === JSON.stringify(items)
            ? current
            : { status: "ready", items }
        );
      })
      .catch((error: unknown) => {
        if (!cancelled && liveRevision === 0) {
          // A failed revalidation keeps a copy that is already on screen.
          setState((current) =>
            current.status === "ready"
              ? current
              : {
                  status: "error",
                  message: discoveryUnsupportedByServer(error)
                    ? t("discovery.serverUnsupported")
                    : describeApiError(error),
                }
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, t, liveRevision, attempt]);

  const remove = useCallback(
    async (entry: WatchlistEntry) => {
      setRemoveError(null);
      try {
        await client.removeFromWatchlist(entry.title.title_key);
        setState((current) =>
          current.status === "ready"
            ? {
                status: "ready",
                items: current.items.filter(
                  (item) => item.title.title_key !== entry.title.title_key
                ),
              }
            : current
        );
      } catch (error) {
        setRemoveError(describeApiError(error));
      }
    },
    [client]
  );

  return (
    <PageLayout
      pageId="watchlist"
      className="tv-library tv-downloads tv-watchlist"
      ariaLabel={t("pages.watchlist.title")}
      header={{ title: t("pages.watchlist.title"), back: { label: t("pages.watchlist.backToHome"), to: "/" } }}
    >
      <TvRailSurface
        className="tv-rail-panel tv-library-grid-panel tv-downloads-panel"
        mode="content"
        ariaLabel={t("pages.watchlist.title")}
      >
        <ScrollArea
          axis="vertical"
          scrollKey="watchlist:list"
          className="tv-downloads-content"
          refreshKey={state.status === "ready" ? state.items.length : state.status}
        >
          {state.status === "loading" ? (
            <SkeletonState kind="rows" label={t("pages.watchlist.loading")} />
          ) : state.status === "error" ? (
            <ErrorState
              graphic="details"
              title={t("pages.watchlist.errorTitle")}
              description={state.message}
              onRetry={() => {
                setState({ status: "loading" });
                setAttempt((value) => value + 1);
              }}
              retryLabel={t("components.states.retry")}
            />
          ) : state.items.length === 0 ? (
            <EmptyState
              graphic="details"
              title={t("pages.watchlist.emptyTitle")}
              description={t("pages.watchlist.emptyDescription")}
            />
          ) : (
            <ul className="tv-watchlist-list">
              {state.items.map((entry, index) => (
                <WatchlistRow
                  key={entry.title.title_key}
                  entry={entry}
                  onRemove={remove}
                  layer={navigationLayer}
                  isFirst={index === 0}
                />
              ))}
            </ul>
          )}
          {removeError ? (
            <p className="tv-watchlist-error" role="alert">
              {removeError}
            </p>
          ) : null}
        </ScrollArea>
      </TvRailSurface>
    </PageLayout>
  );
}

function actionLabel(action: TitleAction, t: ReturnType<typeof useLanguage>["t"]): string {
  return t(actionLabelKey(action.action));
}

export function WatchlistRow({
  entry,
  onRemove,
  layer,
  isFirst = true,
}: {
  entry: WatchlistEntry;
  onRemove: (entry: WatchlistEntry) => void;
  layer?: Pick<ReturnType<typeof useNavigationLayer>, "origin" | "captureLink">;
  /** Only the first row marks its primary action as the page's default focus (audit B15). */
  isFirst?: boolean;
}) {
  const { t } = useLanguage();
  const { title, actions } = entry;
  const primary = primaryAction(actions);
  const target = primary ? playerTargetFor(primary) : null;
  const detail = libraryDetailRoute(title);
  const explained = explainedDisabledActions(actions);
  const key = title.title_key;
  return (
    <li className="media-card media-card-row tv-download-row tv-watchlist-row" data-navigation-focus-key={`watchlist:${key}`}>
      <div className="tv-download-row-copy">
        {detail ? (
          <Link
            to={detail}
            state={layer ? { navigationOrigin: layer.origin } : undefined}
            onClick={layer?.captureLink}
            data-navigation-focus-key={`watchlist:${key}:open`}
          >
            <strong>{title.title}</strong>
          </Link>
        ) : (
          <strong>{title.title}</strong>
        )}
        <span className="tv-download-row-meta">
          {title.year ? <span>{title.year}</span> : null}
          {uniqueSourceKinds(title.sources).map((kind) => (
            <span key={kind}>{t(sourceChipKey(kind))}</span>
          ))}
        </span>
        {explained.map((action) => (
          <small key={action.action} className="tv-watchlist-reason">
            {actionLabel(action, t)}: {action.reason}
          </small>
        ))}
      </div>
      <div className="tv-download-row-actions">
        {primary && target ? (
          <Link
            to={target}
            state={{
              title: title.title,
              backTo: "/watchlist",
              mediaFileId: primary.media_file_id,
              ...(layer ? { navigationOrigin: layer.origin } : {}),
            }}
            onClick={layer?.captureLink}
            className="tv-watchlist-primary"
            data-tv-focus-default={isFirst ? true : undefined}
            data-navigation-focus-key={`watchlist:${key}:primary`}
          >
            {actionLabel(primary, t)}
          </Link>
        ) : primary?.action === "request" ? (
          <RequestButton
            snapshot={{
              kind: title.kind,
              title: title.title,
              year: title.year ?? null,
              work_id: null,
              external_refs: title.external_refs,
              poster_url: title.poster_url ?? null,
            }}
            focusKey={`watchlist:${key}:primary`}
          />
        ) : null}
        <button
          type="button"
          data-navigation-focus-key={`watchlist:${key}:remove`}
          onClick={() => onRemove(entry)}
        >
          {t("discovery.watchlist.remove")}
        </button>
      </div>
    </li>
  );
}
