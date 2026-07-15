/**
 * @streamarr-tv/spatial-nav
 *
 * Platform-agnostic d-pad/remote focus-navigation engine. Deliberately has
 * no DOM or React dependency: callers register a focusable node with an
 * `id` and a `getRect()` accessor (a DOMRect on web/webOS/Tizen/VIDAA, or
 * anything rect-shaped in a future non-DOM host), and this engine decides
 * which node the next directional move should focus.
 *
 * `packages/ui-tv` wraps this in a React context/hook; `apps/*` wire real
 * keydown listeners (or a Tizen/webOS remote-key polyfill) to `move()`.
 */

export type Direction = "up" | "down" | "left" | "right";

export interface FocusableRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FocusableNode {
  id: string;
  /** Called lazily on every `move()` so layout changes (scroll, resize) are always reflected. */
  getRect: () => FocusableRect;
  /** Optional grouping (e.g. a shelf/row id) -- reserved for future group-aware traversal heuristics. */
  groupId?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  disabled?: boolean;
}

export interface SpatialNavOptions {
  onFocusChange?: (nodeId: string | null, previousNodeId: string | null) => void;
}

/**
 * Registers focusable nodes and resolves directional moves between them
 * using rect geometry. This is a from-scratch minimal implementation (not
 * a port of an existing library) -- the algorithm favors nodes that are
 * "ahead" in the requested direction and penalizes lateral offset, which is
 * the same overall shape as the WHATWG spatial navigation draft and
 * comparable to libraries like `js-spatial-navigation` / Norigin's
 * `react-spatial-navigation`, without adopting their APIs.
 */
export class SpatialNavigator {
  private readonly nodes = new Map<string, FocusableNode>();
  private focusedId: string | null = null;
  private readonly options: SpatialNavOptions;

  constructor(options: SpatialNavOptions = {}) {
    this.options = options;
  }

  /** Registers a focusable node. Returns an unregister function (use in a React `useEffect` cleanup). */
  register(node: FocusableNode): () => void {
    this.nodes.set(node.id, node);
    if (this.focusedId === null && !node.disabled) {
      this.focus(node.id);
    }
    return () => this.unregister(node.id);
  }

  unregister(nodeId: string): void {
    this.nodes.delete(nodeId);
    if (this.focusedId === nodeId) {
      this.focusedId = null;
      this.options.onFocusChange?.(null, nodeId);
    }
  }

  getCurrentFocus(): FocusableNode | null {
    return this.focusedId ? this.nodes.get(this.focusedId) ?? null : null;
  }

  /** Imperatively focuses a specific node (e.g. on initial route mount). Returns whether focus moved. */
  focus(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node || node.disabled) return false;

    const previousId = this.focusedId;
    if (previousId === nodeId) return true;

    if (previousId) {
      this.nodes.get(previousId)?.onBlur?.();
    }
    this.focusedId = nodeId;
    node.onFocus?.();
    this.options.onFocusChange?.(nodeId, previousId);
    return true;
  }

  /** Moves focus one step in `direction` from the current node. Returns whether focus moved. */
  move(direction: Direction): boolean {
    const current = this.getCurrentFocus();
    const candidates = [...this.nodes.values()].filter(
      (node) => !node.disabled && node.id !== current?.id
    );

    if (!current) {
      const first = candidates[0];
      return first ? this.focus(first.id) : false;
    }

    const currentRect = current.getRect();
    let best: { nodeId: string; score: number } | null = null;

    for (const candidate of candidates) {
      const rect = candidate.getRect();
      if (!isCandidateInDirection(currentRect, rect, direction)) continue;

      const score = directionalScore(currentRect, rect, direction);
      if (!best || score < best.score) {
        best = { nodeId: candidate.id, score };
      }
    }

    return best ? this.focus(best.nodeId) : false;
  }
}

function center(rect: FocusableRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** A candidate is only eligible if its center lies on the requested side of the current node's center. */
function isCandidateInDirection(
  from: FocusableRect,
  to: FocusableRect,
  direction: Direction
): boolean {
  const a = center(from);
  const b = center(to);
  switch (direction) {
    case "up":
      return b.y < a.y;
    case "down":
      return b.y > a.y;
    case "left":
      return b.x < a.x;
    case "right":
      return b.x > a.x;
  }
}

/**
 * Lower is better. Primary axis distance dominates; perpendicular ("lateral")
 * offset is penalized so the engine prefers staying roughly aligned with the
 * current row/column, matching how remote-control navigation feels natural.
 */
function directionalScore(from: FocusableRect, to: FocusableRect, direction: Direction): number {
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  const isVertical = direction === "up" || direction === "down";
  const primaryDistance = Math.abs(isVertical ? dy : dx);
  const lateralOffset = Math.abs(isVertical ? dx : dy);

  const LATERAL_PENALTY_WEIGHT = 2;
  return primaryDistance + lateralOffset * LATERAL_PENALTY_WEIGHT;
}
