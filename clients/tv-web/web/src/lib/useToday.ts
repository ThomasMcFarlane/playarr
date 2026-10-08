import { useEffect, useState } from "react";
import { localDayOf, watchLocalDay, type Day } from "./calendar";

/** The viewer's local day, kept current past midnight and after the tab wakes. */
export function useToday(): Day {
  const [today, setToday] = useState<Day>(() => localDayOf(new Date()));
  useEffect(() => {
    const watcher = watchLocalDay(setToday);
    const onVisible = () => {
      if (document.visibilityState === "visible") watcher.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    watcher.refresh();
    return () => {
      watcher.cancel();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return today;
}
