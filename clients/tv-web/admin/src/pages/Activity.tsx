import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  describeApiError,
  type ActivityActiveResponse,
  type ActivityActiveSessionView,
  type ActivityFacetsResponse,
  type ActivityHistoryResponse,
  type ActivitySessionHistoryView,
  type UnavailableActivityNode,
  type PeerNode,
  type PlayMethod,
  type StopReason,
  type UserResponse,
} from "@playarr-tv/api-client";
import {
  ActivityFiltersPanel,
  type ActivityFilterOptions,
} from "../components/ActivityFilters";
import {
  mergeSearchableMultiSelectOptions,
  type SearchableMultiSelectOption,
} from "../components/SearchableMultiSelect";
import { useApiClient } from "../lib/ApiClientProvider";
import {
  activeActivityFilterCount,
  activityFiltersEqual,
  activityFiltersKey,
  emptyActivityFilters,
  matchesLiveActivityFilters,
  parseActivityFilters,
  serialiseActivityFilters,
  toActivityHistoryRequest,
  validateActivityFilters,
  type ActivityFilters,
} from "../lib/activityFilters";
import {
  appendActivityHistoryPage,
  activityHistoryRequiresRestart,
  activityHistoryRowKey,
  createActivityHistoryPage,
  createActivityRequestGate,
  filterUnavailableActivityNodes,
  mergeUnavailableActivityNodes,
  toContinuationActivityHistoryRequest,
  type ActivityHistoryPageState,
} from "../lib/activityPageState";
import { useDocumentTitle } from "../lib/useDocumentTitle";

/** How often to silently refresh the live peer-group view. */
const POLL_INTERVAL_MS = 5000;
const HISTORY_PAGE_SIZE = 100;

function playMethodBadgeClass(method: PlayMethod): string {
  switch (method) {
    case "direct_play":
    case "direct_stream":
      return "badge badge-success badge-pill";
    case "transcode":
      return "badge badge-queue badge-pill";
    default:
      return "badge badge-neutral badge-pill";
  }
}

function playMethodLabel(method: PlayMethod): string {
  switch (method) {
    case "direct_play":
      return "Direct play";
    case "direct_stream":
      return "Direct stream";
    case "transcode":
      return "Transcode";
    default:
      return method;
  }
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "--";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "--" : date.toLocaleString();
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** exponent;
  return `${exponent === 0 ? value : value.toFixed(1)} ${units[exponent]}`;
}

function formatStopReason(reason: StopReason | null | undefined): string {
  if (!reason) return "In progress";
  if (typeof reason === "string") {
    return reason
      .replace(/_/g, " ")
      .replace(/^./, (first) => first.toLocaleUpperCase());
  }
  return reason.other;
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "--";
  if (ms < 1000) return ms === 0 ? "0s" : "<1s";
  const totalSeconds = Math.round(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [
    days > 0 ? `${days}d` : "",
    hours > 0 ? `${hours}h` : "",
    minutes > 0 ? `${minutes}m` : "",
    seconds > 0 ? `${seconds}s` : "",
  ].filter(Boolean);
  return parts.slice(0, 2).join(" ") || "0s";
}

type LinkedSessionContext = Pick<
  ActivityActiveSessionView,
  | "user_id"
  | "user_display_name"
  | "media_file_id"
  | "work_id"
  | "media_title"
  | "peer_node_is_self"
>;

function UserLink({ session }: { session: LinkedSessionContext }) {
  return (
    <Link className="activity-link" to={`/users/${session.user_id}`}>
      {session.user_display_name ?? session.user_id}
    </Link>
  );
}

export function ActivityMediaLink({
  session,
}: {
  session: LinkedSessionContext;
}) {
  const label = session.media_title ?? session.media_file_id;
  const href = activityMediaHref(session);
  return href ? (
    <Link className="activity-link" to={href}>
      {label}
    </Link>
  ) : (
    <span>{label}</span>
  );
}

export function activityMediaHref(
  session: Pick<LinkedSessionContext, "peer_node_is_self" | "work_id">
): string | undefined {
  return session.peer_node_is_self && session.work_id
    ? `/library/${session.work_id}`
    : undefined;
}

function ConnectedServerCell({
  session,
}: {
  session: Pick<
    ActivityActiveSessionView,
    "peer_node_id" | "peer_node_name" | "peer_node_is_self"
  >;
}) {
  return (
    <span className="activity-server">
      <span>{session.peer_node_name || session.peer_node_id}</span>
      {session.peer_node_is_self && (
        <span className="badge badge-neutral badge-pill">This server</span>
      )}
    </span>
  );
}

function PartialResultsWarning({
  unavailableNodes,
}: {
  unavailableNodes: UnavailableActivityNode[];
}) {
  if (unavailableNodes.length === 0) return null;
  return (
    <div className="activity-partial-warning" role="status">
      <strong>
        Results are partial:{" "}
        {unavailableNodes.length === 1
          ? "one connected server is unavailable."
          : `${unavailableNodes.length} connected servers are unavailable.`}
      </strong>
      <ul>
        {unavailableNodes.map((node) => (
          <li key={node.peer_node_id}>
            {node.peer_node_name || node.peer_node_id}
            {node.error ? ` — ${node.error}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LiveSessionsSection({
  sessions,
  unavailableNodes,
  error,
  refreshing,
  onRefresh,
}: {
  sessions: ActivityActiveSessionView[] | null;
  unavailableNodes: UnavailableActivityNode[];
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className="activity-section" aria-labelledby="activity-live-title">
      <div className="activity-section-heading">
        <div>
          <h2 id="activity-live-title">Live sessions</h2>
          <p className="muted">Current sessions across connected servers.</p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={refreshing}
          onClick={onRefresh}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="error-text activity-message" role="alert">
          {error}
        </p>
      )}
      <PartialResultsWarning unavailableNodes={unavailableNodes} />

      {sessions === null && !error && (
        <p className="muted activity-message" role="status">
          Loading live sessions...
        </p>
      )}
      {sessions !== null && sessions.length === 0 && (
        <p className="muted activity-message">
          No live sessions match the applied filters.
        </p>
      )}
      {sessions !== null && sessions.length > 0 && (
        <div
          className="activity-table-scroll"
          data-tv-scroll-container
          data-tv-scroll-axis="horizontal"
          data-navigation-scroll-key="admin-activity-live"
        >
          <table className="table activity-table">
            <thead>
              <tr>
                <th>Connected server</th>
                <th>User</th>
                <th>Device / platform</th>
                <th>Title</th>
                <th>Library</th>
                <th>Method</th>
                <th>Started</th>
                <th>Length</th>
                <th>Buffering</th>
                <th>Bytes streamed</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={`${session.peer_node_id}:${session.session_id}`}>
                  <td>
                    <ConnectedServerCell session={session} />
                  </td>
                  <td>
                    <UserLink session={session} />
                  </td>
                  <td className="muted">{session.client_platform}</td>
                  <td>
                    <ActivityMediaLink session={session} />
                  </td>
                  <td>{session.library_name ?? "--"}</td>
                  <td>
                    <span className={playMethodBadgeClass(session.play_method)}>
                      {playMethodLabel(session.play_method)}
                    </span>
                    <small className="activity-method-detail muted">
                      {session.target_codec} / {session.target_container}
                    </small>
                  </td>
                  <td className="muted">
                    {formatTimestamp(session.started_at)}
                  </td>
                  <td className="muted">
                    {formatDurationMs(session.duration_ms)}
                  </td>
                  <td className="muted">
                    {session.buffering_events > 0
                      ? `${session.buffering_events} (${formatDurationMs(
                          session.buffering_ms_total
                        )})`
                      : "--"}
                  </td>
                  <td className="muted">
                    {formatBytes(session.bytes_streamed)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SessionHistorySection({
  sessions,
  unavailableNodes,
  error,
  notice,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
}: {
  sessions: ActivitySessionHistoryView[] | null;
  unavailableNodes: UnavailableActivityNode[];
  error: string | null;
  notice: string | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <section
      className="activity-section"
      aria-labelledby="activity-history-title"
    >
      <div className="activity-section-heading">
        <div>
          <h2 id="activity-history-title">History</h2>
          <p className="muted">Completed and in-progress session records.</p>
        </div>
      </div>

      {notice && (
        <p className="activity-message muted" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error-text activity-message" role="alert">
          {error}
        </p>
      )}
      <PartialResultsWarning unavailableNodes={unavailableNodes} />

      {loading && sessions === null && (
        <p className="muted activity-message" role="status">
          Loading session history...
        </p>
      )}
      {!loading && sessions !== null && sessions.length === 0 && (
        <p className="muted activity-message">
          No sessions match the applied filters.
        </p>
      )}
      {sessions !== null && sessions.length > 0 && (
        <>
          <div
            className="activity-table-scroll"
            data-tv-scroll-container
            data-tv-scroll-axis="horizontal"
            data-navigation-scroll-key="admin-activity-history"
          >
            <table className="table activity-table">
              <thead>
                <tr>
                  <th>Connected server</th>
                  <th>User</th>
                  <th>Title</th>
                  <th>Library</th>
                  <th>Method</th>
                  <th>Started</th>
                  <th>Ended</th>
                  <th>Length</th>
                  <th>Stop reason</th>
                  <th>Bytes streamed</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={activityHistoryRowKey(session)}>
                    <td>
                      <ConnectedServerCell session={session} />
                    </td>
                    <td>
                      <UserLink session={session} />
                    </td>
                    <td>
                      <ActivityMediaLink session={session} />
                    </td>
                    <td>{session.library_name ?? "--"}</td>
                    <td>
                      <span
                        className={playMethodBadgeClass(session.play_method)}
                      >
                        {playMethodLabel(session.play_method)}
                      </span>
                    </td>
                    <td className="muted">
                      {formatTimestamp(session.started_at)}
                    </td>
                    <td className="muted">
                      {formatTimestamp(session.ended_at)}
                    </td>
                    <td className="muted">
                      {formatDurationMs(session.duration_ms)}
                    </td>
                    <td className="muted">
                      {formatStopReason(session.stop_reason)}
                    </td>
                    <td className="muted">
                      {formatBytes(session.bytes_streamed)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <div className="activity-load-more">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loadingMore}
                onClick={onLoadMore}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function userOptions(users: UserResponse[]): SearchableMultiSelectOption[] {
  return users.map((user) => ({
    value: user.id,
    label: user.display_name || user.username,
    description:
      user.display_name && user.username !== user.display_name
        ? user.username
        : undefined,
  }));
}

export function peerNodeOptions(
  nodes: PeerNode[]
): SearchableMultiSelectOption[] {
  return nodes.filter((node) => node.status !== "left").map((node) => ({
    value: node.id,
    label: node.name,
    description: node.is_self ? "This server" : node.status,
  }));
}

function sessionFacetOptions(
  sessions: Array<ActivityActiveSessionView | ActivitySessionHistoryView>
): Pick<ActivityFilterOptions, "users" | "libraries" | "peerNodes"> {
  return {
    users: sessions.map((session) => ({
      value: session.user_id,
      label: session.user_display_name ?? session.user_id,
    })),
    libraries: sessions.flatMap((session) =>
      session.library_id
        ? [
            {
              value: session.library_id,
              label: session.library_name ?? session.library_id,
            },
          ]
        : []
    ),
    peerNodes: sessions.map((session) => ({
      value: session.peer_node_id,
      label: session.peer_node_name || session.peer_node_id,
      description: session.peer_node_is_self ? "This server" : undefined,
    })),
  };
}

export function retainSearchableOptions(
  current: SearchableMultiSelectOption[],
  incoming: SearchableMultiSelectOption[]
): SearchableMultiSelectOption[] {
  const merged = mergeSearchableMultiSelectOptions(current, incoming);
  const unchanged =
    merged.length === current.length &&
    merged.every(
      (option, index) =>
        option.value === current[index]?.value &&
        option.label === current[index]?.label &&
        option.description === current[index]?.description
    );
  return unchanged ? current : merged;
}

export function ActivityPage() {
  useDocumentTitle("Activity");

  const client = useApiClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const appliedFilters = useMemo(
    () => parseActivityFilters(new URLSearchParams(searchParamsKey)),
    [searchParamsKey]
  );
  const appliedKey = activityFiltersKey(appliedFilters);
  const [draftFilters, setDraftFilters] =
    useState<ActivityFilters>(appliedFilters);
  const [historyRevision, setHistoryRevision] = useState(0);

  const [liveSessions, setLiveSessions] = useState<
    ActivityActiveSessionView[] | null
  >(null);
  const [liveUnavailableNodes, setLiveUnavailableNodes] = useState<
    UnavailableActivityNode[]
  >([]);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveRefreshing, setLiveRefreshing] = useState(false);
  const liveRequestGeneration = useRef(0);
  const liveRequestInFlight = useRef(false);

  const [historyPage, setHistoryPage] =
    useState<ActivityHistoryPageState | null>(null);
  const [historyCarryWarnings, setHistoryCarryWarnings] = useState<
    UnavailableActivityNode[]
  >([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyRequestGate] = useState(createActivityRequestGate);
  const historyConsistencyRestart = useRef(false);

  const [knownUsers, setKnownUsers] = useState<UserResponse[]>([]);
  const [knownPeerNodes, setKnownPeerNodes] = useState<PeerNode[]>([]);
  const [knownLibraries, setKnownLibraries] = useState<
    SearchableMultiSelectOption[]
  >([]);
  const [facetLoadingError, setFacetLoadingError] = useState<string | null>(
    null
  );

  useEffect(() => {
    setDraftFilters(appliedFilters);
    // The canonical key is deliberately the dependency: unrelated URL state
    // must not discard an in-progress draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedKey]);

  const refreshLive = useCallback(() => {
    if (liveRequestInFlight.current) return;
    liveRequestInFlight.current = true;
    const generation = ++liveRequestGeneration.current;
    setLiveRefreshing(true);
    client
      .groupActiveSessions()
      .then((response: ActivityActiveResponse) => {
        if (liveRequestGeneration.current !== generation) return;
        setLiveSessions(response.sessions);
        setLiveUnavailableNodes(response.unavailable_nodes);
        setLiveError(null);
      })
      .catch((error: unknown) => {
        if (liveRequestGeneration.current === generation) {
          setLiveError(describeApiError(error));
        }
      })
      .finally(() => {
        if (liveRequestGeneration.current === generation) {
          liveRequestInFlight.current = false;
          setLiveRefreshing(false);
        }
      });
  }, [client]);

  useEffect(() => {
    refreshLive();
    const interval = window.setInterval(refreshLive, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      liveRequestGeneration.current += 1;
      liveRequestInFlight.current = false;
    };
  }, [refreshLive]);

  useEffect(() => {
    const restartingForConsistency = historyConsistencyRestart.current;
    historyConsistencyRestart.current = false;
    const generation = historyRequestGate.begin();
    setHistoryPage(null);
    if (!restartingForConsistency) {
      setHistoryCarryWarnings([]);
      setHistoryNotice(null);
    }
    setHistoryError(null);
    setHistoryHasMore(false);
    setHistoryLoading(true);
    setHistoryLoadingMore(false);

    client
      .searchGroupSessionHistory(
        toActivityHistoryRequest(appliedFilters, {
          limit: HISTORY_PAGE_SIZE,
        })
      )
      .then((response: ActivityHistoryResponse) => {
        if (!historyRequestGate.isCurrent(generation)) return;
        setHistoryPage(createActivityHistoryPage(response));
        setHistoryCarryWarnings([]);
        if (restartingForConsistency) {
          setHistoryNotice(
            "History restarted with a consistent pagination continuation."
          );
        }
        setHistoryHasMore(Boolean(response.next_cursor));
      })
      .catch((error: unknown) => {
        if (historyRequestGate.isCurrent(generation)) {
          setHistoryError(describeApiError(error));
        }
      })
      .finally(() => {
        if (historyRequestGate.isCurrent(generation)) {
          setHistoryLoading(false);
        }
      });

    return () => {
      historyRequestGate.invalidate();
    };
    // The key makes array facet order irrelevant. The revision deliberately
    // refreshes page zero when Apply is pressed without changing the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, appliedKey, historyRequestGate, historyRevision]);

  useEffect(() => {
    let current = true;
    Promise.allSettled([
      client.listUsers(),
      client.listPeerNodes(),
      client.getActivityFacets(),
    ]).then(([usersResult, nodesResult, facetsResult]) => {
      if (!current) return;
      const errors: string[] = [];
      if (usersResult.status === "fulfilled") {
        setKnownUsers(usersResult.value);
      } else {
        errors.push(describeApiError(usersResult.reason));
      }
      if (nodesResult.status === "fulfilled") {
        setKnownPeerNodes(nodesResult.value);
      } else {
        errors.push(describeApiError(nodesResult.reason));
      }
      if (facetsResult.status === "fulfilled") {
        const response: ActivityFacetsResponse = facetsResult.value;
        const completeLibraries = response.libraries.map((library) => ({
          value: library.id,
          label: library.name,
        }));
        setKnownLibraries((retained) =>
          retainSearchableOptions(completeLibraries, retained)
        );
      } else {
        errors.push(describeApiError(facetsResult.reason));
      }
      setFacetLoadingError(
        errors.length > 0
          ? "Some filter labels could not be loaded. Activity results are still available."
          : null
      );
    });
    return () => {
      current = false;
    };
  }, [client]);

  const loadTitleOptions = useCallback(
    async (query: string): Promise<SearchableMultiSelectOption[]> => {
      const works = await client.searchCatalog(query, 25);
      return mergeSearchableMultiSelectOptions(
        works.map((work) => ({
          value: work.title,
          label: work.title,
          description: work.kind.replace(/_/g, " "),
        }))
      );
    },
    [client]
  );

  const historySessions = historyPage?.sessions ?? null;
  const historyUnavailableNodes = useMemo(
    () =>
      mergeUnavailableActivityNodes(
        historyCarryWarnings,
        historyPage?.unavailableNodes ?? []
      ),
    [historyCarryWarnings, historyPage]
  );
  const allSessions = useMemo(
    () => [...(liveSessions ?? []), ...(historySessions ?? [])],
    [historySessions, liveSessions]
  );
  const resultOptions = useMemo(
    () => sessionFacetOptions(allSessions),
    [allSessions]
  );
  useEffect(() => {
    setKnownLibraries((current) =>
      retainSearchableOptions(current, resultOptions.libraries)
    );
  }, [resultOptions.libraries]);
  const filterOptions = useMemo<ActivityFilterOptions>(
    () => ({
      users: mergeSearchableMultiSelectOptions(
        userOptions(knownUsers),
        resultOptions.users
      ),
      libraries: mergeSearchableMultiSelectOptions(
        knownLibraries,
        resultOptions.libraries
      ),
      peerNodes: mergeSearchableMultiSelectOptions(
        peerNodeOptions(knownPeerNodes),
        resultOptions.peerNodes
      ),
    }),
    [knownLibraries, knownPeerNodes, knownUsers, resultOptions]
  );

  const filteredLiveSessions = useMemo(
    () =>
      liveSessions?.filter((session) =>
        matchesLiveActivityFilters(session, appliedFilters)
      ) ?? null,
    [appliedKey, liveSessions]
  );
  const filteredLiveUnavailableNodes = useMemo(
    () =>
      filterUnavailableActivityNodes(
        liveUnavailableNodes,
        appliedFilters.peerNodeIds
      ),
    [appliedKey, liveUnavailableNodes]
  );
  const filterErrors = validateActivityFilters(draftFilters);
  const filtersDirty = !activityFiltersEqual(draftFilters, appliedFilters);
  const appliedFilterCount = activeActivityFilterCount(appliedFilters);

  function applyFilters() {
    historyConsistencyRestart.current = false;
    setHistoryCarryWarnings([]);
    setHistoryNotice(null);
    setSearchParams(serialiseActivityFilters(draftFilters, searchParams), {
      replace: true,
    });
    setHistoryRevision((revision) => revision + 1);
  }

  function resetFilters() {
    const emptyFilters = emptyActivityFilters();
    historyConsistencyRestart.current = false;
    setHistoryCarryWarnings([]);
    setHistoryNotice(null);
    setDraftFilters(emptyFilters);
    setSearchParams(serialiseActivityFilters(emptyFilters, searchParams), {
      replace: true,
    });
    setHistoryRevision((revision) => revision + 1);
  }

  function loadMoreHistory() {
    if (
      historyLoading ||
      historyLoadingMore ||
      !historyHasMore ||
      historyPage === null ||
      historyPage.nextCursor === null
    ) {
      return;
    }
    const generation = historyRequestGate.begin();
    setHistoryLoadingMore(true);
    setHistoryError(null);
    client
      .searchGroupSessionHistory(
        toContinuationActivityHistoryRequest(
          appliedFilters,
          historyPage.nextCursor,
          HISTORY_PAGE_SIZE
        )
      )
      .then((response: ActivityHistoryResponse) => {
        if (!historyRequestGate.isCurrent(generation)) return;
        const mergedPage = appendActivityHistoryPage(historyPage, response);
        if (mergedPage.availabilityChanged || mergedPage.snapshotChanged) {
          setHistoryCarryWarnings(mergedPage.unavailableNodes);
          const reason = mergedPage.snapshotChanged
            ? "pagination continuation"
            : "connected-server availability";
          setHistoryNotice(
            `The ${reason} changed while loading more. ` +
              "Restarting history from page one..."
          );
          setHistoryHasMore(false);
          historyConsistencyRestart.current = true;
          setHistoryRevision((revision) => revision + 1);
          return;
        }
        setHistoryPage(mergedPage);
        setHistoryHasMore(Boolean(response.next_cursor));
      })
      .catch((error: unknown) => {
        if (historyRequestGate.isCurrent(generation)) {
          if (activityHistoryRequiresRestart(error)) {
            setHistoryCarryWarnings(historyPage.unavailableNodes);
            setHistoryNotice(
              "Connected-server membership or availability changed while loading more. " +
                "Restarting history from page one..."
            );
            setHistoryHasMore(false);
            historyConsistencyRestart.current = true;
            setHistoryRevision((revision) => revision + 1);
            return;
          }
          setHistoryError(describeApiError(error));
        }
      })
      .finally(() => {
        if (historyRequestGate.isCurrent(generation)) {
          setHistoryLoadingMore(false);
        }
      });
  }

  return (
    <div className="page activity-page">
      <h1 className="page-title">Activity</h1>
      <p className="muted activity-intro">
        Live and historical Playarr playback sessions across connected
        servers.
      </p>

      <ActivityFiltersPanel
        filters={draftFilters}
        errors={filterErrors}
        options={filterOptions}
        loading={historyLoading}
        dirty={filtersDirty}
        appliedFilterCount={appliedFilterCount}
        onChange={setDraftFilters}
        onApply={applyFilters}
        onReset={resetFilters}
        loadTitleOptions={loadTitleOptions}
      />
      {facetLoadingError && (
        <p className="activity-filter-label-warning muted" role="status">
          {facetLoadingError}
        </p>
      )}

      <LiveSessionsSection
        sessions={filteredLiveSessions}
        unavailableNodes={filteredLiveUnavailableNodes}
        error={liveError}
        refreshing={liveRefreshing}
        onRefresh={refreshLive}
      />
      <SessionHistorySection
        sessions={historySessions}
        unavailableNodes={historyUnavailableNodes}
        error={historyError}
        notice={historyNotice}
        loading={historyLoading}
        loadingMore={historyLoadingMore}
        hasMore={historyHasMore}
        onLoadMore={loadMoreHistory}
      />
    </div>
  );
}
