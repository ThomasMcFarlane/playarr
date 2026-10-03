// Usage: node task-tree.mjs <trace.json> <rank> [minMs]
// Prints the nested event tree of the Nth-longest main-thread RunTask.
import { readFileSync } from "node:fs";
const raw = JSON.parse(readFileSync(process.argv[2], "utf8"));
const list = Array.isArray(raw) ? raw : raw.traceEvents;
const rank = Number(process.argv[3] ?? 1) - 1;
const minUs = Number(process.argv[4] ?? 4) * 1000;
const main = new Set(list.filter((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain").map((e) => `${e.pid}:${e.tid}`));
const evs = list.filter((e) => e.ph === "X" && main.has(`${e.pid}:${e.tid}`)).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
const task = evs.filter((e) => e.name === "RunTask").sort((a, b) => b.dur - a.dur)[rank];
console.log(`task ${(task.dur / 1000).toFixed(0)} ms`);
const inner = evs.filter((e) => e !== task && e.ts >= task.ts && e.ts + e.dur <= task.ts + task.dur && e.dur >= minUs);
const stack = [];
for (const e of inner) {
  while (stack.length && stack[stack.length - 1] <= e.ts) stack.pop();
  const d = e.args?.data ?? {};
  const extra = d.functionName ? ` ${d.functionName}` : d.type ? ` [${d.type}]` : d.elementCount ? ` elements=${d.elementCount}` : "";
  console.log(`${"  ".repeat(stack.length)}${(e.dur / 1000).toFixed(1)} ${e.name}${extra}`);
  stack.push(e.ts + e.dur);
}
