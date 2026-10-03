// Usage: node inclusive.mjs <file.cpuprofile> [top] [filterRegex]
// Inclusive (self + callees) time per function from a V8 cpuprofile.
import { readFileSync } from "node:fs";
const profile = JSON.parse(readFileSync(process.argv[2], "utf8"));
const top = Number(process.argv[3] ?? 30);
const filter = process.argv[4] ? new RegExp(process.argv[4]) : null;
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const selfById = new Map();
profile.samples.forEach((id, i) => selfById.set(id, (selfById.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
const incl = new Map();
for (const [id, us] of selfById) {
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const cf = byId.get(cur).callFrame;
    const key = `${cf.functionName || "(anon)"} ${cf.url.split("/").pop()}:${cf.lineNumber + 1}`;
    if (seen.has(key)) continue;
    seen.add(key);
    incl.set(key, (incl.get(key) ?? 0) + us);
  }
}
for (const [k, us] of [...incl].filter(([k]) => !filter || filter.test(k)).sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${(us / 1000).toFixed(0).padStart(7)} ms  ${k}`);
