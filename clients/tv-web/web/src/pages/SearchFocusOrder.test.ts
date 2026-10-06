import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("TV search focus order (rows 53, 174)", () => {
  const search = read("./Search.tsx");

  it("sends Up from Filters to the search field, not Back", () => {
    const handler = search.match(
      /function handleFilterKeyDown[\s\S]*?\n  }\n/
    )?.[0];
    expect(handler).toContain('event.key !== "ArrowUp"');
    expect(handler).toContain("inputRef.current?.focus");
    expect(handler).not.toContain("backButtonRef");
  });

  it("sends Down from Back to the field and from the field to Filters", () => {
    expect(search).toMatch(/function handleBackKeyDown[\s\S]*?inputRef\.current\?\.focus/);
    expect(search).toMatch(/ArrowDown[\s\S]*?filterButtonRef\.current\?\.focus/);
  });
});

describe("TV cards open on the first Enter/OK (rows 53, 174)", () => {
  const menu = read("../components/MediaContextMenu.tsx");
  const nav = read("../lib/useTvNavigation.ts");

  it("activates the card on the release of a short confirm without a prior select", () => {
    const keyUp = menu.match(/onKeyUp: \(event: KeyboardEvent<HTMLElement>\) => \{[\s\S]*?\n      \},\n/)?.[0];
    expect(keyUp).toContain("event.currentTarget.click()");
  });

  it("commits virtual remote focus and re-dispatches the confirm key to the visible card", () => {
    expect(nav).toContain('window.addEventListener("keydown", commitVirtualFocusBeforeConfirm, true)');
    expect(nav).toMatch(/virtual\.focus\(\{ preventScroll: true \}\);[\s\S]*?virtual\.dispatchEvent\(redispatched\)/);
  });
});
