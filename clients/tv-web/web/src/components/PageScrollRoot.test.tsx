import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageScrollRoot } from "./PageScrollRoot";

describe("PageScrollRoot", () => {
  it("marks the shared page viewport as a native vertical scroll container", () => {
    const markup = renderToStaticMarkup(
      <PageScrollRoot scrollKey="page:/settings">
        <div>Settings</div>
      </PageScrollRoot>
    );

    expect(markup).toContain('class="app-main"');
    expect(markup).toContain('data-tv-scroll-container="true"');
    expect(markup).toContain('data-tv-scroll-axis="vertical"');
    expect(markup).toContain('data-navigation-scroll-key="page:/settings"');
  });

  it("keeps the shared page viewport natively scrollable", () => {
    const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");
    const nativeScrollRule = css.match(
      /\.app-main\[data-tv-scroll-container\]\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;
    const unqualifiedRules = Array.from(
      css.matchAll(/^\.app-main\s*\{(?<declarations>[^}]*)\}/gm)
    );

    expect(nativeScrollRule).toContain("overflow-x: hidden");
    expect(nativeScrollRule).toContain("overflow-y: auto");
    expect(
      unqualifiedRules.some((rule) =>
        /overflow:\s*hidden/.test(rule.groups?.declarations ?? "")
      )
    ).toBe(false);
  });
});
