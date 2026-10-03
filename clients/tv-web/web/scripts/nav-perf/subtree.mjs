// Usage: node subtree.mjs <file.cpuprofile> <rootFunctionRegex> [top]
// Self time per function restricted to the call subtrees whose root frame matches.
import { readFileSync } from "node:fs";
const profile = JSON.parse(readFileSync(process.argv[2], "utf8"));
const rootRe = new RegExp(process.argv[3]);
const top = Number(process.argv[4] ?? 30);
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const self = new Map();
profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
const agg = new Map();
let total = 0;
for (const [id, us] of self) {
  let inside = false;
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    if (rootRe.test(byId.get(cur).callFrame.functionName)) { inside = true; break; }
  }
  if (!inside) continue;
  const cf = byId.get(id).callFrame;
  const key = `${cf.functionName || "(anon)"} ${cf.url.split("/").pop()}:${cf.lineNumber + 1}`;
  agg.set(key, (agg.get(key) ?? 0) + us);
  total += us;
}
console.log(`subtree total ${(total / 1000).toFixed(0)} ms`);
for (const [k, us] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${(us / 1000).toFixed(0).padStart(7)} ms  ${k}`);
