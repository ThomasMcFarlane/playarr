import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../lib/i18n/LanguageProvider";
import { NotFoundPage } from "./NotFound";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((message) => {
    if (!String(message).includes("useLayoutEffect does nothing on the server")) {
      throw new Error(`Unexpected console.error: ${String(message)}`);
    }
  });
});

afterAll(() => consoleErrorSpy.mockRestore());

describe("NotFoundPage", () => {
  it("renders a graphic 404 without an unrelated route action", () => {
    const markup = renderToStaticMarkup(
      <LanguageProvider>
        <MemoryRouter initialEntries={["/settings/account"]}>
          <NotFoundPage />
        </MemoryRouter>
      </LanguageProvider>
    );

    expect(markup).toContain('class="not-found-page"');
    expect(markup).toContain('class="not-found-code">404</span>');
    expect(markup).toContain('<h1 id="not-found-heading">Page not found</h1>');
    expect(markup).not.toContain('href="/"');
  });
});
