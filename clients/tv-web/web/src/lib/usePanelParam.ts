import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/** Open side panel kept in the URL (`?panel=filters`), so refresh, back and deep links restore it. */
export function usePanelParam<T extends string>(allowed: readonly T[]): [T | null, (next: T | null) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("panel");
  const panel = raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
  const setPanel = useCallback(
    (next: T | null) => {
      setParams(
        (current) => {
          const out = new URLSearchParams(current);
          if (next) out.set("panel", next);
          else out.delete("panel");
          return out;
        },
        { replace: true }
      );
    },
    [setParams]
  );
  return [panel, setPanel];
}
