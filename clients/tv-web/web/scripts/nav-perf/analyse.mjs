// Summarise a V8 cpuprofile (self time per function) and a Chrome trace
// (rendering/script cost per event name) into short text tables.

export function summariseCpuProfile(profile, top = 25) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const deltas = profile.timeDeltas;
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (deltas[i] ?? 0)));
  const byFn = new Map();
  let total = 0;
  for (const [id, us] of self) {
    const n = byId.get(id);
    const cf = n.callFrame;
    const name = cf.functionName || "(anonymous)";
    const key = `${name} ${cf.url.split("/").pop()}:${cf.lineNumber + 1}`;
    byFn.set(key, (byFn.get(key) ?? 0) + us);
    total += us;
  }
  const rows = [...byFn].sort((a, b) => b[1] - a[1]).slice(0, top);
  const text = [`CPU self time (total ${(total / 1000).toFixed(0)} ms sampled)`, ...rows.map(([k, us]) => `  ${(us / 1000).toFixed(1).padStart(8)} ms  ${k}`)].join("\n");
  return { rows, total, text };
}

const INTERESTING = new Set([
  "FunctionCall", "EvaluateScript", "UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Layerize", "Commit",
  "RunTask", "ParseHTML", "ImageDecodeTask", "Decode Image", "Draw LazyPixelRef", "HitTest", "ScheduleStyleRecalculation",
  "UpdateLayer", "CompositeLayers", "RasterTask", "GPUTask", "MinorGC", "MajorGC", "V8.GC_MC_BACKGROUND_MARKING", "TimerFire", "EventDispatch", "RunMicrotasks", "FireAnimationFrame",
]);

export function summariseTrace(trace) {
  const events = Array.isArray(trace) ? trace : trace.traceEvents;
  const sums = new Map();
  for (const e of events) {
    if (e.ph !== "X" || !INTERESTING.has(e.name)) continue;
    const s = sums.get(e.name) ?? { ms: 0, n: 0 };
    s.ms += (e.dur ?? 0) / 1000;
    s.n += 1;
    sums.set(e.name, s);
  }
  const rows = [...sums].sort((a, b) => b[1].ms - a[1].ms);
  const text = ["Trace event wall time (nested events overlap)", ...rows.map(([k, v]) => `  ${v.ms.toFixed(1).padStart(8)} ms  x${String(v.n).padStart(5)}  ${k}`)].join("\n");
  return { rows, text };
}
