import { useEffect, useRef, useState } from "react";
import type { SourceInstanceResponse, WorkKind } from "@streamarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { KIND_LABELS } from "./PosterCard";

const KIND_OPTIONS: WorkKind[] = ["movie", "series", "artist", "author"];

/** Layers/funnel glyph -- the "Type" toolbar button's icon. */
function TypeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

/** Stacked-disks glyph -- the "Library" toolbar button's icon. */
function LibraryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="toolbar-menu-item-check"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

interface ToolbarMenuOption {
  value: string | null;
  label: string;
}

/**
 * One toolbar dropdown -- the real Sonarr/Radarr `ToolbarMenuButton` +
 * `MenuContent` pattern, confirmed live against both apps (identical
 * `PageToolbar`/`ToolbarMenuButton` components in both): icon-over-label
 * button whose own label stays constant (Sonarr's "Filter" button always
 * reads "Filter", never the active preset's name -- selection state shows
 * only via the checkmark inside the open panel), opening a flat
 * `#333333` panel anchored under the button, no border/shadow/radius. A
 * single-select flat list, not a faceted filter panel -- `sourceInstanceId`/
 * `kind` are both `Option<T>` on the backend, not arrays, so a checkbox
 * multi-select would promise capability the API can't deliver.
 */
function ToolbarMenu({
  label,
  icon,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  value: string | null;
  options: ToolbarMenuOption[];
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="toolbar-menu" ref={rootRef}>
      <button
        type="button"
        className={`toolbar-menu-button${open ? " is-open" : ""}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="toolbar-menu-button-icon">{icon}</span>
        <span className="toolbar-menu-button-label">{label}</span>
      </button>
      {open && (
        <div className="toolbar-menu-panel">
          {options.map((option) => (
            <button
              key={option.value ?? "__all__"}
              type="button"
              className={`toolbar-menu-item${value === option.value ? " is-active" : ""}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <CheckIcon />
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface LibraryToolbarMenusProps {
  kind: WorkKind | null;
  onKindChange: (kind: WorkKind | null) => void;
  sourceInstanceId: string | null;
  onSourceInstanceChange: (id: string | null) => void;
  /** `true` when a `?q=` search is active -- the Library menu is disabled, not hidden, in that state. */
  searchActive: boolean;
}

/**
 * The Library route's "second nav row" -- Type/Library filters as
 * right-aligned toolbar dropdown menus directly under the app header,
 * matching the real Sonarr/Radarr `PageToolbar`'s View/Sort/Filter cluster:
 * icon-over-label buttons separated by a thin divider, opening a flat
 * `#333333` dropdown panel with a checkmark on the active row (see
 * `global.css`'s `.library-toolbar`/`.toolbar-menu-*` rules, all values
 * pulled from a live re-check against both real apps, not guessed).
 *
 * Fetches `listSourceInstances()` itself, on mount -- that endpoint is
 * admin-only (`GET /api/v1/admin/source-instances`, gated by `AdminUser`),
 * so a signed-in non-admin `CatalogViewer` (streaming-access-only) will get
 * a 403 here; that's caught silently and treated as "hide the Library
 * menu", not an error worth surfacing on a page that otherwise works fine
 * for them.
 */
export function LibraryToolbarMenus({
  kind,
  onKindChange,
  sourceInstanceId,
  onSourceInstanceChange,
  searchActive,
}: LibraryToolbarMenusProps) {
  const client = useApiClient();
  const [instances, setInstances] = useState<SourceInstanceResponse[] | null>(null);

  useEffect(() => {
    client
      .listSourceInstances()
      .then(setInstances)
      .catch(() => setInstances(null));
  }, [client]);

  const kindOptions: ToolbarMenuOption[] = [
    { value: null, label: "All types" },
    ...KIND_OPTIONS.map((k) => ({ value: k, label: KIND_LABELS[k] })),
  ];

  const libraryOptions: ToolbarMenuOption[] = [
    { value: null, label: "All libraries" },
    ...(instances ?? []).map((inst) => ({ value: inst.id, label: inst.name })),
  ];

  return (
    <div className="library-toolbar-menus">
      <ToolbarMenu
        label="Type"
        icon={<TypeIcon />}
        value={kind}
        options={kindOptions}
        onChange={(v) => onKindChange(v as WorkKind | null)}
      />
      {instances !== null && (
        <>
          <div className="toolbar-separator" />
          <ToolbarMenu
            label="Library"
            icon={<LibraryIcon />}
            value={sourceInstanceId}
            options={libraryOptions}
            onChange={onSourceInstanceChange}
            disabled={searchActive}
          />
        </>
      )}
    </div>
  );
}
