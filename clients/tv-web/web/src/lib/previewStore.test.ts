import { describe, expect, it, vi } from "vitest";
import { createPreviewStore } from "./previewStore";

describe("createPreviewStore", () => {
  it("starts empty and notifies subscribers only when the value changes", () => {
    const store = createPreviewStore<{ id: string }>();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    expect(store.get()).toBeNull();
    const a = { id: "a" };
    store.set(a);
    store.set(a);
    expect(store.get()).toBe(a);
    expect(listener).toHaveBeenCalledTimes(1);
    store.set(null);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    store.set(a);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
