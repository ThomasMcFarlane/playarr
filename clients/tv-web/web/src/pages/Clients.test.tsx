import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../lib/i18n/LanguageProvider";
import {
  activateVidaaInstaller,
  ClientsPage,
  isIpv4Address,
  VidaaActivationError,
  VidaaClientsPage,
} from "./Clients";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((message) => {
    if (!String(message).includes("useLayoutEffect does nothing on the server")) {
      throw new Error(`Unexpected console.error: ${String(message)}`);
    }
  });
});

afterAll(() => consoleErrorSpy.mockRestore());

function renderPage(page: React.ReactNode, path: string): string {
  return renderToStaticMarkup(
    <LanguageProvider>
      <MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>
    </LanguageProvider>
  );
}

describe("ClientsPage", () => {
  it("publishes the exact availability states outside the signed-in shell", () => {
    const markup = renderPage(<ClientsPage />, "/clients");

    expect(markup).toContain('data-navigation-scroll-key="clients:index"');
    expect(markup).toContain("The complete Playarr experience, ready now");
    expect(markup).toContain("The hosted TV app is available now");
    expect(markup.match(/Client builds exist, but signed downloads are not published yet\./g)).toHaveLength(2);
    expect(markup).toContain("The native Apple client is coming soon");
    expect(markup.match(/The TV shell exists, but a signed production package is not published yet\./g)).toHaveLength(2);
    expect(markup).toContain('href="/clients/vidaa"');
    expect(markup).toContain('href="/"');
    expect(markup).not.toContain("app-shell");
  });

  it("renders the VIDAA native scroll root, compatibility warning, and restore-DNS step", () => {
    const markup = renderPage(<VidaaClientsPage />, "/clients/vidaa");

    expect(markup).toContain('data-navigation-scroll-key="clients:vidaa"');
    expect(markup).toContain("Activate installer");
    expect(markup).toContain("Firmware support varies");
    expect(markup).toContain("Restart and restore DNS");
    expect(markup).toContain("Restore automatic DNS after installation.");
    expect(markup).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  });
});

describe("VIDAA installer activation", () => {
  it("accepts a validated gateway response from the source-IP endpoint", async () => {
    const request = vi.fn(async () =>
      new Response(
        JSON.stringify({
          dns_server: "203.0.113.42",
          expires_at: "2026-07-18T12:20:00Z",
          ttl_seconds: 1200,
          deactivation_token: "temporary-token",
          portal_url: "https://vidaahub.com/",
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      )
    );

    await expect(activateVidaaInstaller(request, "https://dns.playarr.app/")).resolves.toEqual({
      resolverIpv4: "203.0.113.42",
      expiresAt: "2026-07-18T12:20:00Z",
      portalUrl: "https://vidaahub.com/",
      deactivationToken: "temporary-token",
    });
    expect(request).toHaveBeenCalledWith(
      "https://dns.playarr.app/v1/activations/self",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) })
    );
  });

  it("aborts an activation request that exceeds the timeout", async () => {
    const request = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })
    );

    await expect(activateVidaaInstaller(request, "https://dns.playarr.app", 1)).rejects.toBeInstanceOf(
      VidaaActivationError
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("rejects failed requests and unsafe gateway values", async () => {
    const unavailable = vi.fn(async () => new Response(null, { status: 503 }));
    const unsafe = vi.fn(async () =>
      new Response(
        JSON.stringify({
          dns_server: "999.2.3.4",
          expires_at: "not-a-date",
          deactivation_token: "token",
          portal_url: "javascript:alert(1)",
        }),
        { status: 201 }
      )
    );

    await expect(activateVidaaInstaller(unavailable)).rejects.toBeInstanceOf(VidaaActivationError);
    await expect(activateVidaaInstaller(unsafe)).rejects.toBeInstanceOf(VidaaActivationError);
  });

  it("validates complete IPv4 addresses", () => {
    expect(isIpv4Address("192.0.2.5")).toBe(true);
    expect(isIpv4Address("256.0.2.5")).toBe(false);
    expect(isIpv4Address("192.0.2")).toBe(false);
    expect(isIpv4Address("1e2.0.2.5")).toBe(false);
  });
});
