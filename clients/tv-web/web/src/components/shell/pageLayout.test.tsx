import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { parseHarnessActions } from "../../pages/LayoutHarness";
import { ActionPill, PageActions, PageLayout, ScrollArea, orderPageActions, type PageAction } from "./index";

const noop = () => undefined;
const render = (node: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

const filters: PageAction = { kind: "filters", label: "Filters", open: false, onToggle: noop, controls: "f", activeCount: 2 };
const bell: PageAction = { kind: "panel", id: "bell", label: "Calendar subscription", icon: "bell", open: false, onToggle: noop, controls: "p" };
const customise: PageAction = { kind: "link", id: "customise", label: "Customise Home", icon: "customise", to: "/customise-home" };
const navigation: PageAction = {
  kind: "navigation",
  id: "nav",
  label: "Navigation",
  items: [
    { id: "prev", label: "Previous", icon: "prev", onSelect: noop },
    { id: "today", label: "Today", onSelect: noop },
    { id: "next", label: "Next", icon: "next", onSelect: noop },
  ],
};

describe("PageActions", () => {
  it("draws navigation first, secondary pills in the order given, and Filters last, whatever order it is handed", () => {
    expect(orderPageActions([filters, bell, navigation, customise]).map((action) => action.kind)).toEqual(["navigation", "panel", "link", "filters"]);
    const markup = render(<PageActions actions={[filters, customise, bell, navigation]} />);
    const at = (needle: string) => markup.indexOf(needle);
    expect(at("page-actions-navigation")).toBeLessThan(at("Customise Home"));
    expect(at("Customise Home")).toBeLessThan(at("Calendar subscription"));
    expect(at("Calendar subscription")).toBeLessThan(at("data-filters-button"));
  });

  it("allows at most one Filters", () => {
    expect(() => orderPageActions([filters, filters])).toThrow(/at most one Filters/);
  });
});

describe("ActionPill", () => {
  it("renders the one tile look with an accessible name, the icon from the map and the count badge", () => {
    const markup = render(<ActionPill kind="filters" icon="filters" label="Filters" count={3} onClick={noop} controls="f" active />);
    expect(markup).toContain("action-pill");
    expect(markup).toContain('aria-label="Filters"');
    expect(markup).toContain('data-action-kind="filters"');
    expect(markup).toContain('data-action-icon="filters"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('<b class="action-pill-count">3</b>');
    expect(markup).toContain("<svg");
  });

  it("renders a link pill for Customise Home and a round icon shape that is not the tile", () => {
    expect(render(<ActionPill icon="customise" label="Customise Home" to="/customise-home" />)).toContain('href="/customise-home"');
    const round = render(<ActionPill shape="icon" icon="prev" label="Previous" onClick={noop} />);
    expect(round).toContain("action-pill-icon");
    expect(round).not.toMatch(/class="[^"]*\baction-pill\b(?!-)/);
    expect(round).toContain("←");
  });
});

describe("PageLayout", () => {
  const header = { title: "Movies", back: { label: "Back", to: "/" }, actions: [filters] };

  it("keeps the header (and Back) up while the page loads, fails or is empty", () => {
    for (const state of [
      { kind: "loading", label: "Loading" } as const,
      { kind: "empty", props: { title: "Nothing here" } } as const,
      { kind: "error", props: { title: "Failed" } } as const,
    ]) {
      const markup = render(<PageLayout pageId="library" header={header} state={state} className="tv-library" />);
      expect(markup).toContain('<h1>Movies</h1>');
      expect(markup).toContain('aria-label="Back"');
      expect(markup).toContain("data-filters-button");
      expect(markup).toContain('data-page-id="library"');
    }
  });

  it("announces the loading and error states with the right roles inside the body", () => {
    expect(render(<PageLayout pageId="library" header={header} state={{ kind: "loading", label: "Loading movies" }} />)).toContain('role="status"');
    expect(render(<PageLayout pageId="library" header={header} state={{ kind: "error", props: { title: "Failed" } }} />)).toContain('role="alert"');
  });

  it("renders the bleed body as the padded frame and the panel body as the stage", () => {
    const bleed = render(<PageLayout pageId="calendar" body="bleed" header={header}>x</PageLayout>);
    expect(bleed).toContain('class="page-shell"');
    expect(bleed).toContain("page-shell-body");
    const panel = render(<PageLayout pageId="library" header={header} className="tv-library">x</PageLayout>);
    expect(panel).toContain('class="tv-library"');
    expect(panel).toContain("tv-stage-wash");
  });

  it("renders the detail variant with one h1 and the item title as the bold detail", () => {
    const markup = render(<PageLayout pageId="work-detail" header={{ title: "Movies", detail: "Sample", variant: "detail", back: { label: "Back", onBack: noop } }} />);
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain("tv-detail-heading-item");
    expect(markup).toContain("<strong>Sample</strong>");
  });
});

describe("ScrollArea", () => {
  it("is the one native scroll container, marked for the navigation layer", () => {
    const markup = render(
      <ScrollArea axis="vertical" scrollKey="x:list">
        <p>row</p>
      </ScrollArea>
    );
    expect(markup).toContain("data-tv-scroll-container");
    expect(markup).toContain('data-tv-scroll-axis="vertical"');
    expect(markup).toContain('data-navigation-scroll-key="x:list"');
    expect(markup).toContain('class="scroll-area is-vertical"');
  });
});

describe("layout harness actions", () => {
  it("parses the query string into the same actions a page passes", () => {
    const actions = parseHarnessActions("navigation,panel:bell:Subscription,link:customise:Customise,filters:Filters:2");
    expect(actions.map((action) => action.kind)).toEqual(["navigation", "panel", "link", "filters"]);
    expect(actions[3]).toMatchObject({ kind: "filters", label: "Filters", activeCount: 2 });
  });
});
