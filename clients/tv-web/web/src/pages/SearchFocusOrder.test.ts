import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("TV search focus order (rows 53, 174)", () => {
  const search = read("./Search.tsx");

  it("registers Filters in the shell action column instead of an inline pill (audit R7)", () => {
    expect(search).toMatch(/kind: "filters"/);
    expect(search).toContain("<FiltersDrawer");
    expect(search).not.toContain("tv-search-filter-toggle");
    expect(search).not.toContain("filterButtonRef");
  });

  it("sends Down from Back to the field and lets Down from the field fall to the results", () => {
    expect(search).toMatch(/function handleBackKeyDown[\s\S]*?inputRef\.current\?\.focus/);
    const input = search.slice(search.indexOf("function handleInputKeyDown"), search.indexOf("function handleBackKeyDown"));
    expect(input).not.toContain("ArrowDown");
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
