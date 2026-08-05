import type {
  ActivityHistoryRequest,
  ActivityStopReasonFilter,
  PlayMethod,
} from "@playarr-tv/api-client";

export const PLAY_METHOD_FILTER_OPTIONS: ReadonlyArray<{
  value: PlayMethod;
  label: string;
}> = [
  { value: "direct_play", label: "Direct play" },
  { value: "direct_stream", label: "Direct stream" },
  { value: "transcode", label: "Transcode" },
];

export const STOP_REASON_FILTER_OPTIONS: ReadonlyArray<{
  value: ActivityStopReasonFilter;
  label: string;
}> = [
  { value: "completed", label: "Completed" },
  { value: "user_stopped", label: "User stopped" },
  { value: "error", label: "Error" },
  { value: "device_disconnected", label: "Device disconnected" },
  { value: "session_revoked", label: "Session revoked" },
  { value: "concurrent_limit_exceeded", label: "Concurrent limit exceeded" },
  { value: "idle_timeout", label: "Idle timeout" },
  { value: "other", label: "Other" },
  { value: "in_progress", label: "In progress" },
];

const PLAY_METHODS = new Set<string>(
  PLAY_METHOD_FILTER_OPTIONS.map((option) => option.value)
);
const STOP_REASONS = new Set<string>(
  STOP_REASON_FILTER_OPTIONS.map((option) => option.value)
);

const FILTER_QUERY_KEYS = [
  "user_id",
  "play_method",
  "title",
  "library_id",
  "peer_node_id",
  "from",
  "to",
  "min_duration_ms",
  "max_duration_ms",
  "stop_reason",
  "min_bytes_streamed",
  "max_bytes_streamed",
] as const;

export interface ActivityFilters {
  userIds: string[];
  playMethods: PlayMethod[];
  titleTerms: string[];
  libraryIds: string[];
  peerNodeIds: string[];
  from?: string;
  to?: string;
  minDurationMs?: number;
  maxDurationMs?: number;
  stopReasons: ActivityStopReasonFilter[];
  minBytesStreamed?: number;
  maxBytesStreamed?: number;
}

export interface ActivityFilterErrors {
  dateRange?: string;
  durationRange?: string;
  bytesRange?: string;
}

export interface LiveActivityFilterRow {
  user_id: string;
  play_method: PlayMethod;
  media_title?: string | null;
  library_id?: string | null;
  peer_node_id: string;
  started_at: string;
  duration_ms: number;
  bytes_streamed: number;
}

export function emptyActivityFilters(): ActivityFilters {
  return {
    userIds: [],
    playMethods: [],
    titleTerms: [],
    libraryIds: [],
    peerNodeIds: [],
    stopReasons: [],
  };
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function parseDateTime(value: string | null): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function parseNonNegativeInteger(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function parseActivityFilters(params: URLSearchParams): ActivityFilters {
  return {
    userIds: uniqueNonEmpty(params.getAll("user_id")),
    playMethods: uniqueNonEmpty(params.getAll("play_method")).filter(
      (method): method is PlayMethod => PLAY_METHODS.has(method)
    ),
    titleTerms: uniqueNonEmpty(params.getAll("title")),
    libraryIds: uniqueNonEmpty(params.getAll("library_id")),
    peerNodeIds: uniqueNonEmpty(params.getAll("peer_node_id")),
    from: parseDateTime(params.get("from")),
    to: parseDateTime(params.get("to")),
    minDurationMs: parseNonNegativeInteger(params.get("min_duration_ms")),
    maxDurationMs: parseNonNegativeInteger(params.get("max_duration_ms")),
    stopReasons: uniqueNonEmpty(params.getAll("stop_reason")).filter(
      (reason): reason is ActivityStopReasonFilter => STOP_REASONS.has(reason)
    ),
    minBytesStreamed: parseNonNegativeInteger(
      params.get("min_bytes_streamed")
    ),
    maxBytesStreamed: parseNonNegativeInteger(
      params.get("max_bytes_streamed")
    ),
  };
}

function appendMany(
  params: URLSearchParams,
  key: string,
  values: readonly string[]
) {
  for (const value of uniqueNonEmpty([...values]).sort((left, right) =>
    left.localeCompare(right)
  )) {
    params.append(key, value);
  }
}

function setNumber(
  params: URLSearchParams,
  key: string,
  value: number | undefined
) {
  if (value !== undefined && Number.isSafeInteger(value) && value >= 0) {
    params.set(key, String(value));
  }
}

/**
 * Writes only Activity-owned keys, preserving development routing parameters
 * such as `apiBaseUrl` and any future unrelated query state.
 */
export function serialiseActivityFilters(
  filters: ActivityFilters,
  existing = new URLSearchParams()
): URLSearchParams {
  const params = new URLSearchParams(existing);
  for (const key of FILTER_QUERY_KEYS) params.delete(key);

  appendMany(params, "user_id", filters.userIds);
  appendMany(params, "play_method", filters.playMethods);
  appendMany(params, "title", filters.titleTerms);
  appendMany(params, "library_id", filters.libraryIds);
  appendMany(params, "peer_node_id", filters.peerNodeIds);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  setNumber(params, "min_duration_ms", filters.minDurationMs);
  setNumber(params, "max_duration_ms", filters.maxDurationMs);
  appendMany(params, "stop_reason", filters.stopReasons);
  setNumber(params, "min_bytes_streamed", filters.minBytesStreamed);
  setNumber(params, "max_bytes_streamed", filters.maxBytesStreamed);
  return params;
}

export function activityFiltersKey(filters: ActivityFilters): string {
  return serialiseActivityFilters(filters).toString();
}

export function activityFiltersEqual(
  left: ActivityFilters,
  right: ActivityFilters
): boolean {
  return activityFiltersKey(left) === activityFiltersKey(right);
}

export function activeActivityFilterCount(filters: ActivityFilters): number {
  return [
    filters.userIds,
    filters.playMethods,
    filters.titleTerms,
    filters.libraryIds,
    filters.peerNodeIds,
    filters.from || filters.to,
    filters.minDurationMs !== undefined || filters.maxDurationMs !== undefined,
    filters.stopReasons,
    filters.minBytesStreamed !== undefined ||
      filters.maxBytesStreamed !== undefined,
  ].filter((value) => (Array.isArray(value) ? value.length > 0 : Boolean(value)))
    .length;
}

function matchesFacet(
  selectedValues: readonly string[],
  candidate: string | null | undefined
): boolean {
  return (
    selectedValues.length === 0 ||
    Boolean(candidate && selectedValues.includes(candidate))
  );
}

/**
 * Applies the shared Activity filters to a live row. Stop reasons have one
 * meaningful live value: an active row is considered `in_progress`.
 */
export function matchesLiveActivityFilters(
  session: LiveActivityFilterRow,
  filters: ActivityFilters
): boolean {
  if (!matchesFacet(filters.userIds, session.user_id)) return false;
  if (!matchesFacet(filters.playMethods, session.play_method)) return false;
  if (!matchesFacet(filters.libraryIds, session.library_id)) return false;
  if (!matchesFacet(filters.peerNodeIds, session.peer_node_id)) return false;

  if (filters.titleTerms.length > 0) {
    const title = (session.media_title ?? "").toLocaleLowerCase();
    const matchesTitle = filters.titleTerms.some((term) =>
      title.includes(term.toLocaleLowerCase())
    );
    if (!matchesTitle) return false;
  }

  const startedAt = new Date(session.started_at).getTime();
  if (
    filters.from &&
    (!Number.isFinite(startedAt) ||
      startedAt < new Date(filters.from).getTime())
  ) {
    return false;
  }
  if (
    filters.to &&
    (!Number.isFinite(startedAt) || startedAt > new Date(filters.to).getTime())
  ) {
    return false;
  }
  if (
    filters.minDurationMs !== undefined &&
    session.duration_ms < filters.minDurationMs
  ) {
    return false;
  }
  if (
    filters.maxDurationMs !== undefined &&
    session.duration_ms > filters.maxDurationMs
  ) {
    return false;
  }
  if (
    filters.minBytesStreamed !== undefined &&
    session.bytes_streamed < filters.minBytesStreamed
  ) {
    return false;
  }
  if (
    filters.maxBytesStreamed !== undefined &&
    session.bytes_streamed > filters.maxBytesStreamed
  ) {
    return false;
  }
  return (
    filters.stopReasons.length === 0 ||
    filters.stopReasons.includes("in_progress")
  );
}

export function validateActivityFilters(
  filters: ActivityFilters
): ActivityFilterErrors {
  const errors: ActivityFilterErrors = {};
  if (
    filters.from &&
    filters.to &&
    new Date(filters.from).getTime() > new Date(filters.to).getTime()
  ) {
    errors.dateRange =
      "The From date and time must not be later than the To date and time.";
  }
  if (
    filters.minDurationMs !== undefined &&
    filters.maxDurationMs !== undefined &&
    filters.minDurationMs > filters.maxDurationMs
  ) {
    errors.durationRange =
      "The minimum session length must not exceed the maximum.";
  }
  if (
    filters.minBytesStreamed !== undefined &&
    filters.maxBytesStreamed !== undefined &&
    filters.minBytesStreamed > filters.maxBytesStreamed
  ) {
    errors.bytesRange =
      "The minimum streamed size must not exceed the maximum.";
  }
  return errors;
}

export function hasActivityFilterErrors(
  errors: ActivityFilterErrors
): boolean {
  return Object.values(errors).some(Boolean);
}

function optionalArray<T>(values: T[]): T[] | undefined {
  return values.length > 0 ? values : undefined;
}

export function toActivityHistoryRequest(
  filters: ActivityFilters,
  pagination: { limit: number; cursor?: string }
): ActivityHistoryRequest {
  return {
    user_ids: optionalArray(filters.userIds),
    play_methods: optionalArray(filters.playMethods),
    title_terms: optionalArray(filters.titleTerms),
    library_ids: optionalArray(filters.libraryIds),
    peer_node_ids: optionalArray(filters.peerNodeIds),
    from: filters.from,
    to: filters.to,
    min_duration_ms: filters.minDurationMs,
    max_duration_ms: filters.maxDurationMs,
    stop_reasons: optionalArray(filters.stopReasons),
    min_bytes_streamed: filters.minBytesStreamed,
    max_bytes_streamed: filters.maxBytesStreamed,
    ...pagination,
  };
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

/** Converts an RFC3339 instant into the browser's local datetime input value. */
export function toLocalDateTimeValue(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(
    date.getDate()
  )}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

/** Converts a browser-local datetime input value into an RFC3339 instant. */
export function fromLocalDateTimeValue(
  value: string,
  boundary: "start" | "end" = "start"
): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setSeconds(
    boundary === "start" ? 0 : 59,
    boundary === "start" ? 0 : 999
  );
  return date.toISOString();
}

export function recentActivityRange(
  durationMs: number,
  now = new Date()
): Pick<ActivityFilters, "from" | "to"> {
  return {
    from: new Date(now.getTime() - durationMs).toISOString(),
    to: now.toISOString(),
  };
}
