import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useNativeScrollRoot, useTvDirectionalNavigation } = vi.hoisted(() => ({
  useNativeScrollRoot: vi.fn(),
  useTvDirectionalNavigation: vi.fn(),
}));

vi.mock("../lib/useTvNavigation", () => ({
  useNativeScrollRoot,
  useTvDirectionalNavigation,
}));
vi.mock("./tv/TvStage", () => ({
  TvStageChrome: () => <header>Stage chrome</header>,
}));

import {
  authFocusBridgeDestination,
  defaultAuthBack,
  ProfileAuthLayout,
} from "./ProfileAuthLayout";

describe("ProfileAuthLayout directional navigation", () => {
  beforeEach(() => useTvDirectionalNavigation.mockClear());

  it("mounts the directional focus bridge for sign-in fields", () => {
    renderToStaticMarkup(
      <ProfileAuthLayout>
        <input aria-label="Username" />
      </ProfileAuthLayout>
    );

    expect(useTvDirectionalNavigation).toHaveBeenCalledOnce();
  });

  it("binds the remote Back key to the on-screen Back, or to history when there is none (audit A7)", () => {
    const onBack = vi.fn();
    renderToStaticMarkup(
      <ProfileAuthLayout onBack={onBack}>
        <input aria-label="Username" />
      </ProfileAuthLayout>
    );
    expect(useTvDirectionalNavigation).toHaveBeenLastCalledWith(false, onBack);

    renderToStaticMarkup(
      <ProfileAuthLayout>
        <input aria-label="Username" />
      </ProfileAuthLayout>
    );
    expect(useTvDirectionalNavigation).toHaveBeenLastCalledWith(false, defaultAuthBack);
  });

  it("bridges between the first field and the closed language selector", () => {
    expect(
      authFocusBridgeDestination("ArrowUp", "first-field", false)
    ).toBe("language");
    expect(
      authFocusBridgeDestination("ArrowDown", "language", false)
    ).toBe("first-field");
  });

  it("leaves the open selector and unrelated fields to their native handlers", () => {
    expect(
      authFocusBridgeDestination("ArrowDown", "language", true)
    ).toBeNull();
    expect(
      authFocusBridgeDestination("ArrowUp", "other", false)
    ).toBeNull();
    expect(
      authFocusBridgeDestination("ArrowLeft", "first-field", false)
    ).toBeNull();
  });
});
