import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PROFILE_AVATAR_PRESETS } from "../lib/profileAvatar";
import { ProfileAvatar } from "./ProfileAvatar";

describe("ProfileAvatar", () => {
  it("renders a distinct illustrated SVG for every playful preset", () => {
    const avatars = PROFILE_AVATAR_PRESETS.map((preset) =>
      renderToStaticMarkup(
        <ProfileAvatar preference={{ kind: "preset", preset: preset.id }} />
      )
    );

    expect(avatars.every((avatar) => avatar.includes("<svg"))).toBe(true);
    expect(new Set(avatars)).toHaveLength(PROFILE_AVATAR_PRESETS.length);
  });

  it("renders a saved custom photo instead of preset artwork", () => {
    const markup = renderToStaticMarkup(
      <ProfileAvatar
        preference={{ kind: "custom", dataUrl: "data:image/jpeg;base64,avatar" }}
      />
    );

    expect(markup).toContain("<img");
    expect(markup).not.toContain("<svg");
  });
});
