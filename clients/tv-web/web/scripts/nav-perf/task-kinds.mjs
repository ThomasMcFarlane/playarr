// Usage: node task-kinds.mjs <trace.json>
// Groups main-thread RunTasks by their dominant child event, summing time and
// count, to show which kinds of task consume the thread during navigation.
import { readFileSync } from "node:fs";
const raw = JSON.parse(readFileSync(process.argv[2], "utf8"));
const list = Array.isArray(raw) ? raw : raw.traceEvents;
const main = new Set(list.filter((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain").map((e) => `${e.pid}:${e.tid}`));
const evs = list.filter((e) => e.ph === "X" && main.has(`${e.pid}:${e.tid}`)).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
const tasks = evs.filter((e) => e.name === "RunTask");
const groups = new Map();
let ti = 0;
for (const t of tasks) {
  const kids = evs.filter((e) => e !== t && e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur && e.name !== "RunTask");
  // direct children: not contained in another kid
  const direct = kids.filter((k) => !kids.some((o) => o !== k && o.ts <= k.ts && o.ts + o.dur >= k.ts + k.dur && (o.ts !== k.ts || o.dur > k.dur)));
  const top = direct.sort((a, b) => b.dur - a.dur)[0];
  let label = top ? top.name : "(empty)";
  if (top?.name === "EventDispatch") label += `[${top.args?.data?.type}]`;
  if (top?.name === "FunctionCall") label += `(${top.args?.data?.functionName || top.args?.data?.url?.split("/").pop() || "?"})`;
  if (top?.name === "TimerFire" || top?.name === "FireAnimationFrame") label += "";
  const g = groups.get(label) ?? { ms: 0, n: 0 };
  g.ms += t.dur / 1000;
  g.n += 1;
  groups.set(label, g);
}
for (const [k, v] of [...groups].sort((a, b) => b[1].ms - a[1].ms).slice(0, 25)) console.log(`${v.ms.toFixed(0).padStart(7)} ms  x${String(v.n).padStart(4)}  ${k}`);
