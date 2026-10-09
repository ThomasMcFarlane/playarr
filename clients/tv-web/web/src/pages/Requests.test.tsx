import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RequestView } from "@playarr-tv/api-client";
import { LanguageProvider } from "../lib/i18n/LanguageProvider";
import { REQUESTS_QUERY_TAGS, RequestRow } from "./Requests";
import { queryTagsForInvalidations } from "../lib/liveEvents";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((message) => {
    if (!String(message).includes("useLayoutEffect does nothing on the server")) {
      throw new Error(`Unexpected console.error: ${String(message)}`);
    }
  });
});

afterAll(() => consoleErrorSpy.mockRestore());

const request = {
  id: "request-1",
  title: "Sample Movie 1",
  year: 2020,
  status: "pending",
  mine: true,
  requested_by: "someone",
} as RequestView;

describe("RequestRow", () => {
  it("is a focusable media row so the D-pad can step down a long list", () => {
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <ul>
          <RequestRow request={request} />
        </ul>
      </LanguageProvider>
    );
    expect(html).toMatch(/<li[^>]*class="[^"]*media-card-row[^"]*"[^>]*tabindex="0"/);
    expect(html).toContain('data-navigation-focus-key="requests:request-1"');
  });
});

describe("Requests live refresh", () => {
  it("is dropped by a live library change (the cache tag a catalogue event clears)", () => {
    const dropped = queryTagsForInvalidations([{ area: "catalog" }]) ?? [];
    expect(REQUESTS_QUERY_TAGS.some((tag) => dropped.includes(tag))).toBe(true);
  });
});
