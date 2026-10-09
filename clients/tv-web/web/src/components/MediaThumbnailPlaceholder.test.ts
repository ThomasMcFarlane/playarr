import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { placeholderInitials } from "./MediaThumbnailArtwork";

describe("media art placeholder", () => {
  it("takes up to two initials from a title", () => {
    expect(placeholderInitials("Sample Album Name")).toBe("SA");
    expect(placeholderInitials("single")).toBe("S");
    expect(placeholderInitials("  ")).toBe("");
    expect(placeholderInitials("Épreuve 2")).toBe("É2");
  });

  it("uses design tokens only, so both themes work", () => {
    const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");
    const rule = /\.media-art-placeholder \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toContain("var(--surface-soft)");
    expect(rule).toContain("var(--ink-muted)");
    expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
