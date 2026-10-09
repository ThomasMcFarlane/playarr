import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const css = read("./Calendar.css");
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("calendar stylesheet", () => {
  const sources = ["./Calendar.tsx", "../components/CalendarLink.tsx", "../components/shell/PeriodPicker.tsx"]
    .map(read)
    .join("\n");

  it("styles only classes some component renders", () => {
    const classes = new Set([...code.matchAll(/\.((?:calendar|period-picker)-[a-z-]+)/g)].map((m) => m[1]!));
    const unused = [...classes].filter((name) => {
      if (sources.includes(name)) return false;
      // Variant classes built from a state: `calendar-badge-${state}`, `calendar-availability-${...}`.
      const stem = name.slice(0, name.lastIndexOf("-") + 1);
      return !sources.includes(`${stem}\${`);
    });
    expect(unused).toEqual([]);
  });

  it("has no hard-coded colours or stray layers: tokens and the layer scale only", () => {
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/rgba?\(/);
    for (const [, value] of code.matchAll(/z-index:\s*([^;]+);/g)) {
      expect(value).toMatch(/^(var\(--z-[a-z]+\)|-?\d)$/);
    }
  });

  it("gives the body frame one rule: it does not scroll, the viewports inside it do", () => {
    const rules = [...code.matchAll(/(^|\})\s*\.calendar-scroll\s*\{/g)];
    expect(rules).toHaveLength(1);
  });
});
