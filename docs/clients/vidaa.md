# Installing Playarr on a Hisense VIDAA TV

Playarr installs on supported VIDAA televisions as a hosted Web App. The TV
stores your Streamarr server URL and adds a Playarr tile to its Apps screen;
there is no file to copy to a USB drive.

## Before you start

1. Update the TV under **Settings > Support > System Upgrade > Check Firmware
   Upgrade**.
2. Put the TV and Streamarr server on the same trusted home network.
3. Open Playarr from a phone or computer using the server's LAN address, for
   example `http://192.168.1.50:8080`. Do not use `localhost`: on the TV that
   means the television itself.
4. Confirm the normal Playarr page loads and you can sign in.

Use HTTPS if the server already has a certificate trusted by the television.
Plain HTTP is supported by VIDAA's documented debug installer and is reasonable
on a trusted, isolated home LAN, but it must not be exposed directly to the
internet.

## Install the launcher app

1. Open the **Browser** application on the TV.
2. Enter `hisense://debug` in the address bar.
3. In the Web App installation form, enter these values, replacing
   `192.168.1.50:8080` with your Streamarr server address:

   | Field | Value |
   | --- | --- |
   | App Name | `Playarr` |
   | App URL | `http://192.168.1.50:8080/?platform=tv-vidaa` |
   | Thumbnail | `http://192.168.1.50:8080/playarr-icon-512.png` |
   | Icon Small | `http://192.168.1.50:8080/playarr-icon-192.png` |
   | Icon Large | `http://192.168.1.50:8080/playarr-icon-512.png` |
   | Resolution | `1080` |

4. Select **Install**.
5. Press **Exit**, open **Apps**, and launch **Playarr** from the end of the app
   list.
6. Sign in with the same Streamarr account you use in the browser.

The `platform=tv-vidaa` marker is saved after first launch. It identifies the
TV correctly to Streamarr and selects a conservative VIDAA playback profile;
normal in-app navigation does not need to keep the query string visible.

## If `hisense://debug` does not work

The debug installer is not enabled on every model, region, or firmware release.
If it shows a password prompt, a blank page, or returns to the browser, do not
try random service-menu codes or third-party firmware.

1. Check the VIDAA version under **Settings > Support > About**.
2. Try the Playarr URL directly in the TV Browser and save it as a browser
   favourite if your model offers that option.
3. If the Browser cannot play it reliably, use casting supported by your TV or
   connect a supported Android TV/Google TV device and install Playarr there.

Removing a debug-installed Web App is firmware-specific. On versions covered by
VIDAA's technical guide, highlight the app in the launcher and press the red
remote key.
