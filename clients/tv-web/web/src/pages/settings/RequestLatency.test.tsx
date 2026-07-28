import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { HttpRouteLatency } from "@playarr-tv/api-client";
import { LanguageProvider } from "../../lib/i18n/LanguageProvider";
import { RequestLatencyContent, type HttpLatencyState } from "./RequestLatency";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((message) => {
    if (!String(message).includes("useLayoutEffect does nothing on the server")) {
      throw new Error(`Unexpected console.error: ${String(message)}`);
    }
  });
});

afterAll(() => consoleErrorSpy.mockRestore());

function renderContent(state: HttpLatencyState): string {
  return renderToStaticMarkup(
    <LanguageProvider>
      <RequestLatencyContent state={state} />
    </LanguageProvider>
  );
}

const SAMPLE_METRICS: HttpRouteLatency[] = [
  {
    method: "GET",
    route: "/api/v1/catalog/{id}",
    sampleCount: 812,
    avgMs: 4.2,
    p50Ms: 3.1,
    p95Ms: 11.4,
    p99Ms: 22.0,
    maxMs: 58.7,
  },
  {
    method: "GET",
    route: "/api/v1/catalog",
    sampleCount: 240,
    avgMs: 2.1,
    p50Ms: 1.8,
    p95Ms: 5.0,
    p99Ms: 9.9,
    maxMs: 14.0,
  },
];

describe("RequestLatencyContent", () => {
  it("renders every row of a mocked latency table, in the order the API returned it", () => {
    const markup = renderContent({ status: "ready", metrics: SAMPLE_METRICS });

    expect(markup).toContain('class="http-latency-table-wrap"');
    expect(markup).toContain('class="http-latency-table"');
    expect(markup).toContain("Method");
    expect(markup).toContain("Route");
    expect(markup).toContain("Count");
    expect(markup).toContain("Avg");
    expect(markup).toContain("p50");
    expect(markup).toContain("p95");
    expect(markup).toContain("p99");
    expect(markup).toContain("Max");
    expect(markup).toContain("/api/v1/catalog/{id}");
    expect(markup).toContain("/api/v1/catalog<");
    expect(markup).toContain("812");
    expect(markup).toContain("4.2ms");
    expect(markup).toContain("3.1ms");
    expect(markup).toContain("11.4ms");
    expect(markup).toContain("22.0ms");
    expect(markup).toContain("58.7ms");

    const firstRowIndex = markup.indexOf("/api/v1/catalog/{id}");
    const secondRowIndex = markup.indexOf("/api/v1/catalog<");
    expect(firstRowIndex).toBeGreaterThan(-1);
    expect(secondRowIndex).toBeGreaterThan(firstRowIndex);
  });

  it("renders an admin-only empty state instead of a table on a mocked 403", () => {
    const markup = renderContent({ status: "forbidden" });

    expect(markup).not.toContain('class="http-latency-table"');
    expect(markup).not.toContain("<table");
    expect(markup).toContain("Admins only");
    expect(markup).toContain(
      "Sign in with an admin account to see per-route request latency."
    );
  });

  it("renders a loading message before the fetch resolves", () => {
    const markup = renderContent({ status: "loading" });

    expect(markup).not.toContain("<table");
    expect(markup).toContain("Loading request latency…");
  });

  it("renders the raw error message for a non-403 failure", () => {
    const markup = renderContent({ status: "error", message: "Network error" });

    expect(markup).not.toContain("<table");
    expect(markup).toContain('class="error-text"');
    expect(markup).toContain("Network error");
  });

  it("renders a no-samples empty state for an authorized but empty response", () => {
    const markup = renderContent({ status: "ready", metrics: [] });

    expect(markup).not.toContain("<table");
    expect(markup).toContain("No samples yet");
  });
});
