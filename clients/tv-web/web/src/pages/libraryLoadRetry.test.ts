import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A dropped connection while the first page of a library loads (the browser reports it as a network change) must
// not leave the page on "could not be loaded": the first-page request goes through `retryTransient`.
describe("Library first-page load", () => {
  it("retries transient failures before showing the error state", () => {
    const source = readFileSync(new URL("./Library.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/retryTransient\(\(\) => client\.browseCatalog\(firstPageParams\)\)/);
  });
});
