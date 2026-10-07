/** The signed-in profile's household state, refreshed every 30 s and on demand (the web's `useHouseholdStatus`). */
import {useCallback, useEffect, useState} from 'react';
import type {ApiClient, HouseholdStatus} from '@playarr-tv/api-client';

const POLL_MS = 30_000;

export function useHouseholdStatus(client: ApiClient, refreshKey: string): {status: HouseholdStatus | null; refresh: () => void} {
  const [status, setStatus] = useState<HouseholdStatus | null>(null);
  const refresh = useCallback(() => {
    client
      .getHouseholdStatus()
      .then(setStatus)
      // A failed fetch keeps the last known state: the server enforces the block regardless.
      .catch(() => undefined);
  }, [client]);
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);
  // A screen change re-checks promptly, so a spent budget is noticed on the next navigation.
  useEffect(refresh, [refresh, refreshKey]);
  return {status, refresh};
}
