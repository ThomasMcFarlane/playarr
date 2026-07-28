import {
  installWebOsLifecycle,
  loadWebOsRuntimeConfig,
} from "./webosLifecycle.mjs";

document.documentElement.dataset.platform = "tv-webos";
installWebOsLifecycle();

async function startPlayarr(): Promise<void> {
  await loadWebOsRuntimeConfig(`${import.meta.env.BASE_URL}playarr-config.json`);

  // Import the real Playarr application after platform lifecycle and runtime
  // config are in place. This is the same routed profiles/home/search/library/
  // playlists/settings/player client shipped at playarr.app, not ui-tv.
  await import("../../../web/src/main");
}

void startPlayarr().catch((error: unknown) => {
  console.error("Playarr failed to start", error);
  const root = document.getElementById("root");
  if (root) {
    root.textContent = "Playarr could not start. Reinstall the app or inspect it with ares-inspect.";
    root.style.padding = "3rem";
    root.style.boxSizing = "border-box";
    root.style.color = "white";
    root.style.fontFamily = "sans-serif";
    root.style.fontSize = "2rem";
  }
});
