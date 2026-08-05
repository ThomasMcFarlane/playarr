import {
  ApiError,
  type ActivityHistoryRequest,
  type ActivityHistoryResponse,
  type ActivitySessionHistoryView,
  type UnavailableActivityNode,
} from "@playarr-tv/api-client";
import {
  toActivityHistoryRequest,
  type ActivityFilters,
} from "./activityFilters";

export interface ActivityHistoryPageState {
  sessions: ActivitySessionHistoryView[];
  unavailableNodes: UnavailableActivityNode[];
  /** Stable set from page zero. Every appended page must match it. */
  availabilitySetKey: string;
  /** Exact upper bound shared by page zero and every appended request. */
  snapshotTo: string;
  /** Opaque stable-key continuation supplied by the coordinator. */
  nextCursor: string | null;
}

export interface ActivityHistoryPageMerge extends ActivityHistoryPageState {
  availabilityChanged: boolean;
  snapshotChanged: boolean;
}

export interface ActivityRequestGate {
  begin(): number;
  invalidate(): void;
  isCurrent(generation: number): boolean;
}

/** Guards state updates so a late response cannot replace a newer request. */
export function createActivityRequestGate(): ActivityRequestGate {
  let currentGeneration = 0;
  return {
    begin() {
      currentGeneration += 1;
      return currentGeneration;
    },
    invalidate() {
      currentGeneration += 1;
    },
    isCurrent(generation) {
      return generation === currentGeneration;
    },
  };
}

export function activityHistoryRowKey(
  session: Pick<ActivitySessionHistoryView, "peer_node_id" | "id">
): string {
  return `${session.peer_node_id}:${session.id}`;
}

function deduplicateHistoryRows(
  sessions: ActivitySessionHistoryView[]
): ActivitySessionHistoryView[] {
  const rows = new Map<string, ActivitySessionHistoryView>();
  for (const session of sessions) {
    const key = activityHistoryRowKey(session);
    if (!rows.has(key)) rows.set(key, session);
  }
  return [...rows.values()];
}

export function activityAvailabilitySetKey(
  unavailableNodes: readonly UnavailableActivityNode[]
): string {
  return [...new Set(unavailableNodes.map((node) => node.peer_node_id))]
    .sort()
    .join("\u0000");
}

export function mergeUnavailableActivityNodes(
  accumulated: readonly UnavailableActivityNode[],
  incoming: readonly UnavailableActivityNode[]
): UnavailableActivityNode[] {
  const nodes = new Map<string, UnavailableActivityNode>();
  for (const node of accumulated) nodes.set(node.peer_node_id, node);
  for (const node of incoming) nodes.set(node.peer_node_id, node);
  return [...nodes.values()].sort((left, right) =>
    left.peer_node_name.localeCompare(right.peer_node_name)
  );
}

export function createActivityHistoryPage(
  response: ActivityHistoryResponse
): ActivityHistoryPageState {
  return {
    sessions: deduplicateHistoryRows(response.sessions),
    unavailableNodes: mergeUnavailableActivityNodes(
      [],
      response.unavailable_nodes
    ),
    availabilitySetKey: activityAvailabilitySetKey(
      response.unavailable_nodes
    ),
    snapshotTo: response.snapshot_to,
    nextCursor: response.next_cursor ?? null,
  };
}

/**
 * Appends only when the same connected-server set contributed to both pages.
 * Warnings are accumulated even on rejection so a later partial failure is
 * never hidden.
 */
export function appendActivityHistoryPage(
  current: ActivityHistoryPageState,
  response: ActivityHistoryResponse
): ActivityHistoryPageMerge {
  const incomingAvailabilitySetKey = activityAvailabilitySetKey(
    response.unavailable_nodes
  );
  const unavailableNodes = mergeUnavailableActivityNodes(
    current.unavailableNodes,
    response.unavailable_nodes
  );
  const availabilityChanged =
    incomingAvailabilitySetKey !== current.availabilitySetKey;
  const snapshotChanged = response.snapshot_to !== current.snapshotTo;
  if (availabilityChanged || snapshotChanged) {
    return {
      ...current,
      unavailableNodes,
      availabilityChanged,
      snapshotChanged,
    };
  }
  return {
    sessions: deduplicateHistoryRows([
      ...current.sessions,
      ...response.sessions,
    ]),
    unavailableNodes,
    availabilitySetKey: current.availabilitySetKey,
    snapshotTo: current.snapshotTo,
    nextCursor: response.next_cursor ?? null,
    availabilityChanged: false,
    snapshotChanged: false,
  };
}

export function filterUnavailableActivityNodes(
  unavailableNodes: readonly UnavailableActivityNode[],
  selectedPeerNodeIds: readonly string[]
): UnavailableActivityNode[] {
  if (selectedPeerNodeIds.length === 0) return [...unavailableNodes];
  const selected = new Set(selectedPeerNodeIds);
  return unavailableNodes.filter((node) => selected.has(node.peer_node_id));
}

export function toContinuationActivityHistoryRequest(
  filters: ActivityFilters,
  cursor: string,
  limit: number
): ActivityHistoryRequest {
  return toActivityHistoryRequest(filters, { limit, cursor });
}

/** A 409 means the cursor's member/responder set changed; page one is safe. */
export function activityHistoryRequiresRestart(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}
