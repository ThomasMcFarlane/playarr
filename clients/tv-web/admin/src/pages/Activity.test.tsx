import {
  ApiError,
  type ActivityHistoryResponse,
  type ActivitySessionHistoryView,
  type UnavailableActivityNode,
} from "@playarr-tv/api-client";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { describe, expect, it } from "vitest";
import {
  ActivityMediaLink,
  activityMediaHref,
  peerNodeOptions,
  retainSearchableOptions,
} from "./Activity";
import {
  emptyActivityFilters,
  toActivityHistoryRequest,
} from "../lib/activityFilters";
import {
  appendActivityHistoryPage,
  activityHistoryRequiresRestart,
  createActivityHistoryPage,
  createActivityRequestGate,
  filterUnavailableActivityNodes,
  toContinuationActivityHistoryRequest,
} from "../lib/activityPageState";

function historyRow(
  peerNodeId: string,
  id: string
): ActivitySessionHistoryView {
  return {
    peer_node_id: peerNodeId,
    id,
  } as ActivitySessionHistoryView;
}

function unavailableNode(
  peerNodeId: string,
  name = peerNodeId
): UnavailableActivityNode {
  return {
    peer_node_id: peerNodeId,
    peer_node_name: name,
    error: `${name} unavailable`,
  };
}

function historyResponse(
  sessions: ActivitySessionHistoryView[],
  unavailableNodes: UnavailableActivityNode[],
  hasMore = true,
  snapshotTo = "2026-07-29T10:34:27.456Z"
): ActivityHistoryResponse {
  return {
    sessions,
    unavailable_nodes: unavailableNodes,
    has_more: hasMore,
    next_cursor: hasMore ? "opaque-next-cursor" : null,
    snapshot_to: snapshotTo,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("Activity history request races", () => {
  it("ignores an older deferred response after a newer request begins", async () => {
    const gate = createActivityRequestGate();
    const older = deferred<string>();
    const newer = deferred<string>();
    const olderGeneration = gate.begin();
    const olderResult = older.promise.then((value) =>
      gate.isCurrent(olderGeneration) ? value : undefined
    );
    const newerGeneration = gate.begin();
    const newerResult = newer.promise.then((value) =>
      gate.isCurrent(newerGeneration) ? value : undefined
    );

    newer.resolve("new page");
    expect(await newerResult).toBe("new page");
    older.resolve("stale page");
    expect(await olderResult).toBeUndefined();
  });

  it("continues with the opaque cursor and unchanged filters", () => {
    const filters = emptyActivityFilters();
    const firstPage = toActivityHistoryRequest(filters, {
      limit: 100,
    });
    const response = historyResponse([], [], true);
    const page = createActivityHistoryPage(response);
    const nextPage = toContinuationActivityHistoryRequest(
      filters,
      page.nextCursor!,
      100
    );

    expect(firstPage.to).toBeUndefined();
    expect(page.snapshotTo).toBe("2026-07-29T10:34:27.456Z");
    expect(nextPage.to).toBeUndefined();
    expect(nextPage.cursor).toBe("opaque-next-cursor");
    expect(nextPage.offset).toBeUndefined();
  });
});

describe("Activity history page merging", () => {
  it("de-duplicates peer/session keys while advancing the opaque cursor", () => {
    const warning = unavailableNode("peer-offline", "Bedroom");
    const first = createActivityHistoryPage(
      historyResponse(
        [historyRow("peer-a", "same"), historyRow("peer-a", "same")],
        [warning]
      )
    );
    const merged = appendActivityHistoryPage(
      first,
      historyResponse(
        [historyRow("peer-a", "same"), historyRow("peer-b", "same")],
        [warning],
        false
      )
    );

    expect(first.sessions).toHaveLength(1);
    expect(first.nextCursor).toBe("opaque-next-cursor");
    expect(merged.sessions.map((row) => row.peer_node_id)).toEqual([
      "peer-a",
      "peer-b",
    ]);
    expect(merged.nextCursor).toBeNull();
    expect(merged.availabilityChanged).toBe(false);
    expect(merged.snapshotChanged).toBe(false);
  });

  it("rejects an appended page when node availability changes and retains warnings", () => {
    const firstWarning = unavailableNode("peer-a", "Office");
    const laterWarning = unavailableNode("peer-b", "Bedroom");
    const first = createActivityHistoryPage(
      historyResponse([historyRow("peer-live", "one")], [firstWarning])
    );
    const merged = appendActivityHistoryPage(
      first,
      historyResponse([historyRow("peer-live", "two")], [laterWarning])
    );

    expect(merged.availabilityChanged).toBe(true);
    expect(merged.sessions.map((row) => row.id)).toEqual(["one"]);
    expect(merged.nextCursor).toBe("opaque-next-cursor");
    expect(merged.unavailableNodes.map((node) => node.peer_node_id)).toEqual([
      "peer-b",
      "peer-a",
    ]);
  });

  it("does not clear an accumulated warning when a later page omits it", () => {
    const firstWarning = unavailableNode("peer-a", "Office");
    const first = createActivityHistoryPage(
      historyResponse([historyRow("peer-live", "one")], [firstWarning])
    );
    const merged = appendActivityHistoryPage(
      first,
      historyResponse([historyRow("peer-live", "two")], [])
    );

    expect(merged.availabilityChanged).toBe(true);
    expect(merged.unavailableNodes).toEqual([firstWarning]);
  });

  it("rejects a page whose echoed snapshot differs", () => {
    const first = createActivityHistoryPage(
      historyResponse([historyRow("peer-live", "one")], [])
    );
    const merged = appendActivityHistoryPage(
      first,
      historyResponse(
        [historyRow("peer-live", "two")],
        [],
        false,
        "2026-07-29T10:35:00.000Z"
      )
    );

    expect(merged.snapshotChanged).toBe(true);
    expect(merged.sessions.map((row) => row.id)).toEqual(["one"]);
  });

  it("restarts page one when the server rejects a stale contributor cursor", () => {
    expect(
      activityHistoryRequiresRestart(
        new ApiError(409, "Conflict", {
          message: "connected-server membership changed",
        })
      )
    ).toBe(true);
    expect(
      activityHistoryRequiresRestart(
        new ApiError(400, "Bad Request", { message: "invalid cursor" })
      )
    ).toBe(false);
  });
});

describe("Activity row and warning safety", () => {
  it("does not offer peers that have left as connected-server filters", () => {
    const peer = {
      addresses: [],
      group_id: "group-a",
      joined_at: "2026-07-29T10:00:00.000Z",
      last_seen_at: null,
      last_sync_error: null,
      public_key: "public-key",
      updated_at: "2026-07-29T10:00:00.000Z",
    };

    expect(
      peerNodeOptions([
        {
          ...peer,
          id: "peer-active",
          is_self: true,
          name: "Office",
          status: "active",
        },
        {
          ...peer,
          id: "peer-left",
          is_self: false,
          name: "Old server",
          status: "left",
        },
      ])
    ).toEqual([
      {
        value: "peer-active",
        label: "Office",
        description: "This server",
      },
    ]);
  });

  it("links only work IDs that belong to this server", () => {
    expect(
      activityMediaHref({
        peer_node_is_self: true,
        work_id: "local-work",
      })
    ).toBe("/library/local-work");
    expect(
      activityMediaHref({
        peer_node_is_self: false,
        work_id: "remote-work",
      })
    ).toBeUndefined();

    const baseSession = {
      user_id: "user-a",
      media_file_id: "file-a",
      media_title: "Example title",
      user_display_name: "Viewer",
    };
    const localMarkup = renderToStaticMarkup(
      <StaticRouter location="/">
        <ActivityMediaLink
          session={{
            ...baseSession,
            peer_node_is_self: true,
            work_id: "local-work",
          }}
        />
      </StaticRouter>
    );
    const remoteMarkup = renderToStaticMarkup(
      <StaticRouter location="/">
        <ActivityMediaLink
          session={{
            ...baseSession,
            peer_node_is_self: false,
            work_id: "remote-work",
          }}
        />
      </StaticRouter>
    );

    expect(localMarkup).toContain('href="/library/local-work"');
    expect(remoteMarkup).not.toContain("/library/remote-work");
    expect(remoteMarkup).toContain("<span>Example title</span>");
  });

  it("shows live unavailable warnings only for selected servers", () => {
    const office = unavailableNode("peer-a", "Office");
    const bedroom = unavailableNode("peer-b", "Bedroom");

    expect(
      filterUnavailableActivityNodes([office, bedroom], ["peer-b"])
    ).toEqual([bedroom]);
    expect(filterUnavailableActivityNodes([office, bedroom], [])).toEqual([
      office,
      bedroom,
    ]);
  });

  it("retains a known library label when later result pages omit it", () => {
    const known = [{ value: "library-a", label: "Films" }];
    expect(retainSearchableOptions(known, [])).toBe(known);
    expect(
      retainSearchableOptions(known, [
        { value: "library-b", label: "Television" },
      ])
    ).toEqual([
      { value: "library-a", label: "Films" },
      { value: "library-b", label: "Television" },
    ]);
  });
});
