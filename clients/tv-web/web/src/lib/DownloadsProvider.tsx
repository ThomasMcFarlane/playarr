import { createProgressQueueFlusher } from "./offlineProgressQueue";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { DownloadTicket } from "@playarr-tv/api-client";
import { useApiBaseUrl, useApiClient, useAuth, useCurrentUserId } from "./ApiClientProvider";
import { useLiveSubscription } from "./liveEvents";
import {
  abortDownload,
  deleteStoredBytes,
  detectDownloadStorage,
  downloadDirectToDevice,
  getPlaybackBlob,
  runDownload,
} from "./downloadEngine";
import {
  deleteDownload as deleteDownloadRow,
  deleteQueuedWatchMutation,
  listDownloads as listDownloadRows,
  listQueuedWatchMutations,
  putDownload,
  putQueuedWatchMutation,
  type DownloadKeepUntilPolicy,
  type DownloadRecord,
  type DownloadRecordStatus,
  type QueuedWatchMutation,
} from "./downloadsDb";
import { useLanguage } from "./i18n/LanguageProvider";
import { leafSubtitle, playableLeaves } from "./playableLeaves";
import { useOnlineStatus } from "./useOnlineStatus";
import { useToast } from "./toast";

const MAX_CONCURRENT_DOWNLOADS = 2;
const TICKET_POLL_MS = 4_000;
const EXPIRY_SWEEP_MS = 5 * 60_000;
const CAPABILITIES_POLL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function mimeTypeForContainer(container: string): string {
  const normalised = container.trim().toLowerCase().replace(/^\./, "");
  switch (normalised) {
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mkv":
    case "matroska":
      return "video/x-matroska";
    case "mp3":
      return "audio/mpeg";
    case "m4a":
    case "aac":
      return "audio/mp4";
    case "flac":
      return "audio/flac";
    case "ogg":
      return "audio/ogg";
    default:
      return "video/mp4";
  }
}

function directDeviceFileName(title: string, container: string): string {
  const cleanedTitle = title.replace(/[\\/:*?"<>|]/g, "").trim() || "download";
  const extension = container.trim().toLowerCase().replace(/^\./, "") || "mp4";
  return cleanedTitle + "." + extension;
}

function ticketToLocalStatus(ticket: DownloadTicket): DownloadRecordStatus {
  switch (ticket.status) {
    case "queued":
      return "queued";
    case "processing":
      return "processing";
    case "ready":
      return "downloading";
    case "failed":
      return "failed";
    case "expired":
      return "expired";
    case "canceled":
    default:
      return "canceled";
  }
}

export interface DownloadLeafInput {
  workId: string;
  workKind?: DownloadRecord["workKind"];
  mediaFileId: string;
  title: string;
  subtitle?: string | null;
  runtimeMs: number;
}

export interface EnqueueDownloadParams extends DownloadLeafInput {
  qualityId: string;
  qualityLabel: string;
  keepUntil: DownloadKeepUntilPolicy;
}

export interface DownloadsActiveSummary {
  count: number;
  bytesDownloaded: number;
  /** `null` when any active item's total size isn't known yet (still negotiating/estimating). */
  totalBytes: number | null;
}

export interface DownloadsStorageUsage {
  usageBytes: number;
  quotaBytes: number;
}

export interface LocalPlaybackSource {
  blobUrl: string;
  mimeType: string;
  durationSeconds: number;
}

interface DownloadsContextValue {
  downloads: DownloadRecord[];
  activeSummary: DownloadsActiveSummary;
  storageUsage: DownloadsStorageUsage | null;
  storageSupported: boolean | null;
  /**
   * The real device/browser download-storage capability (OPFS or
   * IndexedDB, via `detectDownloadStorage`) -- the Downloads nav tab/page
   * should gate on THIS field, not `storageSupported`: a device that can
   * only do the `downloadDirectToDevice` fallback has nothing for an
   * in-app Downloads list to manage.
   */
  downloadStorageAvailable: boolean | null;
  enqueue: (params: EnqueueDownloadParams) => Promise<DownloadRecord>;
  retry: (id: string) => Promise<void>;
  /** Cancels an in-progress download or deletes a finished one -- full cleanup either way. */
  remove: (id: string) => Promise<void>;
  updateKeepUntil: (id: string, keepUntil: DownloadKeepUntilPolicy) => Promise<void>;
  /**
   * A completed local download's playable source, as a `blob:` URL --
   * `usePlaybackEngine` builds a `"direct"` `NegotiationState` from this
   * with zero player-engine changes (`ShakaPlaybackEngine`'s direct mode is
   * `mediaElement.src = url`). Async because reading the underlying OPFS
   * file (or reassembling the IndexedDB-Blob fallback's chunks) is itself
   * async -- the returned `blob:` URL is cached, so repeat calls for the
   * same media file resolve instantly after the first.
   */
  getLocalPlaybackSource: (mediaFileId: string) => Promise<LocalPlaybackSource | null>;
  /**
   * The signed-in user's own `can_download` grant -- the client-side
   * counterpart to the server's enforcement. `null` until resolved (no
   * signed-in user yet, or the capabilities fetch hasn't completed) --
   * treat `null` the same as `false` for anything that gates rendering a
   * download affordance (nav item, buttons, context-menu action): it is
   * never correct to show download UI before this account's grant is
   * actually known.
   */
  canDownload: boolean | null;
  /**
   * Buffers a watch-progress update in IndexedDB instead of sending it
   * live -- `usePlaybackEngine`'s `persistProgress` calls this when
   * `useOnlineStatus()` is false rather than calling
   * `ApiClient.updateWatchProgress` directly. Flushed automatically once
   * back online (gated on `!authFailed`, same as every other protected
   * call) via `UpdateWatchProgressRequest.occurred_at` so the server
   * timestamps it for when it actually happened, not when it's replayed.
   */
  queueWatchMutation: (params: {
    mediaFileId: string;
    positionMs: number;
    durationMs: number;
    completed?: boolean;
  }) => Promise<void>;
}

const DownloadsContext = createContext<DownloadsContextValue | null>(null);

function activeSummaryFor(downloads: DownloadRecord[]): DownloadsActiveSummary {
  const active = downloads.filter((record) =>
    record.status === "queued" ||
    record.status === "processing" ||
    record.status === "downloading"
  );
  const anyUnknownTotal = active.some((record) => record.totalBytes === null);
  return {
    count: active.length,
    bytesDownloaded: active.reduce((sum, record) => sum + record.bytesDownloaded, 0),
    totalBytes: anyUnknownTotal
      ? null
      : active.reduce((sum, record) => sum + (record.totalBytes ?? 0), 0),
  };
}

function expiryTimeMs(record: DownloadRecord): number | null {
  if (record.keepUntil.type === "forever") return null;
  if (record.keepUntil.type === "date") {
    const parsed = new Date(record.keepUntil.date).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (!record.watchedAt) return null;
  const watchedAtMs = new Date(record.watchedAt).getTime();
  if (!Number.isFinite(watchedAtMs)) return null;
  const unitMs = record.keepUntil.unit === "weeks" ? 7 * DAY_MS : DAY_MS;
  return watchedAtMs + record.keepUntil.amount * unitMs;
}

/**
 * Offline media downloads, following the same per-domain React Context
 * shape every provider in this app uses (see `ApiClientProvider.tsx`).
 * Mounted in `main.tsx` inside `ApiClientProvider`/`ToastProvider` (it
 * needs both -- `useApiClient` for the downloads API, `useToast` for the
 * keep-until expiry sweep's notifications).
 *
 * Owns: the download queue/manifest (persisted via `downloadsDb`, resumed
 * on reload), a 2-at-a-time concurrency-limited engine scheduler
 * (`downloadEngine.runDownload`), ticket polling for profiles still
 * transcoding server-side, the periodic keep-until expiry sweep, and the
 * offline watch-status mutation flush loop.
 */
export function DownloadsProvider({ children }: { children: ReactNode }) {
  const client = useApiClient();
  const userId = useCurrentUserId();
  const [apiBaseUrl] = useApiBaseUrl();
  const { authFailed } = useAuth();
  const { t } = useLanguage();
  const { showToast } = useToast();
  const online = useOnlineStatus();

  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [storageUsage, setStorageUsage] = useState<DownloadsStorageUsage | null>(null);
  const [storageSupported, setStorageSupported] = useState<boolean | null>(null);
  const [downloadStorageAvailable, setDownloadStorageAvailable] = useState<boolean | null>(null);
  const [canDownload, setCanDownload] = useState<boolean | null>(null);

  const downloadsRef = useRef<DownloadRecord[]>([]);
  downloadsRef.current = downloads;
  const activeEngineRunsRef = useRef(new Set<string>());
  const pendingQueueRef = useRef<string[]>([]);
  const pollTimersRef = useRef(new Map<string, number>());
  // Runs a ticket's status check immediately (live `download` events); see `pollTicket`.
  const pollNowRef = useRef(new Map<string, () => void>());
  const blobUrlCacheRef = useRef(new Map<string, LocalPlaybackSource>());
  const loadedScopeRef = useRef<string | null>(null);

  // Preserves the existing array position on update -- appending on every
  // call (the old behaviour) meant a record jumped to the end of the list
  // on every single progress tick, since `onProgress` fires many times a
  // second during an active download. Only a genuinely new id is appended;
  // an update to an id already present is spliced in place, so the list
  // stays ordered by when each item was first added, not by which one most
  // recently changed.
  const upsertRecord = useCallback((record: DownloadRecord) => {
    const existingIndex = downloadsRef.current.findIndex(
      (existing) => existing.id === record.id
    );
    downloadsRef.current =
      existingIndex === -1
        ? [...downloadsRef.current, record]
        : downloadsRef.current.map((existing, index) =>
            index === existingIndex ? record : existing
          );
    setDownloads(downloadsRef.current);
    void putDownload(record);
  }, []);

  const patchRecord = useCallback(
    (id: string, patch: Partial<DownloadRecord>) => {
      const current = downloadsRef.current.find((record) => record.id === id);
      if (!current) return;
      upsertRecord({ ...current, ...patch });
    },
    [upsertRecord]
  );

  const refreshStorageUsage = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
      setStorageSupported(false);
      return;
    }
    navigator.storage
      .estimate()
      .then((estimate) => {
        setStorageSupported(true);
        setStorageUsage({
          usageBytes: estimate.usage ?? 0,
          quotaBytes: estimate.quota ?? 0,
        });
      })
      .catch(() => setStorageSupported(false));
  }, []);

  const clearPoll = useCallback((id: string) => {
    const timer = pollTimersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      pollTimersRef.current.delete(id);
    }
  }, []);

  const scheduleNext = useCallback(() => {
    while (
      activeEngineRunsRef.current.size < MAX_CONCURRENT_DOWNLOADS &&
      pendingQueueRef.current.length > 0
    ) {
      const id = pendingQueueRef.current.shift();
      if (!id) continue;
      const record = downloadsRef.current.find((candidate) => candidate.id === id);
      if (!record || record.status !== "downloading") continue;
      activeEngineRunsRef.current.add(id);

      void (async () => {
        try {
          let storage = record.storage;
          if (!storage) {
            storage = await detectDownloadStorage();
            if (!storage) {
              try {
                await downloadDirectToDevice({
                  fileUrl: client.downloadFileUrl(id),
                  fileName: directDeviceFileName(record.title, record.container),
                  getAccessToken: () => client.getAccessToken(),
                });
                showToast(t("lib.downloads.savedToDeviceToast", { title: record.title }));
                await deleteDownloadRow(id);
                downloadsRef.current = downloadsRef.current.filter(
                  (candidate) => candidate.id !== id
                );
                setDownloads(downloadsRef.current);
              } catch (error) {
                patchRecord(id, {
                  status: "failed",
                  errorMessage:
                    error instanceof Error ? error.message : t("lib.downloads.storageUnsupported"),
                });
              }
              return;
            }
            patchRecord(id, { storage });
          }
          await runDownload(
            {
              id,
              fileUrl: client.downloadFileUrl(id),
              totalBytes: record.totalBytes,
              storage,
              mimeType: record.mimeType,
              getAccessToken: () => client.getAccessToken(),
            },
            {
              onProgress: (bytesDownloaded, totalBytes) => {
                patchRecord(id, {
                  bytesDownloaded,
                  lastCompletedByteOffset: bytesDownloaded,
                  totalBytes: totalBytes ?? record.totalBytes,
                });
              },
              onStatusChange: (status, errorMessage) => {
                if (status === "ready") {
                  patchRecord(id, {
                    status: "ready",
                    readyAt: new Date().toISOString(),
                    errorMessage: null,
                  });
                  refreshStorageUsage();
                } else if (status === "canceled") {
                  patchRecord(id, { status: "canceled", errorMessage: null });
                } else {
                  patchRecord(id, { status: "failed", errorMessage: errorMessage ?? null });
                }
              },
            }
          );
        } finally {
          activeEngineRunsRef.current.delete(id);
          scheduleNext();
        }
      })();
    }
  }, [client, patchRecord, refreshStorageUsage, showToast, t]);

  const beginFetch = useCallback(
    (id: string) => {
      patchRecord(id, { status: "downloading", errorMessage: null });
      if (!pendingQueueRef.current.includes(id)) {
        pendingQueueRef.current.push(id);
      }
      scheduleNext();
    },
    [patchRecord, scheduleNext]
  );

  const pollTicket = useCallback(
    (id: string) => {
      clearPoll(id);
      const tick = () => {
        client
          .getDownload(id)
          .then((ticket) => {
            const record = downloadsRef.current.find((candidate) => candidate.id === id);
            if (!record) return;
            if (ticket.status === "queued" || ticket.status === "processing") {
              patchRecord(id, {
                status: ticketToLocalStatus(ticket),
                totalBytes: ticket.size_bytes ?? record.totalBytes,
              });
              pollTimersRef.current.set(id, window.setTimeout(tick, TICKET_POLL_MS));
              return;
            }
            if (ticket.status === "ready") {
              patchRecord(id, { totalBytes: ticket.size_bytes ?? record.totalBytes });
              beginFetch(id);
              return;
            }
            patchRecord(id, {
              status: ticketToLocalStatus(ticket),
              errorMessage: ticket.error_message,
            });
          })
          .catch(() => {
            // Transient network/server hiccup -- keep polling; the sweep/UI
            // still shows the last-known status in the meantime.
            pollTimersRef.current.set(id, window.setTimeout(tick, TICKET_POLL_MS));
          });
      };
      pollNowRef.current.set(id, () => {
        clearPoll(id);
        tick();
      });
      pollTimersRef.current.set(id, window.setTimeout(tick, TICKET_POLL_MS));
    },
    [beginFetch, client, clearPoll, patchRecord]
  );

  // Keeps each download's series/season/episode/artist/album/type context
  // in sync with the catalog -- a genuine cache (refreshed opportunistically
  // whenever there's a connection), not a value captured once at enqueue
  // time and left to rot. Runs over every currently-loaded record (not just
  // ones flagged as missing data), grouped by `workId` so a series with ten
  // downloaded episodes costs one request, not ten. Called on initial load
  // and again whenever the app regains connectivity (see the `online`
  // effect below) so a long-lived tab that was offline for a while still
  // catches up once it can. Silently skipped per-work on any fetch error
  // (offline mid-pass, or the work was removed from the catalog) -- the
  // last-known-good cached value stays in place either way.
  const refreshDownloadContext = useCallback(async () => {
    if (!navigator.onLine) return;
    const distinctWorkIds = [...new Set(downloadsRef.current.map((record) => record.workId))];
    for (const workId of distinctWorkIds) {
      try {
        const detail = await client.getWork(workId);
        const leaves = playableLeaves(detail, t);
        for (const record of downloadsRef.current) {
          if (record.workId !== workId) continue;
          const leaf = leaves.find((candidate) => candidate.mediaFileId === record.mediaFileId);
          if (!leaf) continue;
          const workKind = leaf.workKind ?? "movie";
          const subtitle = leafSubtitle(leaf) ?? record.subtitle;
          if (record.workKind === workKind && record.subtitle === subtitle) continue;
          patchRecord(record.id, { workKind, subtitle });
        }
      } catch {
        // Offline mid-pass, or the work was removed from the catalog --
        // the existing cached value stays as the last-known-good copy.
      }
    }
  }, [client, patchRecord, t]);

  // Load this profile's persisted downloads and resume anything that was
  // mid-flight (queued/processing ticket polling, or a partially-fetched
  // file) when the tab was last closed.
  useEffect(() => {
    if (!userId) {
      downloadsRef.current = [];
      setDownloads([]);
      return;
    }
    const scope = `${apiBaseUrl}::${userId}`;
    if (loadedScopeRef.current === scope) return;
    loadedScopeRef.current = scope;

    let cancelled = false;
    void listDownloadRows(userId).then((rows) => {
      if (cancelled) return;
      const scoped = rows
        .filter((row) => row.serverUrl === apiBaseUrl)
        .sort(
          (a, b) => new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime()
        );
      downloadsRef.current = scoped;
      setDownloads(scoped);
      for (const record of scoped) {
        if (record.status === "queued" || record.status === "processing") {
          pollTicket(record.id);
        } else if (record.status === "downloading") {
          pendingQueueRef.current.push(record.id);
        }
      }
      scheduleNext();
      void refreshDownloadContext();
    });

    refreshStorageUsage();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally scoped by `apiBaseUrl`/`userId` only; `pollTicket`/`scheduleNext` are stable-enough callbacks re-created per render but not meaningful re-run triggers here.
  }, [apiBaseUrl, userId]);

  // Catches a long-lived tab back up once it regains connectivity, instead
  // of only ever refreshing the context cache at initial page load.
  const wasOnlineRef = useRef(online);
  useEffect(() => {
    if (online && !wasOnlineRef.current) void refreshDownloadContext();
    wasOnlineRef.current = online;
  }, [online, refreshDownloadContext]);

  // The real "can this browser store a managed download at all" signal
  // (OPFS or IndexedDB, via `detectDownloadStorage`) -- distinct from
  // `storageSupported` above, which only reflects the storage-quota-estimate
  // API used for the usage bar. Computed once since browser storage
  // capability doesn't change mid-session, unlike `canDownload`'s
  // server-side grant, which is polled elsewhere in this file.
  useEffect(() => {
    let cancelled = false;
    void detectDownloadStorage().then((storage) => {
      if (!cancelled) setDownloadStorageAvailable(storage !== null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolves the signed-in user's own `can_download` grant so the UI can
  // actually hide download affordances for an account that doesn't have
  // one, instead of only having the underlying request 403 once clicked.
  // Reset to `null` (not `false`) on sign-out/server-change so a brief gap
  // before the next fetch resolves never renders as "confirmed no access".
  // Polls rather than fetching once: an admin can revoke or grant this
  // mid-session (see Users.tsx's toggle), and the nav item/buttons should
  // reflect that within a bounded window without requiring a reload --
  // this is the same "shared, kept-fresh" treatment the requirement asked
  // for; a push mechanism (SSE) would close the gap further but this repo
  // has no SSE infrastructure yet, so polling is the immediate fix.
  // Gated on `!authFailed`, and `authFailed` is a dependency: re-authenticating
  // as the same profile after a session expiry flips `authFailed` true -> false
  // without `userId` ever changing, and this is the only dependency that
  // transition touches -- omitting it left `canDownload` stuck on the
  // fail-closed `false` from the earlier failure until a full page reload.
  const liveAccount = useLiveSubscription({ areas: ["account"] });
  const liveDownloads = useLiveSubscription({ areas: ["downloads"] });
  // A server-side ticket change brings its next status check forward instead of waiting for the timer.
  useEffect(
    () =>
      liveDownloads(() => {
        for (const [id, runNow] of pollNowRef.current) {
          if (pollTimersRef.current.has(id)) runNow();
        }
      }),
    [liveDownloads]
  );

  useEffect(() => {
    if (!userId || authFailed) {
      setCanDownload(null);
      return;
    }
    let cancelled = false;
    setCanDownload(null);

    const fetchCapabilities = () => {
      void client
        .getSelfCapabilities()
        .then((capabilities) => {
          if (!cancelled) setCanDownload(capabilities.can_download);
        })
        .catch(() => {
          // Transient network/server hiccup, or the account genuinely can't
          // stream (StreamingUser extraction itself 403s) -- either way,
          // fail closed rather than showing download UI on an error.
          if (!cancelled) setCanDownload(false);
        });
    };

    fetchCapabilities();
    const interval = window.setInterval(fetchCapabilities, CAPABILITIES_POLL_MS);
    const unsubscribeLive = liveAccount(fetchCapabilities);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      unsubscribeLive();
    };
  }, [apiBaseUrl, authFailed, client, liveAccount, userId]);

  useEffect(
    () => () => {
      for (const timer of pollTimersRef.current.values()) window.clearTimeout(timer);
      pollTimersRef.current.clear();
      for (const url of blobUrlCacheRef.current.values()) URL.revokeObjectURL(url.blobUrl);
      blobUrlCacheRef.current.clear();
    },
    []
  );

  const enqueue = useCallback(
    async (params: EnqueueDownloadParams): Promise<DownloadRecord> => {
      if (!userId) throw new Error(t("lib.downloads.signInRequired"));
      const ticket = await client.createDownload({
        media_file_id: params.mediaFileId,
        quality_id: params.qualityId,
      });
      const record: DownloadRecord = {
        id: ticket.id,
        workId: params.workId,
        workKind: params.workKind,
        mediaFileId: params.mediaFileId,
        userId,
        serverUrl: apiBaseUrl,
        title: params.title,
        subtitle: params.subtitle ?? null,
        qualityId: ticket.quality_id,
        qualityLabel: params.qualityLabel,
        container: ticket.container,
        totalBytes: ticket.size_bytes,
        bytesDownloaded: 0,
        lastCompletedByteOffset: 0,
        status: ticketToLocalStatus(ticket),
        keepUntil: params.keepUntil,
        watchedAt: null,
        errorMessage: ticket.error_message,
        requestedAt: ticket.requested_at,
        readyAt: null,
        storage: null,
        runtimeMs: params.runtimeMs,
        mimeType: mimeTypeForContainer(ticket.container),
      };
      upsertRecord(record);
      if (ticket.status === "ready") {
        beginFetch(record.id);
      } else if (ticket.status === "queued" || ticket.status === "processing") {
        pollTicket(record.id);
      }
      return record;
    },
    [apiBaseUrl, beginFetch, client, pollTicket, t, upsertRecord, userId]
  );

  // Cancelling an in-progress download and deleting a finished one are the
  // same operation from the user's point of view -- there is nothing useful
  // left behind by a cancel, so it performs full cleanup (bytes, server
  // ticket, IndexedDB record, list entry) rather than leaving a "canceled"
  // row that then needs a second, separate delete action.
  const remove = useCallback(
    async (id: string) => {
      clearPoll(id);
      abortDownload(id);
      pendingQueueRef.current = pendingQueueRef.current.filter((candidate) => candidate !== id);
      const record = downloadsRef.current.find((candidate) => candidate.id === id);
      if (record) await deleteStoredBytes(record).catch(() => undefined);
      await client.cancelDownload(id).catch(() => undefined);
      await deleteDownloadRow(id);
      const cached = blobUrlCacheRef.current.get(id);
      if (cached) {
        URL.revokeObjectURL(cached.blobUrl);
        blobUrlCacheRef.current.delete(id);
      }
      downloadsRef.current = downloadsRef.current.filter((candidate) => candidate.id !== id);
      setDownloads(downloadsRef.current);
      refreshStorageUsage();
    },
    [clearPoll, client, refreshStorageUsage]
  );

  const retry = useCallback(
    async (id: string) => {
      const record = downloadsRef.current.find((candidate) => candidate.id === id);
      if (!record) return;
      await remove(id);
      await enqueue({
        workId: record.workId,
        workKind: record.workKind,
        mediaFileId: record.mediaFileId,
        title: record.title,
        subtitle: record.subtitle,
        runtimeMs: record.runtimeMs,
        qualityId: record.qualityId,
        qualityLabel: record.qualityLabel,
        keepUntil: record.keepUntil,
      });
    },
    [enqueue, remove]
  );

  const updateKeepUntil = useCallback(
    async (id: string, keepUntil: DownloadKeepUntilPolicy) => {
      patchRecord(id, { keepUntil });
    },
    [patchRecord]
  );

  const getLocalPlaybackSource = useCallback(
    async (mediaFileId: string): Promise<LocalPlaybackSource | null> => {
      const record = downloadsRef.current.find(
        (candidate) => candidate.mediaFileId === mediaFileId && candidate.status === "ready"
      );
      if (!record) return null;
      const cached = blobUrlCacheRef.current.get(record.id);
      if (cached) return cached;
      const blob = await getPlaybackBlob(record);
      if (!blob) return null;
      const source: LocalPlaybackSource = {
        blobUrl: URL.createObjectURL(blob),
        mimeType: record.mimeType,
        durationSeconds: record.runtimeMs / 1000,
      };
      blobUrlCacheRef.current.set(record.id, source);
      return source;
    },
    []
  );

  const queueWatchMutation = useCallback(
    async (params: {
      mediaFileId: string;
      positionMs: number;
      durationMs: number;
      completed?: boolean;
    }) => {
      if (!userId) return;
      const mutation: QueuedWatchMutation = {
        id: `${params.mediaFileId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        userId,
        serverUrl: apiBaseUrl,
        mediaFileId: params.mediaFileId,
        positionMs: params.positionMs,
        durationMs: params.durationMs,
        completed: params.completed,
        occurredAt: new Date().toISOString(),
      };
      await putQueuedWatchMutation(mutation);
    },
    [apiBaseUrl, userId]
  );

  // Flushes offline-buffered watch-progress mutations (`queueWatchMutation`)
  // through the normal API client once back online. Gated on `!authFailed`
  // like every other protected call -- flushing into a session that's
  // already known to have nothing left to fall back on would just queue
  // the same failure over and over.
  useEffect(() => {
    if (!userId || !online || authFailed) return;
    let cancelled = false;

    const flush = createProgressQueueFlusher({
      list: () => listQueuedWatchMutations(userId),
      send: (mutation) =>
        client.updateWatchProgress(mutation.mediaFileId, {
          positionMs: mutation.positionMs,
          durationMs: mutation.durationMs,
          completed: mutation.completed,
          occurredAt: mutation.occurredAt,
        }),
      remove: deleteQueuedWatchMutation,
      serverUrl: apiBaseUrl,
      isCancelled: () => cancelled,
    });

    void flush();
    const interval = window.setInterval(() => void flush(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [apiBaseUrl, authFailed, client, online, userId]);

  // Keep-until expiry sweep. Runs on its own interval: it needs the latest
  // known watched state to resolve an "after-watched" policy, which is
  // exactly what the flush loop above keeps current server-side (a queued
  // offline "mark watched" already counts locally before it's reached the
  // server, via `queuedMutations` below).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const sweep = async () => {
      const [queuedMutations, serverProgress] = await Promise.all([
        listQueuedWatchMutations(userId),
        online ? client.listWatchProgress().catch(() => []) : Promise.resolve([]),
      ]);
      if (cancelled) return;
      const watchedMediaFileIds = new Set<string>();
      for (const progress of serverProgress) {
        if (progress.state === "watched") watchedMediaFileIds.add(progress.media_file_id);
      }
      for (const mutation of queuedMutations) {
        if (mutation.completed) watchedMediaFileIds.add(mutation.mediaFileId);
      }

      const now = Date.now();
      for (const record of downloadsRef.current) {
        if (
          record.watchedAt === null &&
          record.keepUntil.type === "after-watched" &&
          watchedMediaFileIds.has(record.mediaFileId)
        ) {
          patchRecord(record.id, { watchedAt: new Date().toISOString() });
        }
      }
      for (const record of downloadsRef.current) {
        if (record.status !== "ready") continue;
        const expiresAt = expiryTimeMs(record);
        if (expiresAt === null || now < expiresAt) continue;
        await deleteStoredBytes(record).catch(() => undefined);
        await client.cancelDownload(record.id).catch(() => undefined);
        await deleteDownloadRow(record.id);
        downloadsRef.current = downloadsRef.current.filter(
          (candidate) => candidate.id !== record.id
        );
        setDownloads(downloadsRef.current);
        showToast(t("lib.downloads.expiredToast", { title: record.title }));
      }
      refreshStorageUsage();
    };

    let sweeping = false;
    const guardedSweep = async () => {
      if (sweeping) return;
      sweeping = true;
      try {
        await sweep();
      } catch {
        // Storage unavailable: try again on the next tick.
      } finally {
        sweeping = false;
      }
    };
    void guardedSweep();
    const interval = window.setInterval(() => void guardedSweep(), EXPIRY_SWEEP_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [client, online, patchRecord, refreshStorageUsage, showToast, t, userId]);

  const activeSummary = useMemo(() => activeSummaryFor(downloads), [downloads]);

  const value = useMemo<DownloadsContextValue>(
    () => ({
      downloads,
      activeSummary,
      storageUsage,
      storageSupported,
      downloadStorageAvailable,
      enqueue,
      retry,
      remove,
      updateKeepUntil,
      getLocalPlaybackSource,
      queueWatchMutation,
      canDownload,
    }),
    [
      activeSummary,
      canDownload,
      downloadStorageAvailable,
      downloads,
      enqueue,
      getLocalPlaybackSource,
      queueWatchMutation,
      remove,
      retry,
      storageSupported,
      storageUsage,
      updateKeepUntil,
    ]
  );

  return <DownloadsContext.Provider value={value}>{children}</DownloadsContext.Provider>;
}

export function useDownloads(): DownloadsContextValue {
  const value = useContext(DownloadsContext);
  if (!value) {
    throw new Error("useDownloads() must be called within a <DownloadsProvider>.");
  }
  return value;
}
