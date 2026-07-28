import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetCastSdkLoadStateForTests,
  classifyRequestSessionFailure,
  isCastCapableBrowser,
  isCastEnvironmentSupported,
  isSecureCastContext,
  loadCastSdk,
} from "./castSdk";

beforeEach(() => {
  __resetCastSdkLoadStateForTests();
});

function fakeWindow(overrides: Partial<{ chrome: unknown; isSecureContext: boolean }>): Window {
  return overrides as unknown as Window;
}

function fakeNavigator(overrides: Partial<{ presentation: unknown }>): Navigator {
  return overrides as unknown as Navigator;
}

describe("isCastCapableBrowser", () => {
  it("is true only when both window.chrome and navigator.presentation exist (desktop/Android Chrome, Chromium Edge)", () => {
    expect(
      isCastCapableBrowser(fakeWindow({ chrome: {} }), fakeNavigator({ presentation: {} }))
    ).toBe(true);
  });

  it("is false on Firefox/Safari -- no window.chrome at all", () => {
    expect(
      isCastCapableBrowser(fakeWindow({ chrome: undefined }), fakeNavigator({ presentation: {} }))
    ).toBe(false);
  });

  it("is false on iOS Chrome -- window.chrome exists but there is no navigator.presentation under WebKit", () => {
    expect(isCastCapableBrowser(fakeWindow({ chrome: {} }), fakeNavigator({}))).toBe(false);
  });
});

describe("isSecureCastContext", () => {
  it("is true for a secure context (HTTPS or localhost)", () => {
    expect(isSecureCastContext(fakeWindow({ isSecureContext: true }))).toBe(true);
  });

  it("is false for a plain-HTTP context", () => {
    expect(isSecureCastContext(fakeWindow({ isSecureContext: false }))).toBe(false);
  });
});

describe("isCastEnvironmentSupported", () => {
  it("requires both a secure context and a Cast-capable browser", () => {
    const capableNav = fakeNavigator({ presentation: {} });
    expect(
      isCastEnvironmentSupported(fakeWindow({ chrome: {}, isSecureContext: true }), capableNav)
    ).toBe(true);
    expect(
      isCastEnvironmentSupported(fakeWindow({ chrome: {}, isSecureContext: false }), capableNav)
    ).toBe(false);
    expect(
      isCastEnvironmentSupported(
        fakeWindow({ chrome: undefined, isSecureContext: true }),
        capableNav
      )
    ).toBe(false);
  });
});

describe("classifyRequestSessionFailure", () => {
  it("classifies environment-shaped codes as unsupported-browser", () => {
    expect(classifyRequestSessionFailure("api_not_initialized")).toBe("unsupported-browser");
    expect(classifyRequestSessionFailure("extension_not_compatible")).toBe("unsupported-browser");
    expect(classifyRequestSessionFailure("extension_missing")).toBe("unsupported-browser");
  });

  it("leaves every other code unclassified", () => {
    expect(classifyRequestSessionFailure("receiver_unavailable")).toBeUndefined();
    expect(classifyRequestSessionFailure("timeout")).toBeUndefined();
    expect(classifyRequestSessionFailure("cancel")).toBeUndefined();
  });
});

describe("loadCastSdk", () => {
  it("rejects immediately -- without touching `doc` at all -- when the environment is unsupported", async () => {
    const doc = {
      createElement: () => {
        throw new Error("must not be called for an unsupported environment");
      },
      head: { appendChild: () => undefined },
    } as unknown as Document;

    await expect(
      loadCastSdk({
        win: fakeWindow({ chrome: undefined, isSecureContext: true }),
        doc,
        nav: fakeNavigator({ presentation: {} }),
      })
    ).rejects.toThrow(/cannot load the Cast Sender SDK/);
  });
});
