import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useTvDirectionalNavigation } = vi.hoisted(() => ({
  useTvDirectionalNavigation: vi.fn(),
}));

vi.mock("../lib/useTvNavigation", () => ({ useTvDirectionalNavigation }));
vi.mock("./tv/TvStage", () => ({
  TvStageChrome: () => <header>Stage chrome</header>,
}));

import {
  authFocusBridgeDestination,
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
