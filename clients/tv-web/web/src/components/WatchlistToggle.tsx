import { useEffect, useState } from "react";
import { describeApiError, type TitleSnapshot } from "@playarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useLanguage } from "../lib/i18n/LanguageProvider";

/**
 * Add/remove a title on the signed-in profile's watchlist. The server owns
 * identity (`title_key`), so the toggle resolves the snapshot first to learn
 * whether it is already listed, and uses the key the server returns.
 */
export function WatchlistToggle({
  snapshot,
  initialListed,
  className,
  focusKey,
}: {
  snapshot: TitleSnapshot;
  /** Skip the resolve round trip when the caller already knows (discovery results). */
  initialListed?: boolean;
  className?: string;
  focusKey?: string;
}) {
  const { t } = useLanguage();
  const client = useApiClient();
  const [listed, setListed] = useState<boolean | null>(initialListed ?? null);
  const [titleKey, setTitleKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const snapshotId = `${snapshot.kind}:${snapshot.work_id ?? ""}:${snapshot.title}:${snapshot.year ?? ""}`;

  useEffect(() => {
    let cancelled = false;
    setListed(initialListed ?? null);
    setTitleKey(null);
    setError(null);
    void client
      .resolveTitle(snapshot)
      .then((resolved) => {
        if (cancelled) return;
        setListed(resolved.in_watchlist);
        setTitleKey(resolved.title.title_key);
      })
      .catch(() => {
        // Unknown state: keep the button usable; the mutation reports errors.
        if (!cancelled && initialListed === undefined) setListed(false);
      });
    return () => {
      cancelled = true;
    };
    // `snapshot` is rebuilt every render by callers; `snapshotId` is its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, snapshotId]);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (listed) {
        let key = titleKey;
        if (!key) key = (await client.resolveTitle(snapshot)).title.title_key;
        await client.removeFromWatchlist(key);
        setListed(false);
      } else {
        const added = await client.addToWatchlist(snapshot);
        setTitleKey(added.title.title_key);
        setListed(true);
      }
    } catch (failure) {
      setError(describeApiError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={className ?? "tv-watchlist-toggle"}
        aria-pressed={listed === true}
        disabled={busy || listed === null}
        data-navigation-focus-key={focusKey}
        onClick={() => void toggle()}
      >
        <span aria-hidden="true">{listed ? "✓" : "+"}</span>
        <strong>
          {listed ? t("discovery.watchlist.remove") : t("discovery.watchlist.add")}
        </strong>
      </button>
      {error ? (
        <span className="tv-watchlist-error" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
