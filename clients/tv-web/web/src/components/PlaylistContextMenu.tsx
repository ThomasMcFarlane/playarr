import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  describeApiError,
  type PlaylistResponse,
} from "@playarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import { useToast } from "../lib/toast";
import { SearchablePlaylistSelect } from "./SearchablePlaylistSelect";

const LONG_PRESS_MS = 650;
type PlaylistContextView = "actions" | "edit" | "delete";

function descendantsOf(
  playlistId: string,
  playlists: PlaylistResponse[]
): Set<string> {
  const descendants = new Set<string>();
  const visit = (parentId: string) => {
    for (const playlist of playlists) {
      if (
        playlist.parent_playlist_id !== parentId ||
        descendants.has(playlist.id)
      ) {
        continue;
      }
      descendants.add(playlist.id);
      visit(playlist.id);
    }
  };
  visit(playlistId);
  return descendants;
}

function playlistPath(
  playlist: PlaylistResponse,
  playlists: PlaylistResponse[]
): string {
  const byId = new Map(playlists.map((candidate) => [candidate.id, candidate]));
  const names = [playlist.name];
  const visited = new Set([playlist.id]);
  let parentId = playlist.parent_playlist_id;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parent_playlist_id;
  }
  return names.join(" › ");
}

export function usePlaylistContextMenu({
  onDeleted,
  onUpdated,
  playlists,
}: {
  onDeleted: (playlistId: string) => void;
  onUpdated: (playlist: PlaylistResponse) => void;
  playlists: PlaylistResponse[];
}) {
  const client = useApiClient();
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [activePlaylist, setActivePlaylist] =
    useState<PlaylistResponse | null>(null);
  const [view, setView] = useState<PlaylistContextView>("actions");
  const [name, setName] = useState("");
  const [parentPlaylistId, setParentPlaylistId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const parentTriggerRef = useRef<HTMLButtonElement | null>(null);
  const longPressTimerRef = useRef<number | undefined>(undefined);
  const longPressTriggeredRef = useRef(false);

  const clearLongPress = useCallback(() => {
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = undefined;
  }, []);

  const openView = useCallback(
    (
      playlist: PlaylistResponse,
      origin: HTMLElement,
      initialView: PlaylistContextView,
      focusFirstAction = true
    ) => {
      if (playlist.is_system) return;
      clearLongPress();
      originRef.current = origin;
      setActivePlaylist(playlist);
      setView(initialView);
      setName(playlist.name);
      setParentPlaylistId(playlist.parent_playlist_id ?? "");
      setBusy(false);
      setError(null);
      if (focusFirstAction) {
        window.requestAnimationFrame(() =>
          initialView === "edit"
            ? nameInputRef.current?.focus()
            : firstActionRef.current?.focus()
        );
      }
    },
    [clearLongPress]
  );

  const open = useCallback(
    (
      playlist: PlaylistResponse,
      origin: HTMLElement,
      focusFirstAction = true
    ) => openView(playlist, origin, "actions", focusFirstAction),
    [openView]
  );

  const openEdit = useCallback(
    (playlist: PlaylistResponse, origin: HTMLElement) =>
      openView(playlist, origin, "edit"),
    [openView]
  );

  const openDelete = useCallback(
    (playlist: PlaylistResponse, origin: HTMLElement) =>
      openView(playlist, origin, "delete"),
    [openView]
  );

  const close = useCallback(() => {
    clearLongPress();
    setActivePlaylist(null);
    setBusy(false);
    setError(null);
    window.requestAnimationFrame(() =>
      originRef.current?.focus({ preventScroll: true })
    );
  }, [clearLongPress]);

  const parentOptions = useMemo(() => {
    if (!activePlaylist) return [];
    const excluded = descendantsOf(activePlaylist.id, playlists);
    excluded.add(activePlaylist.id);
    return playlists
      .filter(
        (playlist) =>
          !playlist.is_system &&
          playlist.media_type === activePlaylist.media_type &&
          !excluded.has(playlist.id)
      )
      .sort((left, right) =>
        left.name.localeCompare(right.name, undefined, {
          numeric: true,
          sensitivity: "base",
        })
      )
      .map((playlist) => ({
        value: playlist.id,
        label: playlistPath(playlist, playlists),
      }));
  }, [activePlaylist, playlists]);

  const beginEdit = useCallback(() => {
    if (!activePlaylist) return;
    setView("edit");
    setName(activePlaylist.name);
    setParentPlaylistId(activePlaylist.parent_playlist_id ?? "");
    setError(null);
    window.requestAnimationFrame(() => nameInputRef.current?.focus());
  }, [activePlaylist]);

  const save = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!activePlaylist || busy || !name.trim()) return;
      setBusy(true);
      setError(null);
      try {
        const updated = await client.updatePlaylist(activePlaylist.id, {
          name: name.trim(),
          parent_playlist_id: parentPlaylistId || null,
        });
        onUpdated(updated);
        close();
        showToast(
          t("components.playlistContextMenu.updatedToast", {
            name: updated.name,
          })
        );
      } catch (caught) {
        setBusy(false);
        setError(describeApiError(caught));
      }
    },
    [
      activePlaylist,
      busy,
      client,
      close,
      name,
      onUpdated,
      parentPlaylistId,
      showToast,
      t,
    ]
  );

  const remove = useCallback(async () => {
    if (!activePlaylist || busy) return;
    setBusy(true);
    setError(null);
    try {
      await client.deletePlaylist(activePlaylist.id);
      const deleted = activePlaylist;
      onDeleted(deleted.id);
      close();
      showToast(
        t("components.playlistContextMenu.deletedToast", {
          name: deleted.name,
        })
      );
    } catch (caught) {
      setBusy(false);
      setError(describeApiError(caught));
    }
  }, [activePlaylist, busy, client, close, onDeleted, showToast, t]);

  const itemProps = useCallback(
    (playlist: PlaylistResponse) => ({
      onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
        if (playlist.is_system) return;
        event.preventDefault();
        event.stopPropagation();
        open(playlist, event.currentTarget);
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        const confirm =
          event.key === "Enter" ||
          event.key === "Accept" ||
          event.keyCode === 13;
        if (!confirm || playlist.is_system) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        clearLongPress();
        longPressTriggeredRef.current = false;
        const origin = event.currentTarget;
        longPressTimerRef.current = window.setTimeout(() => {
          longPressTriggeredRef.current = true;
          open(playlist, origin, false);
        }, LONG_PRESS_MS);
      },
      onKeyUp: (event: KeyboardEvent<HTMLElement>) => {
        const confirm =
          event.key === "Enter" ||
          event.key === "Accept" ||
          event.keyCode === 13;
        if (!confirm || playlist.is_system) return;
        event.preventDefault();
        event.stopPropagation();
        clearLongPress();
        if (!longPressTriggeredRef.current) event.currentTarget.click();
        else {
          window.requestAnimationFrame(() => firstActionRef.current?.focus());
        }
        longPressTriggeredRef.current = false;
      },
      onBlur: clearLongPress,
    }),
    [clearLongPress, open]
  );

  const contextMenu = activePlaylist
    ? createPortal(
        <div
          className="media-context-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <aside
            className="media-context-drawer playlist-context-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={t("components.playlistContextMenu.dialogLabel", {
              name: activePlaylist.name,
            })}
            onKeyDown={(event) => {
              const back =
                event.key === "Escape" ||
                event.key === "BrowserBack" ||
                event.key === "GoBack" ||
                event.keyCode === 10009 ||
                event.keyCode === 461;
              if (back || event.key === "ArrowLeft") {
                event.preventDefault();
                event.stopPropagation();
                if (view === "actions") close();
                else {
                  setView("actions");
                  setError(null);
                  window.requestAnimationFrame(() =>
                    firstActionRef.current?.focus()
                  );
                }
                return;
              }
              if (view === "edit" && event.target === nameInputRef.current) {
                if (event.key !== "ArrowDown") return;
                event.preventDefault();
                event.stopPropagation();
                parentTriggerRef.current?.focus();
                return;
              }
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              const controls = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), input:not(:disabled)'
                )
              );
              const index = controls.indexOf(
                document.activeElement as HTMLElement
              );
              if (index < 0 || !controls.length) return;
              const delta = event.key === "ArrowDown" ? 1 : -1;
              controls[
                (index + delta + controls.length) % controls.length
              ]?.focus();
            }}
          >
            <header>
              <p>{t("components.playlistContextMenu.heading")}</p>
              <h2>{activePlaylist.name}</h2>
            </header>

            {view === "actions" ? (
              <div className="media-context-actions">
                <button ref={firstActionRef} type="button" onClick={beginEdit}>
                  <span aria-hidden="true">✎</span>
                  <strong>{t("components.playlistContextMenu.edit")}</strong>
                </button>
                <button
                  type="button"
                  className="playlist-context-delete-action"
                  onClick={() => {
                    setView("delete");
                    setError(null);
                    window.requestAnimationFrame(() =>
                      firstActionRef.current?.focus()
                    );
                  }}
                >
                  <span aria-hidden="true">−</span>
                  <strong>{t("components.playlistContextMenu.delete")}</strong>
                </button>
              </div>
            ) : view === "edit" ? (
              <form className="playlist-context-form" onSubmit={save}>
                <label htmlFor="playlist-context-name">
                  {t("pages.playlists.nameLabel")}
                </label>
                <input
                  ref={nameInputRef}
                  id="playlist-context-name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="off"
                />
                <label>{t("pages.playlists.parentPlaylistLabel")}</label>
                <SearchablePlaylistSelect
                  ariaLabel={t("pages.playlists.parentPlaylistLabel")}
                  emptyLabel={t("pages.playlists.noneTopLevel")}
                  noResultsLabel={t("pages.playlists.noParentResults")}
                  onSelect={setParentPlaylistId}
                  options={parentOptions}
                  searchPlaceholder={t("pages.playlists.searchParents")}
                  triggerRef={(element) => {
                    parentTriggerRef.current = element;
                  }}
                  value={parentPlaylistId}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || !name.trim()}
                >
                  {busy
                    ? t("components.playlistContextMenu.saving")
                    : t("components.playlistContextMenu.save")}
                </button>
              </form>
            ) : (
              <div className="playlist-context-confirm">
                <p>
                  {t("components.playlistContextMenu.deleteDescription", {
                    name: activePlaylist.name,
                  })}
                </p>
                <div className="media-context-actions">
                  <button
                    ref={firstActionRef}
                    type="button"
                    onClick={() => {
                      setView("actions");
                      window.requestAnimationFrame(() =>
                        firstActionRef.current?.focus()
                      );
                    }}
                    disabled={busy}
                  >
                    <span aria-hidden="true">←</span>
                    <strong>{t("components.playlistContextMenu.cancel")}</strong>
                  </button>
                  <button
                    type="button"
                    className="playlist-context-delete-action"
                    onClick={() => void remove()}
                    disabled={busy}
                  >
                    <span aria-hidden="true">−</span>
                    <strong>
                      {busy
                        ? t("components.playlistContextMenu.deleting")
                        : t("components.playlistContextMenu.confirmDelete")}
                    </strong>
                  </button>
                </div>
              </div>
            )}

            {error ? (
              <p className="media-context-error" role="alert">
                {error}
              </p>
            ) : null}
          </aside>
        </div>,
        document.body
      )
    : null;

  return { close, contextMenu, itemProps, open, openDelete, openEdit };
}
