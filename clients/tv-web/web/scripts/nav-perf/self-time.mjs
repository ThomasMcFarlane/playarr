// Usage: node self-time.mjs <trace.json> [top]
// Main-thread self time per trace event name (duration minus nested events).
import { readFileSync } from "node:fs";
const raw = JSON.parse(readFileSync(process.argv[2], "utf8"));
const list = Array.isArray(raw) ? raw : raw.traceEvents;
const top = Number(process.argv[3] ?? 30);
const main = new Set(list.filter((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain").map((e) => `${e.pid}:${e.tid}`));
const evs = list.filter((e) => e.ph === "X" && main.has(`${e.pid}:${e.tid}`)).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
const self = new Map();
const stack = [];
for (const e of evs) {
  while (stack.length && stack[stack.length - 1].end <= e.ts) stack.pop();
  if (stack.length) stack[stack.length - 1].child += e.dur;
  const node = { e, end: e.ts + e.dur, child: 0 };
  stack.push(node);
  node.done = () => {
    const k = e.name;
    self.set(k, (self.get(k) ?? 0) + (e.dur - node.child));
  };
  e.__node = node;
}
for (const e of evs) e.__node.done();
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log(`main-thread self time total ${(total / 1000).toFixed(0)} ms`);
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${(v / 1000).toFixed(1).padStart(9)} ms  ${k}`);
