import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SearchableMultiSelect,
  filterMultiSelectOptions,
  mergeSearchableMultiSelectOptions,
  multiSelectSearchHandlesKey,
  toggleMultiSelectValue,
} from "./SearchableMultiSelect";

describe("SearchableMultiSelect helpers", () => {
  it("never lets fallback labels overwrite known labels", () => {
    expect(
      mergeSearchableMultiSelectOptions(
        [{ value: "peer-a", label: "Living room" }],
        [{ value: "peer-a", label: "peer-a" }]
      )
    ).toEqual([{ value: "peer-a", label: "Living room" }]);
  });

  it("filters labels, descriptions, and values case-insensitively", () => {
    const options = [
      {
        value: "peer-a",
        label: "Living room",
        description: "This server",
      },
      { value: "peer-b", label: "Office" },
    ];

    expect(filterMultiSelectOptions(options, "THIS")).toEqual([options[0]]);
    expect(filterMultiSelectOptions(options, "PEER-B")).toEqual([options[1]]);
  });

  it("toggles selections and leaves arrow keys to native navigation", () => {
    expect(toggleMultiSelectValue(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleMultiSelectValue(["a", "b"], "a")).toEqual(["b"]);
    expect(multiSelectSearchHandlesKey("Enter")).toBe(true);
    expect(multiSelectSearchHandlesKey("Escape")).toBe(true);
    expect(multiSelectSearchHandlesKey("ArrowUp")).toBe(false);
    expect(multiSelectSearchHandlesKey("ArrowDown")).toBe(false);
  });
});

describe("SearchableMultiSelect accessibility", () => {
  it("connects the trigger summary, search field, and native scroll viewport", () => {
    const markup = renderToStaticMarkup(
      <SearchableMultiSelect
        id="servers"
        label="Connected server"
        options={[{ value: "peer-a", label: "Living room" }]}
        values={["peer-a"]}
        onChange={() => undefined}
        openByDefault
      />
    );

    expect(markup).toContain(
      'aria-labelledby="servers-label servers-summary"'
    );
    expect(markup).toContain('id="servers-summary"');
    expect(markup).toContain('aria-controls="servers-options"');
    expect(markup).toContain('aria-busy="false"');
    expect(markup).toContain("data-tv-scroll-container");
    expect(markup).toContain('data-tv-scroll-axis="vertical"');
    expect(markup).toContain("Living room");
  });
});
