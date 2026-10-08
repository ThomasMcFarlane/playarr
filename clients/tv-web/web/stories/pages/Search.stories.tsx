import type { Meta, StoryObj } from "@storybook/react-vite";
import { FixtureGrid, MODE_ARGTYPES, PageStage, type Mode } from "./pageKit";

function Search({ mode, query }: { mode: Mode; query: string }) {
  return (
    <PageStage pageId="search" title="Search" mode={mode} skeleton="grid" className="tv-search" emptyTitle="No results" errorTitle="Search failed">
      <div className="tv-search-copy">
        <div className="tv-search-form" role="search">
          <span className="tv-search-input-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m15.5 15.5 4.5 4.5" />
            </svg>
          </span>
          <input type="search" defaultValue={query} key={query} placeholder="Search titles" aria-label="Search titles" />
          {query ? (
            <button type="button" className="tv-search-clear">
              Clear
            </button>
          ) : null}
        </div>
        {query ? <FixtureGrid count={8} /> : <p className="tv-search-prompt">Type to search your libraries.</p>}
      </div>
    </PageStage>
  );
}

const meta = { title: "Pages/Search", component: Search, tags: ["autodocs"], args: { mode: "default", query: "sample" }, argTypes: { ...MODE_ARGTYPES, query: { control: "text" } } } satisfies Meta<typeof Search>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
