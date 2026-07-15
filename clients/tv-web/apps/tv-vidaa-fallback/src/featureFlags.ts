/**
 * VIDAA (Hisense) has no dedicated native app SDK target in the current
 * plan -- this shell runs as an installable PWA against VIDAA's browser
 * instead. `vidaaOtaEnabled` gates the "over-the-air" delivery path
 * (auto-updating the PWA shell without an app-store-style release) that
 * the plan calls out as VIDAA's long-term distribution story once it's
 * validated; keep it `false` until that path has been exercised against a
 * real VIDAA device/simulator.
 */
export const vidaaOtaEnabled = false;
