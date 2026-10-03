// Usage: node long-tasks.mjs <trace.json> [minMs]
// Lists the longest main-thread (CrRendererMain) tasks with the notable
// events nested inside, to show *what* a slow key press spent its time on.
import { readFileSync } from "node:fs";
const events = JSON.parse(readFileSync(process.argv[2], "utf8"));
const list = Array.isArray(events) ? events : events.traceEvents;
const min = Number(process.argv[3] ?? 40) * 1000;
const mainTids = new Set(list.filter((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain").map((e) => `${e.pid}:${e.tid}`));
const byThread = new Map();
for (const e of list) {
  if (e.ph !== "X" || !mainTids.has(`${e.pid}:${e.tid}`)) continue;
  (byThread.get(e.tid) ?? byThread.set(e.tid, []).get(e.tid)).push(e);
}
for (const [tid, evs] of byThread) {
  evs.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const tasks = evs.filter((e) => e.name === "RunTask" && e.dur >= min);
  for (const t of tasks.sort((a, b) => b.dur - a.dur).slice(0, 25)) {
    const inner = evs.filter((e) => e !== t && e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur && e.dur > 3000 && e.name !== "RunTask");
    const agg = new Map();
    for (const e of inner) {
      const k = e.name + (e.args?.data?.functionName ? `(${e.args.data.functionName})` : e.args?.data?.type ? `[${e.args.data.type}]` : "");
      agg.set(k, Math.max(agg.get(k) ?? 0, e.dur / 1000));
    }
    console.log(`${(t.dur / 1000).toFixed(0).padStart(6)} ms @${((t.ts - evs[0].ts) / 1000).toFixed(0)}  ${[...agg].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(" | ")}`);
  }
}
