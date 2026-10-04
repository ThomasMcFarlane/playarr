import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir = src): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [relative(src, path)] : [];
  });
}

/**
 * Files that still style raw `btn` classes. This list may only shrink: new UI
 * uses `Button`/`ButtonLink` from `components/ui` (primary / secondary / ghost /
 * icon / danger, rounded, focus ring, TV scale), so shape and focus never drift.
 * Migrating a file means removing it from this list.
 */
const LEGACY_RAW_BTN = new Set([
  "components/DeviceLogin.tsx",
  "components/PlaylistContextMenu.tsx",
  "components/ServerChoiceModal.tsx",
  "components/UpdateToast.tsx",
  "components/player/CastButton.tsx",
  "components/player/EndScreen.tsx",
  "components/player/PlayerControls.tsx",
  "components/player/PlayerIcons.tsx",
  "components/player/PlayerSurface.tsx",
  "components/remote/PlayOnDeviceDialog.tsx",
  "components/remote/RemotePad.tsx",
  "pages/DeviceLink.tsx",
  "pages/Login.tsx",
  "pages/Player.tsx",
  "pages/Playlists.tsx",
  "pages/Signup.tsx",
  "pages/settings/Invite.tsx",
  "pages/settings/ProfileAvatar.tsx",
  "pages/settings/ProfileLock.tsx",
  "pages/settings/Remote.tsx",
  "pages/settings/Server.tsx",
  "pages/settings/YourData.tsx",
]);

const RAW_BTN = /\bbtn( |-|"|`)/;

describe("button style audit", () => {
  it("keeps raw btn styling out of everything but the Button family and the shrinking legacy list", () => {
    const offenders = sources().filter(
      (file) => file !== "components/ui/Button.tsx" && RAW_BTN.test(readFileSync(join(src, file), "utf8")) && !LEGACY_RAW_BTN.has(file)
    );
    expect(offenders, "use <Button>/<ButtonLink> from components/ui instead of raw btn classes").toEqual([]);
  });

  it("drops migrated files from the legacy list", () => {
    const stale = [...LEGACY_RAW_BTN].filter((file) => !RAW_BTN.test(readFileSync(join(src, file), "utf8")));
    expect(stale, "remove migrated files from LEGACY_RAW_BTN").toEqual([]);
  });

  it("shared shell and calendar surfaces render buttons only through the family", () => {
    for (const file of ["components/shell/PageHeader.tsx", "components/shell/FiltersDrawer.tsx", "pages/Calendar.tsx", "components/CalendarLink.tsx"]) {
      const text = readFileSync(join(src, file), "utf8");
      expect(text, `${file} must import from components/ui`).toMatch(/from "\.\.?\/(\.\.\/)?(components\/)?ui"/);
    }
  });
});
