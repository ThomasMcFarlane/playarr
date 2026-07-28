import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../lib/i18n/LanguageProvider";
import { CastButton } from "./CastButton";

function renderButton(props: Partial<ComponentProps<typeof CastButton>> = {}): string {
  return renderToStaticMarkup(
    <LanguageProvider>
      <CastButton
        available={true}
        connected={false}
        onToggleCast={() => Promise.resolve()}
        {...props}
      />
    </LanguageProvider>
  );
}

describe("CastButton", () => {
  it("renders nothing at all when cast is unavailable", () => {
    expect(renderButton({ available: false })).toBe("");
    // Still renders nothing even if (implausibly) already "connected" --
    // availability always wins.
    expect(renderButton({ available: false, connected: true })).toBe("");
  });

  it("renders a Cast affordance when available and not connected", () => {
    const markup = renderButton({ available: true, connected: false });

    expect(markup).toContain('aria-label="Cast"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain("<button");
    expect(markup).not.toContain("disabled=");
  });

  it("switches to a Disconnect affordance once connected", () => {
    const markup = renderButton({ available: true, connected: true, deviceName: "Living Room TV" });

    expect(markup).toContain('aria-label="Disconnect"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('title="Playing on Living Room TV"');
  });

  it("omits the title attribute when connected but no device name is known yet", () => {
    const markup = renderButton({ available: true, connected: true, deviceName: undefined });
    expect(markup).not.toContain("title=");
  });

  it("accepts an onToggleCast callback without invoking it during a static render", () => {
    const onToggleCast = vi.fn(() => Promise.resolve());
    renderButton({ onToggleCast });
    expect(onToggleCast).not.toHaveBeenCalled();
  });
});
