import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TvDetailHeading } from "./TvStage";

describe("TvDetailHeading", () => {
  it("renders the collection and selected item around a visible pipe", () => {
    const markup = renderToStaticMarkup(
      <TvDetailHeading
        backLabel="Back to Music"
        sectionTitle="Music"
        itemTitle="Sample Band Two"
        onBack={() => undefined}
      />
    );

    expect(markup).toContain("<h1>Music</h1>");
    expect(markup).toContain('class="tv-detail-heading-item"');
    expect(markup).toContain('<i aria-hidden="true">|</i>');
    expect(markup).toContain("<strong>Sample Band Two</strong>");
  });
});
