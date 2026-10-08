import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageLayout, type ActionIcon, type PageAction } from "../components/shell";

const ICONS: readonly ActionIcon[] = ["filters", "bell", "add", "customise", "prev", "next", "back"];
const noop = () => undefined;

/**
 * Parses `actions=navigation,panel:bell:Label,link:customise:Label,status:Label,filters:Label:count`; `open` draws every
 * drawer opener in its open state.
 * Labels are URI-decoded by the browser; a label never contains a colon or a comma.
 */
export function parseHarnessActions(spec: string, open = false): PageAction[] {
  return spec
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part, index): PageAction[] => {
      const [kind, ...rest] = part.split(":");
      switch (kind) {
        case "navigation":
          return [
            {
              kind: "navigation",
              id: "navigation",
              label: "Navigation",
              items: [
                { id: "prev", label: "Previous", icon: "prev", onSelect: noop },
                { id: "today", label: "Today", onSelect: noop },
                { id: "next", label: "Next", icon: "next", onSelect: noop },
              ],
            },
          ];
        case "panel":
        case "link": {
          const icon = ICONS.includes(rest[0] as ActionIcon) ? (rest[0] as ActionIcon) : "bell";
          const label = rest[1] ?? "Action";
          return kind === "panel"
            ? [{ kind: "panel", id: `panel-${index}`, label, icon, open, onToggle: noop, controls: `harness-panel-${index}` }]
            : [{ kind: "link", id: `link-${index}`, label, icon, to: "/" }];
        }
        case "status":
          return [{ kind: "status", id: `status-${index}`, label: rest[0] ?? "Status" }];
        case "filters":
          return [{ kind: "filters", label: rest[0] ?? "Filters", open, onToggle: noop, controls: "harness-filters", activeCount: Number(rest[1] ?? 0) || 0 }];
        default:
          return [];
      }
    });
}

/**
 * Dev-only canonical page layout (registered like the nav-perf harness and stripped from production builds). It renders
 * `PageLayout` with a header built from the query string, so `scripts/layout-parity.mjs` can diff any page's header band
 * against the canonical one at zero pixels.
 */
export function LayoutHarnessPage() {
  const [params] = useSearchParams();
  const actions = useMemo(() => parseHarnessActions(params.get("actions") ?? "", params.get("open") === "1"), [params]);
  const back = params.get("back");
  return (
    <PageLayout
      pageId="library"
      className="tv-library tv-directory"
      ariaLabel="Layout harness"
      header={{
        title: params.get("title") ?? "Title",
        detail: params.get("description")
          ? { title: params.get("detail") ?? "", description: params.get("description") ?? "" }
          : (params.get("detail") ?? undefined),
        mobileShow: params.get("mobileShow") === "detail" ? "detail" : undefined,
        back: { label: back ?? "Back", to: "/" },
        actions,
      }}
    />
  );
}
