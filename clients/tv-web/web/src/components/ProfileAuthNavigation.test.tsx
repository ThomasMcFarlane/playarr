import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useTvDirectionalNavigation } = vi.hoisted(() => ({
  useTvDirectionalNavigation: vi.fn(),
}));

vi.mock("../lib/useTvNavigation", () => ({ useTvDirectionalNavigation }));
vi.mock("./tv/TvStage", () => ({
  TvStageChrome: () => <header>Stage chrome</header>,
}));

import { ProfileAuthLayout } from "./ProfileAuthLayout";

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
});
