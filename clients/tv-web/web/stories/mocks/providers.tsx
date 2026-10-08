import type { ReactNode } from "react";
import { DownloadsProvider } from "../../src/lib/DownloadsProvider";
import { ToastProvider } from "../../src/lib/toast";
import { setMockApi } from "./ApiClientProvider";

/** A fixture `Work` for stories. Kept untyped on purpose: the generated schema has many optional fields. */
export const fixtureWork = (index: number, overrides: Record<string, unknown> = {}) =>
  ({
    id: `00000000-0000-4000-8000-00000000w${String(index).padStart(3, "0")}`,
    title: `Test Movie ${String.fromCharCode(65 + index)}`,
    sort_title: `Test Movie ${String.fromCharCode(65 + index)}`,
    kind: "Movie",
    genres: ["Drama", "Comedy"],
    images: [],
    external_refs: [],
    tags: [],
    monitored: true,
    availability: "Available",
    added_at: "2026-09-01T10:00:00Z",
    release_date: "2020-05-01T00:00:00Z",
    overview: "A fixture synopsis used only to show the layout of the preview.",
    ...overrides,
  }) as never;

/**
 * Registers the fixture API responses for a story and supplies the providers the real components expect (toasts and
 * the downloads store). Nothing reaches a network: unregistered calls reject.
 */
export function MockApi({ handlers, downloads = false, children }: { handlers: Record<string, unknown>; downloads?: boolean; children: ReactNode }) {
  setMockApi(handlers);
  const inner = downloads ? <DownloadsProvider>{children}</DownloadsProvider> : children;
  return <ToastProvider>{inner}</ToastProvider>;
}

export const never = () => new Promise<never>(() => undefined);
