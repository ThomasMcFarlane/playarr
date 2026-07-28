/** Matches the tones accepted by the Pill component. */
export type Tone = 'ok' | 'warn' | 'neutral'

/**
 * The Playarr client matrix.
 *
 * The authority for these labels is the live clients hub at
 * https://playarr.app/clients (clients/tv-web/web/src/pages/Clients.tsx). This
 * file must not contradict it, and must never present a platform as more
 * available than it is: nothing is on any app store, and several routes are
 * developer-mode sideloads. See docs/roadmap.md for the underlying status.
 */
export interface Platform {
  id: string
  name: string
  devices: string
  status: string
  tone: Tone
  /** What a person actually does today to get it running. */
  route: string
}

export const PLATFORMS: readonly Platform[] = [
  {
    id: 'web',
    name: 'Web',
    devices: 'Any modern browser',
    status: 'Available',
    tone: 'ok',
    route: 'Open playarr.app and point it at your server. Nothing to install.',
  },
  {
    id: 'android',
    name: 'Android',
    devices: 'Phones, tablets, Android TV, Google TV',
    status: 'Available',
    tone: 'ok',
    route: 'One signed universal package, installed directly from the clients hub.',
  },
  {
    id: 'vidaa',
    name: 'Hisense VIDAA',
    devices: 'VIDAA televisions',
    status: 'Available · Experimental install',
    tone: 'neutral',
    route: 'Open the web app in the television browser. A launcher tile is experimental.',
  },
  {
    id: 'roku',
    name: 'Roku',
    devices: 'Roku players and Roku TV',
    status: 'Available · Experimental install',
    tone: 'neutral',
    route: 'Enable Developer Mode and side-load the package from the clients hub.',
  },
  {
    id: 'webos',
    name: 'LG webOS',
    devices: 'LG televisions',
    status: 'Available · Experimental install',
    tone: 'neutral',
    route: 'Build from source, then install with LG Developer Mode and ares-install.',
  },
  {
    id: 'tizen',
    name: 'Samsung Tizen',
    devices: 'Samsung televisions',
    status: 'Available · Experimental install',
    tone: 'neutral',
    route: 'Build and sign from source with Tizen Studio, then install over sdb.',
  },
  {
    id: 'apple',
    name: 'Apple',
    devices: 'iPhone, iPad, Apple TV',
    status: 'Coming soon',
    tone: 'warn',
    route: 'Native SwiftUI apps exist in the repository; there is no installable build yet.',
  },
  {
    id: 'harmony',
    name: 'HarmonyOS',
    devices: 'Huawei phones, tablets, Vision TVs',
    status: 'Coming soon',
    tone: 'warn',
    route: 'A native ArkTS client is in development; there is no installable build yet.',
  },
]
