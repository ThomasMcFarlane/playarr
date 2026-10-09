import { useEffect, useRef, useState } from "react";
import { createSettled } from "../../lib/settled";

/** The text is announced once it has stopped changing, so holding Next does not read out every period. */
export const RANGE_ANNOUNCE_DELAY_MS = 700;

/**
 * A polite live region that speaks `text` only after it has stopped changing for {@link RANGE_ANNOUNCE_DELAY_MS}.
 * It starts as the current text, so the first render is not announced. It sits beside the control it describes,
 * never inside it, so the control's own name is not read twice.
 */
export function SettledAnnouncer({ text }: { text: string }) {
  const [announced, setAnnounced] = useState(text);
  const settledRef = useRef<ReturnType<typeof createSettled<string>> | null>(null);
  settledRef.current ??= createSettled<string>(RANGE_ANNOUNCE_DELAY_MS, setAnnounced);
  useEffect(() => {
    const settled = settledRef.current!;
    settled.push(text);
    return settled.cancel;
  }, [text]);
  return (
    <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-settled-announcer>
      {announced}
    </span>
  );
}
