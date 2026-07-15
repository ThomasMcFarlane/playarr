# @streamarr-tv/app-webos

Streamarr's webOS TV app shell. Bootstraps `@streamarr-tv/ui-tv` (Browse /
Detail / Player screens + spatial navigation) with `@streamarr-tv/player-shaka`
as the playback engine, since webOS's WebKit/Chromium runtime supports MSE +
EME well enough to run Shaka Player directly.

## Building

`pnpm --filter @streamarr-tv/app-webos run build` produces a static
`dist/` bundle via Vite (relative asset paths, conservative `es2019` build
target for older webOS Chromium versions).

## Known gap: webOS CLI is not installed in this environment

Turning `dist/` into an installable `.ipk` and pushing it to a device or the
webOS TV Simulator requires the **webOS CLI** (`ares-package`, `ares-install`,
`ares-launch`, `ares-inspect`), which is not installed here. `appinfo.json` in
this directory is a real webOS app manifest (id, version, vendor, type, main,
icon fields, resolution, required permissions) so packaging is a matter of
running, once the CLI is available:

```sh
pnpm --filter @streamarr-tv/app-webos run build
ares-package dist appinfo.json -o out/
ares-install -d <device-name> out/com.streamarr.tv_0.1.0_all.ipk
ares-launch -d <device-name> com.streamarr.tv
```

Placeholder `icon.png` / `splash.png` referenced by `appinfo.json` are not
included in this scaffold and will need real assets before packaging.
