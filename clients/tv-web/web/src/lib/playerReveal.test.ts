import { describe, expect, it } from "vitest";
import { createRevealGate } from "./playerReveal";

describe("createRevealGate", () => {
  it("does not toggle when the input began with the controls hidden", () => {
    const gate = createRevealGate();
    gate.begin(false);
    // Pointer-down / key-down reveal the controls before the click lands.
    expect(gate.finish(true)).toBe(false);
  });

  it("toggles when the controls were already visible", () => {
    const gate = createRevealGate();
    gate.begin(true);
    expect(gate.finish(true)).toBe(true);
  });

  it("only blocks the one input that revealed, the next one toggles", () => {
    const gate = createRevealGate();
    gate.begin(false);
    expect(gate.finish(true)).toBe(false);
    gate.begin(true);
    expect(gate.finish(true)).toBe(true);
  });

  it("falls back to current visibility when no input began (synthetic click)", () => {
    const gate = createRevealGate();
    expect(gate.finish(true)).toBe(true);
    expect(gate.finish(false)).toBe(false);
  });
});
