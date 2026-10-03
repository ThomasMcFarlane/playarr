import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A missing `}` silently nests every later rule inside the unclosed block
 * (once, a media query hid the phone-remote styles and the remote-navigation
 * rules on wide screens), and the build only prints a minifier warning.
 */
function unclosedBlockLines(css: string): number[] {
  const stripped = css
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => "\n".repeat(comment.split("\n").length - 1))
    .replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""');
  const stack: number[] = [];
  let line = 1;
  for (const character of stripped) {
    if (character === "\n") line += 1;
    else if (character === "{") stack.push(line);
    else if (character === "}") {
      if (stack.length === 0) return [-line];
      stack.pop();
    }
  }
  return stack;
}

describe("global.css", () => {
  const css = readFileSync(new URL("./global.css", import.meta.url), "utf8");

  it("has balanced braces", () => {
    expect(unclosedBlockLines(css)).toEqual([]);
  });

  it("detects an unclosed block", () => {
    expect(unclosedBlockLines("@media (min-width: 1px) {\n.a { color: red; }\n.b { color: blue; }\n")).toEqual([1]);
    expect(unclosedBlockLines('.a::after { content: "}"; }\n')).toEqual([]);
  });
});
