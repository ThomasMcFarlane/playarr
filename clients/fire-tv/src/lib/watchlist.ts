/** The detail page's Add to watchlist toggle: the web's `WatchlistToggle`, as a hook. */
import {useCallback, useEffect, useState} from 'react';
import type {TitleSnapshot, Work} from '@playarr-tv/api-client';

export function snapshotFromWork(work: Work): TitleSnapshot {
  const poster = work.images.find((image) => image.kind === 'poster');
  return {
    kind: work.kind,
    title: work.title,
    year: work.release_date ? new Date(work.release_date).getUTCFullYear() : null,
    work_id: work.id,
    external_refs: work.external_refs,
    poster_url: poster?.url ?? null,
  };
}

export interface WatchlistClient {
  resolveTitle(snapshot: TitleSnapshot): Promise<{in_watchlist: boolean; title: {title_key: string}}>;
  addToWatchlist(snapshot: TitleSnapshot): Promise<{title: {title_key: string}}>;
  removeFromWatchlist(titleKey: string): Promise<void>;
}

export function useWatchlistToggle(client: WatchlistClient, snapshot: TitleSnapshot | null): {listed: boolean | null; busy: boolean; toggle: () => void} {
  const [listed, setListed] = useState<boolean | null>(null);
  const [titleKey, setTitleKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const identity = snapshot ? `${snapshot.kind}:${snapshot.work_id ?? ''}:${snapshot.title}:${snapshot.year ?? ''}` : '';

  useEffect(() => {
    let cancelled = false;
    setListed(null);
    setTitleKey(null);
    if (!snapshot) return undefined;
    client
      .resolveTitle(snapshot)
      .then((resolved) => {
        if (cancelled) return;
        setListed(resolved.in_watchlist);
        setTitleKey(resolved.title.title_key);
      })
      .catch(() => {
        if (!cancelled) setListed(false);
      });
    return () => {
      cancelled = true;
    };
    // `snapshot` is rebuilt on every render; `identity` is what names it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, identity]);

  const toggle = useCallback(() => {
    if (busy || listed === null || !snapshot) return;
    setBusy(true);
    const run = async (): Promise<void> => {
      if (listed) {
        const key = titleKey ?? (await client.resolveTitle(snapshot)).title.title_key;
        await client.removeFromWatchlist(key);
        setListed(false);
      } else {
        const added = await client.addToWatchlist(snapshot);
        setTitleKey(added.title.title_key);
        setListed(true);
      }
    };
    run()
      .catch(() => undefined)
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, client, listed, titleKey, identity]);

  return {listed, busy, toggle};
}
