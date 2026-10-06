import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { TvStageChrome } from "../components/tv/TvStage";
import {
  circularOffset,
  coverflowDepth,
  coverflowPosition,
  gridOffset,
  nextClientIndex,
} from "../lib/coverflow";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { TranslationKey } from "../lib/i18n/translations";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import { useNativeScrollRoot, useTvNavigation } from "../lib/useTvNavigation";
import "./Clients.css";

type ClientStatus = "available" | "experimental" | "soon";
type ClientIcon =
  | "vidaa"
  | "android"
  | "apple"
  | "lg"
  | "samsung"
  | "roku"
  | "chromecast"
  | "xbox"
  | "harmony"
  | "firetv"
  | "server";

interface PlayarrClient {
  id: string;
  nameKey: TranslationKey;
  platformKey: TranslationKey;
  descriptionKey?: TranslationKey;
  status: ClientStatus;
  downloadPath?: string;
  icon: ClientIcon;
}

const PLAYARR_PUBLIC_ORIGIN = "https://playarr.app";

const PLAYARR_CLIENTS: readonly PlayarrClient[] = [
  {
    id: "vidaa",
    nameKey: "pages.clients.vidaa.name",
    platformKey: "pages.clients.vidaa.platform",
    status: "experimental",
    icon: "vidaa",
  },
  {
    id: "android",
    nameKey: "pages.clients.android.name",
    platformKey: "pages.clients.android.platform",
    status: "available",
    icon: "android",
  },
  {
    id: "apple",
    nameKey: "pages.clients.apple.name",
    platformKey: "pages.clients.apple.platform",
    descriptionKey: "pages.clients.ios.description",
    status: "soon",
    icon: "apple",
  },
  {
    id: "webos",
    nameKey: "pages.clients.webos.name",
    platformKey: "pages.clients.webos.platform",
    descriptionKey: "pages.clients.webos.description",
    status: "experimental",
    icon: "lg",
  },
  {
    id: "tizen",
    nameKey: "pages.clients.tizen.name",
    platformKey: "pages.clients.tizen.platform",
    descriptionKey: "pages.clients.tizen.description",
    status: "experimental",
    icon: "samsung",
  },
  {
    id: "roku",
    nameKey: "pages.clients.roku.name",
    platformKey: "pages.clients.roku.platform",
    descriptionKey: "pages.clients.roku.description",
    status: "experimental",
    downloadPath: "/downloads/roku/playarr-roku.zip",
    icon: "roku",
  },
  {
    id: "chromecast",
    nameKey: "pages.clients.chromecast.name",
    platformKey: "pages.clients.chromecast.platform",
    descriptionKey: "pages.clients.chromecast.description",
    status: "soon",
    icon: "chromecast",
  },
  {
    id: "xbox",
    nameKey: "pages.clients.xbox.name",
    platformKey: "pages.clients.xbox.platform",
    descriptionKey: "pages.clients.xbox.description",
    status: "soon",
    icon: "xbox",
  },
  {
    id: "harmony",
    nameKey: "pages.clients.harmony.name",
    platformKey: "pages.clients.harmony.platform",
    descriptionKey: "pages.clients.harmony.description",
    status: "soon",
    icon: "harmony",
  },
  {
    id: "firetv",
    nameKey: "pages.clients.firetv.name",
    platformKey: "pages.clients.firetv.platform",
    descriptionKey: "pages.clients.firetv.description",
    status: "soon",
    icon: "firetv",
  },
  {
    // Not a playback client: the server every client above connects to. Its
    // downloads (per-architecture tarballs) live on the server page itself.
    id: "server",
    nameKey: "pages.clients.server.name",
    platformKey: "pages.clients.server.platform",
    descriptionKey: "pages.clients.server.description",
    status: "experimental",
    icon: "server",
  },
];

function ClientPlatformIcon({ icon }: { icon: ClientIcon }) {
  if (icon === "vidaa") {
    return (
      <svg viewBox="0 0 24 24" role="img" aria-label="VIDAA">
        <rect x="2.5" y="4.5" width="19" height="13" rx="2.5" />
        <path d="m8 9 4 5 4-5M9 21h6" />
      </svg>
    );
  }

  if (icon === "server") {
    return (
      <svg viewBox="0 0 24 24" role="img" aria-label="Server">
        <rect x="3" y="3.5" width="18" height="7" rx="2" />
        <rect x="3" y="13.5" width="18" height="7" rx="2" />
        <path d="M7 7h.01M7 17h.01M11 7h6M11 17h6" />
      </svg>
    );
  }

  if (icon === "xbox") {
    // Simple Icons (the source for the other real brand marks below) has no
    // Xbox glyph: Microsoft's legal team had its whole Microsoft-family icon
    // set pulled from that project (simple-icons/simple-icons#11236), and
    // Xbox's own fansite guidelines separately restrict logo reuse. This mark
    // is instead Font Awesome Free's "xbox" brand icon, CC BY 4.0 -- see
    // THIRD_PARTY_NOTICES.md in this package for the required attribution.
    return (
      <svg viewBox="0 0 512 512" role="img" aria-label="Xbox">
        <path d="M369.9 318.2c44.3 54.3 64.7 98.8 54.4 118.7-7.9 15.1-56.7 44.6-92.6 55.9-29.6 9.3-68.4 13.3-100.4 10.2-38.2-3.7-76.9-17.4-110.1-39C93.3 445.8 87 438.3 87 423.4c0-29.9 32.9-82.3 89.2-142.1 32-33.9 76.5-73.7 81.4-72.6 9.4 2.1 84.3 75.1 112.3 109.5zM188.6 143.8c-29.7-26.9-58.1-53.9-86.4-63.4-15.2-5.1-16.3-4.8-28.7 8.1-29.2 30.4-53.5 79.7-60.3 122.4-5.4 34.2-6.1 43.8-4.2 60.5 5.6 50.5 17.3 85.4 40.5 120.9 9.5 14.6 12.1 17.3 9.3 9.9-4.2-11-.3-37.5 9.5-64 14.3-39 53.9-112.9 120.3-194.4zm311.6 63.5C483.3 127.3 432.7 77 425.6 77c-7.3 0-24.2 6.5-36 13.9-23.3 14.5-41 31.4-64.3 52.8C367.7 197 427.5 283.1 448.2 346c6.8 20.7 9.7 41.1 7.4 52.3-1.7 8.5-1.7 8.5 1.4 4.6 6.1-7.7 19.9-31.3 25.4-43.5 7.4-16.2 15-40.2 18.6-58.7 4.3-22.5 3.9-70.8-.8-93.4zM141.3 43C189 40.5 251 77.5 255.6 78.4c.7.1 10.4-4.2 21.6-9.7 63.9-31.1 94-25.8 107.4-25.2-63.9-39.3-152.7-50-233.9-11.7-23.4 11.1-24 11.9-9.4 11.2z" />
      </svg>
    );
  }

  // Brand paths are from Simple Icons (CC0-1.0). Fire TV has no Simple Icons
  // mark of its own -- Amazon's flame-and-arrow Fire TV logo is a registered
  // product mark and isn't in that CC0 set -- so, matching this page's own
  // precedent of using the parent brand for LG (webOS) and Samsung (Tizen),
  // the tile uses Amazon's own mark.
  const paths: Record<Exclude<ClientIcon, "vidaa" | "xbox" | "server">, string> = {
    firetv:
      "M.045 18.02c.072-.116.187-.124.348-.022 3.636 2.11 7.594 3.166 11.87 3.166 2.852 0 5.668-.533 8.447-1.595l.315-.14c.138-.06.234-.1.293-.13.226-.088.39-.046.525.13.12.174.09.336-.12.48-.256.19-.6.41-1.006.654-1.244.743-2.64 1.316-4.185 1.726a17.617 17.617 0 01-10.951-.577 17.88 17.88 0 01-5.43-3.35c-.1-.074-.151-.15-.151-.22 0-.047.021-.09.051-.13zm6.565-6.218c0-1.005.247-1.863.743-2.577.495-.71 1.17-1.25 2.04-1.615.796-.335 1.756-.575 2.912-.72.39-.046 1.033-.103 1.92-.174v-.37c0-.93-.105-1.558-.3-1.875-.302-.43-.78-.65-1.44-.65h-.182c-.48.046-.896.196-1.246.46-.35.27-.575.63-.675 1.096-.06.3-.206.465-.435.51l-2.52-.315c-.248-.06-.372-.18-.372-.39 0-.046.007-.09.022-.15.247-1.29.855-2.25 1.82-2.88.976-.616 2.1-.975 3.39-1.05h.54c1.65 0 2.957.434 3.888 1.29.135.15.27.3.405.48.12.165.224.314.283.45.075.134.15.33.195.57.06.254.105.42.135.51.03.104.062.3.076.615.01.313.02.493.02.553v5.28c0 .376.06.72.165 1.036.105.313.21.54.315.674l.51.674c.09.136.136.256.136.36 0 .12-.06.226-.18.314-1.2 1.05-1.86 1.62-1.963 1.71-.165.135-.375.15-.63.045a6.062 6.062 0 01-.526-.496l-.31-.347a9.391 9.391 0 01-.317-.42l-.3-.435c-.81.886-1.603 1.44-2.4 1.665-.494.15-1.093.227-1.83.227-1.11 0-2.04-.343-2.76-1.034-.72-.69-1.08-1.665-1.08-2.94l-.05-.076zm3.753-.438c0 .566.14 1.02.425 1.364.285.34.675.512 1.155.512.045 0 .106-.007.195-.02.09-.016.134-.023.166-.023.614-.16 1.08-.553 1.424-1.178.165-.28.285-.58.36-.91.09-.32.12-.59.135-.8.015-.195.015-.54.015-1.005v-.54c-.84 0-1.484.06-1.92.18-1.275.36-1.92 1.17-1.92 2.43l-.035-.02zm9.162 7.027c.03-.06.075-.11.132-.17.362-.243.714-.41 1.05-.5a8.094 8.094 0 011.612-.24c.14-.012.28 0 .41.03.65.06 1.05.168 1.172.33.063.09.099.228.099.39v.15c0 .51-.149 1.11-.424 1.8-.278.69-.664 1.248-1.156 1.68-.073.06-.14.09-.197.09-.03 0-.06 0-.09-.012-.09-.044-.107-.12-.064-.24.54-1.26.806-2.143.806-2.64 0-.15-.03-.27-.087-.344-.145-.166-.55-.257-1.224-.257-.243 0-.533.016-.87.046-.363.045-.7.09-1 .135-.09 0-.148-.014-.18-.044-.03-.03-.036-.047-.02-.077 0-.017.006-.03.02-.063v-.06z",
    android:
      "M18.4395 5.5586c-.675 1.1664-1.352 2.3318-2.0274 3.498-.0366-.0155-.0742-.0286-.1113-.043-1.8249-.6957-3.484-.8-4.42-.787-1.8551.0185-3.3544.4643-4.2597.8203-.084-.1494-1.7526-3.021-2.0215-3.4864a1.1451 1.1451 0 0 0-.1406-.1914c-.3312-.364-.9054-.4859-1.379-.203-.475.282-.7136.9361-.3886 1.5019 1.9466 3.3696-.0966-.2158 1.9473 3.3593.0172.031-.4946.2642-1.3926 1.0177C2.8987 12.176.452 14.772 0 18.9902h24c-.119-1.1108-.3686-2.099-.7461-3.0683-.7438-1.9118-1.8435-3.2928-2.7402-4.1836a12.1048 12.1048 0 0 0-2.1309-1.6875c.6594-1.122 1.312-2.2559 1.9649-3.3848.2077-.3615.1886-.7956-.0079-1.1191a1.1001 1.1001 0 0 0-.8515-.5332c-.5225-.0536-.9392.3128-1.0488.5449zm-.0391 8.461c.3944.5926.324 1.3306-.1563 1.6503-.4799.3197-1.188.0985-1.582-.4941-.3944-.5927-.324-1.3307.1563-1.6504.4727-.315 1.1812-.1086 1.582.4941zM7.207 13.5273c.4803.3197.5506 1.0577.1563 1.6504-.394.5926-1.1038.8138-1.584.4941-.48-.3197-.5503-1.0577-.1563-1.6504.4008-.6021 1.1087-.8106 1.584-.4941z",
    apple:
      "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701",
    chromecast:
      "M0 18.5455v3.2727h3.2727c0-1.811-1.4618-3.2727-3.2727-3.2727zm0-4.3637v2.1818c3.011 0 5.4545 2.4437 5.4545 5.4546h2.1819c0-4.2218-3.4146-7.6364-7.6364-7.6364zm0-4.3636V12c5.4218 0 9.8182 4.3964 9.8182 9.8182H12c0-6.6327-5.3782-12-12-12zm21.8182-7.6364H2.1818C.9818 2.1818 0 3.1636 0 4.3636v3.2728h2.1818V4.3636h19.6364v15.2728h-7.6364v2.1818h7.6364c1.2 0 2.1818-.9818 2.1818-2.1818V4.3636c0-1.2-.9818-2.1818-2.1818-2.1818Z",
    harmony:
      "M1.861 0H3.59v3.548h3.861V0H9.19v8.883H7.458V5.136H3.59v3.746H1.858Zm8.248 8.883ZM13.854 0h1.706l2.809 4.7h.1L21.278 0h1.719v8.883h-1.719v-4.38l.1-1.489h-.1l-2.334 3.983h-1.039l-2.347-3.983h-.1l.1 1.489v4.38h-1.706Zm4.702 21.648a4.082 4.082 0 0 1-1.154-.161 3.417 3.417 0 0 1-1.01-.484 3.5 3.5 0 0 1-.8-.782 3.817 3.817 0 0 1-.538-1.092l1.666-.62a2.411 2.411 0 0 0 .643 1.116 1.683 1.683 0 0 0 1.207.434 2.173 2.173 0 0 0 .524-.062 1.749 1.749 0 0 0 .459-.2 1.02 1.02 0 0 0 .328-.335.88.88 0 0 0 .118-.459 1.052 1.052 0 0 0-.092-.447 1.031 1.031 0 0 0-.315-.373 2.538 2.538 0 0 0-.564-.335 8.135 8.135 0 0 0-.852-.335l-.577-.2a4.753 4.753 0 0 1-.774-.335 3.44 3.44 0 0 1-.7-.509 2.662 2.662 0 0 1-.525-.695 2.093 2.093 0 0 1-.2-.918 2.248 2.248 0 0 1 .21-.968 2.433 2.433 0 0 1 .616-.794 2.87 2.87 0 0 1 .957-.533 3.726 3.726 0 0 1 1.246-.2 3.57 3.57 0 0 1 1.22.186 2.783 2.783 0 0 1 .879.459 2.468 2.468 0 0 1 .59.608 2.9 2.9 0 0 1 .328.633l-1.56.62a1.55 1.55 0 0 0-.485-.67 1.387 1.387 0 0 0-.944-.3 1.655 1.655 0 0 0-.957.261.754.754 0 0 0-.38.658.843.843 0 0 0 .367.682 4.232 4.232 0 0 0 1.167.534l.59.186a6.271 6.271 0 0 1 1.023.434 2.948 2.948 0 0 1 .8.57 2.191 2.191 0 0 1 .511.769 2.44 2.44 0 0 1 .183.98 2.317 2.317 0 0 1-.3 1.2 2.559 2.559 0 0 1-.747.819 3.361 3.361 0 0 1-1.036.484 4.184 4.184 0 0 1-1.128.161Zm-13.028 0a4.441 4.441 0 0 1-3.23-1.34 4.757 4.757 0 0 1-.956-1.476 4.912 4.912 0 0 1-.339-1.824 4.813 4.813 0 0 1 .339-1.811 4.569 4.569 0 0 1 .956-1.477 4.38 4.38 0 0 1 1.427-.992 4.5 4.5 0 0 1 1.8-.36 4.417 4.417 0 0 1 1.79.36 4.343 4.343 0 0 1 1.44.992 4.418 4.418 0 0 1 .944 1.477 4.67 4.67 0 0 1 .351 1.811 4.765 4.765 0 0 1-.351 1.824 4.589 4.589 0 0 1-.944 1.476 4.495 4.495 0 0 1-3.23 1.34Zm0-1.588a2.822 2.822 0 0 0 1.125-.223 2.761 2.761 0 0 0 .92-.621 2.723 2.723 0 0 0 .617-.955 3.321 3.321 0 0 0 .23-1.253 3.227 3.227 0 0 0-.23-1.24 2.7 2.7 0 0 0-.617-.968 2.759 2.759 0 0 0-.92-.62 2.821 2.821 0 0 0-1.125-.223 2.856 2.856 0 0 0-2.057.844 2.946 2.946 0 0 0-.617.968 3.388 3.388 0 0 0-.218 1.24 3.488 3.488 0 0 0 .218 1.253 2.972 2.972 0 0 0 .617.955 2.856 2.856 0 0 0 2.057.843Zm4.972 1.389Zm-8.269 1.039h6.5V24h-6.5Z",
    lg: "M14.522 14.078h3.27v1.33h-4.847v-6.83h1.577v5.5zm6.74-1.274h1.284v1.195c-.236.09-.698.18-1.137.18-1.42 0-1.893-.721-1.893-2.186 0-1.398.45-2.221 1.869-2.221.791 0 1.24.248 1.612.722l.982-.903c-.6-.855-1.646-1.114-2.629-1.114-2.208 0-3.368 1.205-3.368 3.504 0 2.288 1.047 3.528 3.358 3.528 1.06 0 2.096-.27 2.66-.665V11.53h-2.739v1.274zM5.291 6.709a5.29 5.29 0 1 1 0 10.582 5.291 5.291 0 1 1 0-10.582m3.16 8.457a4.445 4.445 0 0 0 1.31-3.161v-.242l-.22.001H6.596v.494h2.662l-.001.015a3.985 3.985 0 0 1-3.965 3.708 3.95 3.95 0 0 1-2.811-1.165 3.952 3.952 0 0 1-1.164-2.811c0-1.061.414-2.059 1.164-2.81a3.951 3.951 0 0 1 2.81-1.164l.252.003v-.495l-.251-.003a4.475 4.475 0 0 0-4.47 4.469c0 1.194.465 2.316 1.309 3.161a4.444 4.444 0 0 0 3.16 1.31 4.444 4.444 0 0 0 3.162-1.31m-2.91-1.297V9.644H5.04v4.72h1.556v-.495H5.543zm-1.265-3.552a.676.676 0 1 0-.675.674.676.676 0 0 0 .675-.674",
    samsung:
      "M19.8166 10.2808l.0459 2.6934h-.023l-.7793-2.6934h-1.2837v3.3925h.8481l-.0458-2.785h.023l.8366 2.785h1.2264v-3.3925zm-16.149 0l-.6418 3.427h.9284l.4699-3.1175h.0229l.4585 3.1174h.9169l-.6304-3.4269zm5.1805 0l-.424 2.6132h-.023l-.424-2.6132H6.5788l-.0688 3.427h.8596l.023-3.0832h.0114l.573 3.0831h.8711l.5731-3.083h.023l.0228 3.083h.8596l-.0802-3.4269zm-7.2664 2.4527c.0343.0802.0229.1949.0114.2522-.0229.1146-.1031.2292-.3324.2292-.2177 0-.3438-.126-.3438-.3095v-.3323H0v.2636c0 .7679.6074.9971 1.2493.9971.6189 0 1.1346-.2178 1.2149-.7794.0458-.298.0114-.4928 0-.5616-.1605-.722-1.467-.9283-1.5588-1.3295-.0114-.0688-.0114-.1375 0-.1834.023-.1146.1032-.2292.3095-.2292.2063 0 .321.126.321.3095v.2063h.8595v-.2407c0-.745-.6762-.8596-1.1576-.8596-.6074 0-1.1117.2063-1.2034.7564-.023.149-.0344.2866.0114.4585.1376.7106 1.364.9169 1.5358 1.3524m11.152 0c.0343.0803.0228.1834.0114.2522-.023.1146-.1032.2292-.3324.2292-.2178 0-.3438-.126-.3438-.3095v-.3323h-.917v.2636c0 .7564.596.9857 1.2379.9857.6189 0 1.1232-.2063 1.2034-.7794.0459-.298.0115-.4814 0-.5616-.1375-.7106-1.4327-.9284-1.5243-1.318-.0115-.0688-.0115-.1376 0-.1835.0229-.1146.1031-.2292.3094-.2292.1948 0 .321.126.321.3095v.2063h.848v-.2407c0-.745-.6647-.8596-1.146-.8596-.6075 0-1.1004.1948-1.192.7564-.023.149-.023.2866.0114.4585.1376.7106 1.341.9054 1.513 1.3524m2.8882.4585c.2407 0 .3094-.1605.3323-.2522.0115-.0343.0115-.0917.0115-.126v-2.533h.871v2.4642c0 .0688 0 .1948-.0114.2292-.0573.6419-.5616.8482-1.192.8482-.6303 0-1.1346-.2063-1.192-.8482 0-.0344-.0114-.1604-.0114-.2292v-2.4642h.871v2.533c0 .0458 0 .0916.0115.126 0 .0917.0688.2522.3095.2522m7.1518-.0344c.2522 0 .3324-.1605.3553-.2522.0115-.0343.0115-.0917.0115-.126v-.4929h-.3553v-.5043H24v.917c0 .0687 0 .1145-.0115.2292-.0573.6303-.596.8481-1.2034.8481-.6075 0-1.1461-.2178-1.2034-.8481-.0115-.1147-.0115-.1605-.0115-.2293v-1.444c0-.0574.0115-.172.0115-.2293.0802-.6419.596-.8482 1.2034-.8482s1.1347.2063 1.2034.8482c.0115.1031.0115.2292.0115.2292v.1146h-.8596v-.1948s0-.0803-.0115-.1261c-.0114-.0802-.0802-.2521-.3438-.2521-.2521 0-.321.1604-.3438.2521-.0115.0458-.0115.1032-.0115.1605v1.5702c0 .0458 0 .0916.0115.126 0 .0917.0917.2522.3323.2522",
    roku: "M16.34 9.853l-2.254 2.254v-2.26H12.13v5.744h1.957v-2.33l2.353 2.33h2.46l-2.988-2.99 2.477-2.476v3.411c0 1.133.679 2.177 2.393 2.177.815 0 1.56-.462 1.922-.88l.88.759H24v-5.74h-1.951v3.718c-.22.384-.528.627-1.002.627-.482 0-.703-.286-.703-1.198V9.853zm-4.591 2.869A3.004 3.004 0 1 1 8.738 9.73a2.997 2.997 0 0 1 3.011 2.99m-3.011-1.57c-.518 0-.956.704-.956 1.572 0 .867.438 1.57.956 1.57.528 0 .968-.702.968-1.57 0-.869-.438-1.572-.968-1.572zm-2.206 4.447H4.313L2.55 13.153h-.594v2.44H0V8.26h2.8c1.616 0 2.935 1.1 2.935 2.45 0 .826-.505 1.562-1.273 2.013l2.07 2.875m-2.75-4.888A1.226 1.226 0 0 0 2.56 9.478h-.604v2.453h.605a1.225 1.225 0 0 0 1.22-1.221Z",
  };
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label={icon}>
      <path d={paths[icon]} />
    </svg>
  );
}

function PublicClientsLayout({
  backTo,
  children,
  scrollKey,
}: {
  backTo: string;
  children: ReactNode;
  scrollKey: string;
}) {
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  useTvNavigation(location.pathname, false, backTo);
  useNativeScrollRoot();

  return (
    <div className="profiles-page profile-auth-page clients-shell">
      <TvStageChrome
        backLabel={
          backTo === "/clients"
            ? t("pages.clients.vidaaPage.back")
            : t("pages.profiles.backAriaLabel")
        }
        onBack={() => navigate(backTo)}
      />
      <main
        className="profile-auth-scroll clients-scroll"
        data-tv-scroll-container
        data-tv-scroll-axis="vertical"
        data-navigation-scroll-key={scrollKey}
      >
        <div className="clients-stage-panel">{children}</div>
      </main>
    </div>
  );
}

/**
 * Every tile's position/size, in both modes, is expressed as the exact same
 * transform shape -- translate(x, y) scale(s) -- computed from plain
 * numbers rather than left to CSS layout. Grid placement (CSS Grid
 * row/column) can't be smoothly animated by the browser at all, and even a
 * structural change in the transform's own function list (translateX(...)
 * vs translate(...)) risks the browser falling back to coarser matrix
 * interpolation instead of animating x/y/scale independently. Keeping the
 * shape identical is what makes clicking a bubble in the grid morph
 * smoothly into its place in the stack, instead of jumping.
 */
function gridTileStyle(index: number, total: number): CSSProperties {
  const { x, y } = gridOffset(index, total);
  return {
    "--pos-x": x,
    "--pos-y": y,
    transform:
      "translate(calc(var(--pos-x) * var(--grid-spacing-x)), calc(var(--pos-y) * var(--grid-spacing-y))) scale(1)",
    zIndex: 1,
  } as CSSProperties;
}

function coverflowTileStyle(offset: number): CSSProperties {
  const depth = coverflowDepth(offset);
  return {
    // No rotateY: a 3D tilt under perspective projects off-centre tiles
    // into a slightly asymmetric shape, which can shift a tile's *computed*
    // vertical centre by a stray pixel or two. The app-wide arrow-key focus
    // system scores directional candidates geometrically, so that drift
    // could occasionally make a neighbouring tile look like a valid Up/Down
    // target instead of the current one. Keeping this transform 2D
    // guarantees every tile's vertical centre is identical, so Up/Down can
    // never land on another tile, not just "usually" won't.
    "--pos-x": coverflowPosition(offset),
    "--pos-y": 0,
    transform: `translate(calc(var(--pos-x) * var(--cf-spacing)), calc(var(--pos-y) * 1px)) scale(${depth.scale})`,
    zIndex: depth.zIndex,
  } as CSSProperties;
}

/**
 * `activeClientId` undefined means the bare /clients landing page: every
 * client is shown as an equal-sized bubble in a grid, and every one of them
 * is a real, focusable, natively-activatable target (there's nothing to
 * privilege yet, and 2D arrow-key movement between bubbles is exactly what
 * the app-wide geometric focus system already does well). Once a client is
 * selected, the same tiles morph into the coverflow.
 */
function ClientsSelector({ activeClientId }: { activeClientId?: string }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const total = PLAYARR_CLIENTS.length;
  const mode = activeClientId ? "stack" : "grid";
  const selectedIndex = Math.max(
    0,
    PLAYARR_CLIENTS.findIndex((client) => client.id === activeClientId)
  );

  // Only Left/Right ever change the stack's selection (grid mode leaves
  // arrow keys alone entirely -- see below). Up/Down must stay free for
  // row/page scrolling: the app-wide arrow-key system moves focus by nearest
  // on-screen geometry, and that geometry genuinely does put some other
  // tile "above" or "below" once focus has moved elsewhere on the page (e.g.
  // into the detail content below) -- there's no bounding-box tweak that
  // makes every tile unreachable via Up/Down from every possible position.
  // Driving navigation from onFocus therefore couldn't tell a deliberate
  // Left/Right move from focus incidentally landing on some tile via Up,
  // Down, or Tab. Handling Left/Right explicitly here, instead of through
  // focus arrival, removes the ambiguity: nothing but this handler ever
  // navigates.
  useEffect(() => {
    if (mode !== "stack") return;
    const activeTile = document.getElementById(`client-${activeClientId}`);
    const focusIsWithinCoverflow = document.activeElement
      ?.closest(".clients-coverflow") != null;
    if (activeTile && focusIsWithinCoverflow) {
      activeTile.focus({ preventScroll: true });
    }
  }, [mode, activeClientId]);

  return (
    <section
      className={`clients-coverflow is-${mode}`}
      aria-label={t("pages.clients.gridAriaLabel")}
      data-tv-scroll-container
      data-tv-scroll-axis="horizontal"
      data-navigation-scroll-key="clients:platforms"
      onKeyDown={(event) => {
        if (mode !== "stack") return;
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const nextClient = PLAYARR_CLIENTS[nextClientIndex(selectedIndex, direction, total)];
        if (nextClient && nextClient.id !== activeClientId) {
          navigate(`/clients/${nextClient.id}`, { replace: true });
        }
      }}
    >
      <div className="clients-coverflow-track">
        {PLAYARR_CLIENTS.map((client, index) => {
          const isActive = client.id === activeClientId;
          // The grid has nothing to privilege yet, so every bubble is a
          // real target; the stack keeps only the active tile focusable
          // (see the module-level comment on coverflowTileStyle) -- but
          // both modes use the exact same <div role="link"> element with
          // only its tabIndex/handlers changing, specifically so a tile's
          // DOM node survives the grid<->stack transition unchanged and its
          // position/scale can actually animate, rather than being replaced
          // (which a real <a> <-> <div> swap would cause, with the new node
          // simply appearing at its final position with nothing to animate
          // from).
          const focusable = mode === "grid" || isActive;
          const activate = () => {
            if (client.id === activeClientId) return;
            navigate(`/clients/${client.id}`, { replace: mode === "stack" });
          };

          return (
            <article
              className={`client-choice is-${client.status} is-${client.icon}${isActive ? " is-active" : ""}`}
              key={client.id}
              style={
                mode === "grid"
                  ? gridTileStyle(index, total)
                  : coverflowTileStyle(circularOffset(index, selectedIndex, total))
              }
            >
              <div
                id={`client-${client.id}`}
                className="client-platform"
                role="link"
                tabIndex={focusable ? 0 : -1}
                aria-label={`${t(client.nameKey)} — ${t(client.platformKey)}`}
                aria-current={isActive ? "page" : undefined}
                data-tv-focus-default={
                  (mode === "grid" ? index === 0 : isActive) ? true : undefined
                }
                data-navigation-focus-key={`clients:${client.id}`}
                onClick={activate}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  activate();
                }}
              >
                <span
                  className="client-platform-icon"
                  data-client-icon={client.icon}
                  aria-hidden="true"
                >
                  <ClientPlatformIcon icon={client.icon} />
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function AndroidDownloadDetails() {
  const { t } = useLanguage();

  return (
    <section
      className="android-inline-details"
      id="android-install-details"
      aria-labelledby="android-download-title"
    >
      <p className="page-kicker">{t("pages.clients.androidPage.kicker")}</p>
      <h1 id="android-download-title">{t("pages.clients.androidPage.title")}</h1>
      <p>{t("pages.clients.androidPage.description")}</p>
      <div className="android-download-actions">
        <a
          id="android-download"
          className="profile-action-button"
          href={`${PLAYARR_PUBLIC_ORIGIN}/downloads/android/playarr-android.apk`}
          target="_blank"
          rel="noopener noreferrer"
          data-navigation-focus-key="clients:android:download"
          data-tv-focus-default
        >
          <strong>{t("pages.clients.androidPage.download")}</strong>
        </a>
      </div>
    </section>
  );
}

function VidaaInstallDetails() {
  const { t } = useLanguage();

  return (
    <>
      <section className="vidaa-hero" aria-labelledby="vidaa-title">
        <div>
          <p className="page-kicker">{t("pages.clients.vidaaPage.kicker")}</p>
          <h1 className="auth-title" id="vidaa-title">
            {t("pages.clients.vidaaPage.title")}
          </h1>
          <p className="muted auth-description vidaa-lead">
            {t("pages.clients.vidaaPage.description")}
          </p>
        </div>
        <aside className="vidaa-experimental">
          <span>{t("pages.clients.status.experimental")}</span>
          <p>{t("pages.clients.vidaaPage.experimentalNote")}</p>
        </aside>
      </section>

      <section className="vidaa-activation" aria-labelledby="vidaa-store-title">
        <div className="vidaa-section-heading">
          <span>01</span>
          <div>
            <p>{t("pages.clients.vidaaPage.storeKicker")}</p>
            <h2 id="vidaa-store-title">
              {t("pages.clients.vidaaPage.storeTitle")}
            </h2>
          </div>
        </div>
        <p className="vidaa-section-copy">
          {t("pages.clients.vidaaPage.storeDescription")}
        </p>
        <div className="vidaa-store-row">
          <a
            id="vidaa-store-open"
            className="profile-action-button"
            href={`${PLAYARR_PUBLIC_ORIGIN}/vidaa-store/`}
            data-navigation-focus-key="clients:vidaa:store"
            data-tv-focus-default
          >
            <strong>{t("pages.clients.vidaaPage.openStore")}</strong>
          </a>
          <p>{t("pages.clients.vidaaPage.dnsChoice")}</p>
        </div>
      </section>

      <section className="vidaa-steps" aria-labelledby="vidaa-steps-title">
        <div className="vidaa-section-heading">
          <span>02</span>
          <div>
            <p>{t("pages.clients.vidaaPage.installKicker")}</p>
            <h2 id="vidaa-steps-title">{t("pages.clients.vidaaPage.installTitle")}</h2>
          </div>
        </div>
        <ol>
          {([1, 2, 3, 4] as const).map((step) => (
            <li key={step}>
              <span>0{step}</span>
              <div>
                <h3>{t(`pages.clients.vidaaPage.step${step}Title`)}</h3>
                <p>{t(`pages.clients.vidaaPage.step${step}Description`)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="vidaa-safety" aria-labelledby="vidaa-safety-title">
        <p className="page-kicker">{t("pages.clients.vidaaPage.aftercareKicker")}</p>
        <h2 id="vidaa-safety-title">{t("pages.clients.vidaaPage.aftercareTitle")}</h2>
        <p>{t("pages.clients.vidaaPage.aftercareDescription")}</p>
      </section>
    </>
  );
}

function RokuInstallGuide() {
  const { t } = useLanguage();

  return (
    <>
      <section
        className="vidaa-steps roku-install-guide"
        aria-labelledby="roku-install-title"
      >
        <div className="vidaa-section-heading">
          <span aria-hidden="true">01</span>
          <div>
            <p>{t("pages.clients.rokuPage.installKicker")}</p>
            <h2 id="roku-install-title">
              {t("pages.clients.rokuPage.installTitle")}
            </h2>
          </div>
        </div>
        <p className="vidaa-section-copy">
          {t("pages.clients.rokuPage.installDescription")}
        </p>
        <ol>
          {([1, 2, 3, 4] as const).map((step) => (
            <li key={step}>
              <span>0{step}</span>
              <div>
                <h3>{t(`pages.clients.rokuPage.step${step}Title`)}</h3>
                <p>{t(`pages.clients.rokuPage.step${step}Description`)}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="roku-official-guide">
          <a
            href="https://developer.roku.com/dev/docs/developer-setup"
            target="_blank"
            rel="noopener noreferrer"
            data-navigation-focus-key="clients:roku:official-guide"
          >
            {t("pages.clients.rokuPage.officialGuide")}
          </a>
        </p>
      </section>

      <section
        className="vidaa-safety roku-install-note"
        aria-labelledby="roku-install-note-title"
      >
        <p className="page-kicker">{t("pages.clients.rokuPage.noteKicker")}</p>
        <h2 id="roku-install-note-title">
          {t("pages.clients.rokuPage.noteTitle")}
        </h2>
        <p>{t("pages.clients.rokuPage.noteDescription")}</p>
      </section>
    </>
  );
}

type SmartTvClientId = "webos" | "tizen";

interface SmartTvInstallConfig {
  appId: string;
  downloadHref: string;
  officialGuideHref: string;
  sourceHref: string;
  steps: readonly (readonly string[])[];
}

const SMART_TV_INSTALL_CONFIG: Record<SmartTvClientId, SmartTvInstallConfig> = {
  webos: {
    appId: "com.playarr.tv",
    downloadHref: `${PLAYARR_PUBLIC_ORIGIN}/downloads/webos/playarr-webos.ipk`,
    officialGuideHref:
      "https://webostv.developer.lge.com/develop/getting-started/developer-mode-app",
    sourceHref:
      "https://github.com/ThomasMcFarlane/playarr/tree/main/clients/tv-web/apps/tv-webos",
    steps: [
      [],
      [
        "git clone https://github.com/ThomasMcFarlane/playarr.git",
        "cd playarr/clients/tv-web",
        "npm install -g pnpm@11.13.0",
        "pnpm install --frozen-lockfile",
        "npm install -g @webos-tools/cli",
        "pnpm --filter @playarr-tv/app-webos run package:ipk",
      ],
      [
        'ares-setup-device --add playarr-tv -i "host=<TV-IP>" -i "port=9922" -i "username=prisoner"',
        "ares-novacom --device playarr-tv --getkey",
        "ares-device --system-info --device playarr-tv",
      ],
      [
        "ares-install --device playarr-tv apps/tv-webos/out/com.playarr.tv_*_all.ipk",
        "ares-launch --device playarr-tv com.playarr.tv",
      ],
    ],
  },
  tizen: {
    appId: "StrmarrTV1.Playarr Server",
    downloadHref: `${PLAYARR_PUBLIC_ORIGIN}/downloads/tizen/playarr-tizen.wgt`,
    officialGuideHref:
      "https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html",
    sourceHref:
      "https://github.com/ThomasMcFarlane/playarr/tree/main/clients/tv-web/apps/tv-tizen",
    steps: [
      [],
      [],
      [
        "git clone https://github.com/ThomasMcFarlane/playarr.git",
        "cd playarr/clients/tv-web",
        "npm install -g pnpm@11.13.0",
        "pnpm install --frozen-lockfile",
        "pnpm --filter @playarr-tv/app-tizen... run build",
        "tizen package -t wgt -s <certificate-profile> -- apps/tv-tizen/dist",
      ],
      [
        "sdb connect <TV-IP>",
        "sdb devices",
        "tizen list tv",
        "tizen install -n <generated-package>.wgt -t <target-name> -- apps/tv-tizen/dist",
        "tizen run -p StrmarrTV1.Playarr Server -t <target-name>",
      ],
    ],
  },
};

function SmartTvInstallGuide({
  client,
}: {
  client: PlayarrClient & { id: SmartTvClientId };
}) {
  const { t } = useLanguage();
  const config = SMART_TV_INSTALL_CONFIG[client.id];
  const pageKey = `pages.clients.${client.id}Page` as const;

  return (
    <>
      <section
        className={`android-inline-details client-details-summary smart-tv-overview is-${client.icon}`}
        aria-labelledby={`${client.id}-details-title`}
      >
        <span
          className="client-platform-icon client-details-icon"
          data-client-icon={client.icon}
          aria-hidden="true"
        >
          <ClientPlatformIcon icon={client.icon} />
        </span>
        <p className="page-kicker">{t(client.platformKey)}</p>
        <h1 id={`${client.id}-details-title`}>{t(`${pageKey}.title`)}</h1>
        <p className="smart-tv-description">{t(`${pageKey}.description`)}</p>
        <span className="client-details-status">
          {t("pages.clients.status.developerPreview")}
        </span>
        <p className="smart-tv-package-note" id={`${client.id}-package-note`}>
          {t(`${pageKey}.packageNote`)}
        </p>
        <div className="android-download-actions smart-tv-download-actions">
          <a
            className="profile-action-button"
            href={config.downloadHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby={`${client.id}-package-note`}
            data-navigation-focus-key={`clients:${client.id}:download`}
          >
            <strong>{t(`${pageKey}.download`)}</strong>
          </a>
          <a
            className="profile-action-button profile-action-button-secondary"
            href={config.sourceHref}
            target="_blank"
            rel="noopener noreferrer"
            data-navigation-focus-key={`clients:${client.id}:source`}
          >
            <strong>{t("pages.clients.smartTvPage.openSource")}</strong>
          </a>
        </div>
      </section>

      <section
        className={`vidaa-steps smart-tv-install-guide is-${client.icon}`}
        aria-labelledby={`${client.id}-install-title`}
      >
        <div className="vidaa-section-heading">
          <span aria-hidden="true">01</span>
          <div>
            <p>{t(`${pageKey}.installKicker`)}</p>
            <h2 id={`${client.id}-install-title`}>{t(`${pageKey}.installTitle`)}</h2>
          </div>
        </div>
        <p className="vidaa-section-copy">{t(`${pageKey}.installDescription`)}</p>
        <ol>
          {([1, 2, 3, 4] as const).map((step, index) => (
            <li key={step}>
              <span>0{step}</span>
              <div>
                <h3>{t(`${pageKey}.step${step}Title`)}</h3>
                <p>{t(`${pageKey}.step${step}Description`)}</p>
                {config.steps[index]?.length ? (
                  <ul
                    className="smart-tv-commands"
                    aria-label={t("pages.clients.smartTvPage.commandsAriaLabel", {
                      step,
                    })}
                  >
                    {config.steps[index].map((command) => (
                      <li key={command}>
                        <code>{command}</code>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        <p className="roku-official-guide">
          <a
            href={config.officialGuideHref}
            target="_blank"
            rel="noopener noreferrer"
            data-navigation-focus-key={`clients:${client.id}:official-guide`}
          >
            {t(`${pageKey}.officialGuide`)}
          </a>
        </p>
      </section>

      <section
        className={`vidaa-safety smart-tv-install-note is-${client.icon}`}
        aria-labelledby={`${client.id}-install-note-title`}
      >
        <p className="page-kicker">{t("pages.clients.smartTvPage.noteKicker")}</p>
        <h2 id={`${client.id}-install-note-title`}>{t(`${pageKey}.noteTitle`)}</h2>
        <p>{t(`${pageKey}.noteDescription`, { appId: config.appId })}</p>
      </section>
    </>
  );
}

const SERVER_IMAGE = "ghcr.io/thomasmcfarlane/playarr";

const SERVER_DOCKER_COMPOSE = `services:
  playarr:
    image: ${SERVER_IMAGE}:latest
    container_name: playarr
    restart: unless-stopped
    ports:
      - "8484:8484"
    environment:
      DATABASE_URL: sqlite:///data/playarr.db
      PLAYARR_JWT_SECRET: change-me-to-a-long-random-string
    volumes:
      - playarr-data:/data
volumes:
  playarr-data:`;

const SERVER_INSTALL_COMMANDS: Record<
  "docker" | "compose" | "systemd" | "helm" | "relay",
  readonly string[]
> = {
  docker: [
    `docker pull ${SERVER_IMAGE}:latest`,
    `docker run -d --name playarr --restart unless-stopped -p 8484:8484 -v playarr-data:/data -e DATABASE_URL=sqlite:///data/playarr.db -e PLAYARR_JWT_SECRET="$(openssl rand -hex 32)" ${SERVER_IMAGE}:latest`,
    "curl http://localhost:8484/healthz",
  ],
  compose: [SERVER_DOCKER_COMPOSE, "docker compose up -d"],
  systemd: [
    "tar -xzf playarr-server-linux-amd64.tar.gz",
    "cd playarr-server-*-linux-amd64",
    "sudo ./systemd/install.sh",
    "sudoedit /etc/playarr/playarr.env",
    "sudo systemctl enable --now playarr.service",
    "journalctl -u playarr.service -f",
  ],
  helm: [
    `# set image.repository to ${SERVER_IMAGE} and image.tag to a release version`,
    "helm template playarr infra/kubernetes/helm/playarr-standalone --values my-values.yaml",
  ],
  relay: [
    "PLAYARR_RELAY_REGISTER=true",
    "PLAYARR_ACME_CHALLENGE=relay-dns-01",
    "PLAYARR_ACME_DOMAIN=v4-<A>-<B>-<C>-<D>.relay.playarr.app",
    "PLAYARR_ACME_ACCEPT_TERMS=true",
  ],
};

type ServerArch = "amd64" | "arm64";

interface ServerReleaseAsset {
  url: string;
  sha256: string;
}

interface ServerRelease {
  version: string;
  assets: Partial<Record<ServerArch, ServerReleaseAsset>>;
}

const SERVER_ARCHES: readonly ServerArch[] = ["amd64", "arm64"];
const SERVER_RELEASE_MANIFEST = `${PLAYARR_PUBLIC_ORIGIN}/downloads/server/latest.json`;

/** Shown until the live manifest loads; bump with each server release. */
const SERVER_FALLBACK_VERSION = "0.1.0";

function serverDownloadUrl(arch: ServerArch) {
  return `${PLAYARR_PUBLIC_ORIGIN}/downloads/server/playarr-server-linux-${arch}.tar.gz`;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function parseServerRelease(value: unknown): ServerRelease | null {
  if (typeof value !== "object" || value === null) return null;
  const { version, assets } = value as { version?: unknown; assets?: unknown };
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+[0-9A-Za-z.-]*$/.test(version)) return null;
  if (typeof assets !== "object" || assets === null) return null;
  const parsed: ServerRelease["assets"] = {};
  for (const arch of SERVER_ARCHES) {
    const asset = (assets as Record<string, { url?: unknown; sha256?: unknown } | undefined>)[arch];
    if (typeof asset?.url === "string" && typeof asset.sha256 === "string" && SHA256_PATTERN.test(asset.sha256)) {
      parsed[arch] = { url: asset.url, sha256: asset.sha256 };
    }
  }
  return { version, assets: parsed };
}

/** Reads the latest-release manifest the release workflow publishes; null until it loads (or if it cannot). */
function useServerRelease(): ServerRelease | null {
  const [release, setRelease] = useState<ServerRelease | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(SERVER_RELEASE_MANIFEST, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => setRelease(parseServerRelease(body)))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return release;
}

function ServerInstallDetails({ client }: { client: PlayarrClient }) {
  const { t } = useLanguage();
  const release = useServerRelease();
  const version = release?.version ?? SERVER_FALLBACK_VERSION;
  const commands = (id: keyof typeof SERVER_INSTALL_COMMANDS, label: string) => (
    <ul className="smart-tv-commands" aria-label={label}>
      {SERVER_INSTALL_COMMANDS[id].map((command) => (
        <li key={command}>
          <code>{command}</code>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <section
        className={`android-inline-details client-details-summary smart-tv-overview server-overview is-${client.icon}`}
        aria-labelledby="server-details-title"
      >
        <span
          className="client-platform-icon client-details-icon"
          data-client-icon={client.icon}
          aria-hidden="true"
        >
          <ClientPlatformIcon icon={client.icon} />
        </span>
        <p className="page-kicker">{t("pages.clients.serverPage.kicker")}</p>
        <h1 id="server-details-title">{t("pages.clients.serverPage.title")}</h1>
        <p className="smart-tv-description">
          {t("pages.clients.serverPage.description")}
        </p>
        <span className="client-details-status">
          {t("pages.clients.status.serverRelease", { version })}
        </span>
        <p className="smart-tv-package-note" id="server-package-note">
          {t("pages.clients.serverPage.packageNote")}
        </p>
        <div className="android-download-actions smart-tv-download-actions server-download-actions">
          {SERVER_ARCHES.map((arch) => (
            <a
              key={arch}
              id={`server-download-${arch}`}
              className="profile-action-button"
              href={serverDownloadUrl(arch)}
              download
              data-navigation-focus-key={`clients:server:download:${arch}`}
            >
              <strong>{t(`pages.clients.serverPage.download${arch === "amd64" ? "Amd64" : "Arm64"}`)}</strong>
            </a>
          ))}
        </div>
        <ul className="server-checksums" aria-label={t("pages.clients.serverPage.checksumLabel")}>
          {SERVER_ARCHES.map((arch) => {
            const sha256 = release?.assets[arch]?.sha256;
            return (
              <li key={arch}>
                <span>{`linux-${arch}`}</span>
                {sha256 ? (
                  <code data-server-sha256={arch}>{`SHA-256 ${sha256}`}</code>
                ) : (
                  <a href={`${serverDownloadUrl(arch)}.sha256`} download>
                    {t("pages.clients.serverPage.checksumFile")}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
        <p className="smart-tv-package-note">
          {t("pages.clients.serverPage.verifyNote")}
        </p>
      </section>

      <section
        className="vidaa-steps server-requirements"
        aria-labelledby="server-requirements-title"
      >
        <div className="vidaa-section-heading">
          <span aria-hidden="true">01</span>
          <div>
            <p>{t("pages.clients.serverPage.requirementsKicker")}</p>
            <h2 id="server-requirements-title">
              {t("pages.clients.serverPage.requirementsTitle")}
            </h2>
          </div>
        </div>
        <ol>
          {([1, 2, 3, 4] as const).map((item, index) => (
            <li key={item}>
              <span>0{index + 1}</span>
              <div>
                <h3>{t(`pages.clients.serverPage.req${item}Title`)}</h3>
                <p>{t(`pages.clients.serverPage.req${item}Description`)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section
        className="vidaa-steps server-install-guide"
        aria-labelledby="server-install-title"
      >
        <div className="vidaa-section-heading">
          <span aria-hidden="true">02</span>
          <div>
            <p>{t("pages.clients.serverPage.installKicker")}</p>
            <h2 id="server-install-title">{t("pages.clients.serverPage.installTitle")}</h2>
          </div>
        </div>
        <p className="vidaa-section-copy">
          {t("pages.clients.serverPage.installDescription")}
        </p>
        <ol>
          {(["docker", "compose", "systemd", "helm"] as const).map((method, index) => (
            <li key={method}>
              <span>0{index + 1}</span>
              <div>
                <h3>{t(`pages.clients.serverPage.${method}Title`)}</h3>
                <p>{t(`pages.clients.serverPage.${method}Description`)}</p>
                {commands(method, t(`pages.clients.serverPage.${method}Title`))}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section
        className="vidaa-steps server-connect"
        aria-labelledby="server-connect-title"
      >
        <div className="vidaa-section-heading">
          <span aria-hidden="true">03</span>
          <div>
            <p>{t("pages.clients.serverPage.connectKicker")}</p>
            <h2 id="server-connect-title">{t("pages.clients.serverPage.connectTitle")}</h2>
          </div>
        </div>
        <p className="vidaa-section-copy">
          {t("pages.clients.serverPage.connectDescription")}
        </p>
        <ol>
          <li>
            <span>01</span>
            <div>
              <h3>{t("pages.clients.serverPage.relayTitle")}</h3>
              <p>{t("pages.clients.serverPage.relayDescription")}</p>
              {commands("relay", t("pages.clients.serverPage.relayTitle"))}
            </div>
          </li>
        </ol>
      </section>

      <section
        className="vidaa-safety server-privacy-note"
        aria-labelledby="server-privacy-title"
      >
        <p className="page-kicker">{t("pages.clients.serverPage.privacyKicker")}</p>
        <h2 id="server-privacy-title">{t("pages.clients.serverPage.privacyTitle")}</h2>
        <p>{t("pages.clients.serverPage.privacyDescription")}</p>
      </section>
    </>
  );
}

function ClientOverviewDetails({ client }: { client: PlayarrClient }) {
  const { t } = useLanguage();

  return (
    <section
      className={`android-inline-details client-details-summary is-${client.icon}`}
      aria-labelledby="client-details-title"
    >
      <span
        className="client-platform-icon client-details-icon"
        data-client-icon={client.icon}
        aria-hidden="true"
      >
        <ClientPlatformIcon icon={client.icon} />
      </span>
      <p className="page-kicker">{t(client.platformKey)}</p>
      <h1 id="client-details-title">{t(client.nameKey)}</h1>
      <p>
        {client.descriptionKey
          ? t(client.descriptionKey)
          : t("pages.clients.notYetPublished")}
      </p>
      <span className="client-details-status">
        {t(`pages.clients.status.${client.status}`)}
      </span>
      {client.downloadPath ? (
        <div className="android-download-actions">
          <a
            className="profile-action-button"
            href={`${PLAYARR_PUBLIC_ORIGIN}${client.downloadPath}`}
            download
            data-navigation-focus-key={`clients:${client.id}:download`}
            data-tv-focus-default
          >
            <strong>
              {client.id === "roku"
                ? t("pages.clients.rokuPage.download")
                : t("pages.clients.downloadApp")}
            </strong>
          </a>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The whole /clients experience: bare "/clients" (no :clientId) shows every
 * client as an equal bubble in a grid; "/clients/:clientId" shows the same
 * tiles morphed into a coverflow centred on that one client, plus its
 * install details below. Both URLs resolve to this one component (see the
 * single "/clients/:clientId?" route in App.tsx) specifically so React
 * never unmounts/remounts the tiles when navigating between them -- that
 * persistence is what lets clicking a grid bubble animate into the stack
 * rather than cutting between two separately-rendered pages.
 */
export function ClientsPage() {
  const { clientId } = useParams<{ clientId?: string }>();
  const { t } = useLanguage();
  const client = clientId ? PLAYARR_CLIENTS.find(({ id }) => id === clientId) : undefined;
  useDocumentTitle(
    client?.id === "vidaa"
      ? t("pages.clients.vidaaPage.documentTitle")
      : client
        ? t(client.nameKey)
        : t("pages.clients.documentTitle")
  );

  // A real id that isn't a real client falls back to the grid; the bare
  // index is never itself a "not found" case.
  if (clientId && !client) return <Navigate to="/clients" replace />;

  return (
    <PublicClientsLayout
      backTo={client ? "/clients" : "/profiles"}
      scrollKey={client ? `clients:${client.id}` : "clients:index"}
    >
      <section className="clients-hero" aria-labelledby="clients-title">
        <p className="page-kicker">{t("pages.clients.kicker")}</p>
        <h1 className="auth-title" id="clients-title">
          {t("pages.clients.title")}
        </h1>
      </section>

      <ClientsSelector activeClientId={client?.id} />
      {client ? (
        <>
          <div className="client-details-content">
            {client.id === "vidaa" ? (
              <VidaaInstallDetails />
            ) : client.id === "android" ? (
              <AndroidDownloadDetails />
            ) : client.id === "roku" ? (
              <>
                <ClientOverviewDetails client={client} />
                <RokuInstallGuide />
              </>
            ) : client.id === "server" ? (
              <ServerInstallDetails client={client} />
            ) : client.id === "webos" || client.id === "tizen" ? (
              <SmartTvInstallGuide
                client={client as PlayarrClient & { id: SmartTvClientId }}
              />
            ) : (
              <ClientOverviewDetails client={client} />
            )}
          </div>
          <p className="clients-preview-note">{t("pages.clients.downloadNote")}</p>
          <p className="clients-footer">{t("pages.clients.footer")}</p>
        </>
      ) : null}
    </PublicClientsLayout>
  );
}
