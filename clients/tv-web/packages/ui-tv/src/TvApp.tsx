import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiClient, type ClientPlatform, type Work } from "@playarr-tv/api-client";
import type { PlaybackCapabilities } from "@playarr-tv/api-client/react";
import type { DeviceTokenSuccess } from "@playarr-tv/device-auth";
import { evaluateClientVersion, type ClientVersionEvaluation } from "@playarr-tv/domain";
import type { PlaybackEngine } from "@playarr-tv/player-core";
import { SpatialNavProvider } from "./SpatialNavContext";
import { PairingScreenContainer } from "./screens/PairingScreenContainer";
import { BrowseScreenContainer } from "./screens/BrowseScreenContainer";
import { DetailScreenContainer } from "./screens/DetailScreenContainer";
import { PlayerScreenContainer } from "./screens/PlayerScreenContainer";
import { VersionBanner } from "./screens/VersionBanner";

export interface TvAppProps {
  /** Platform `PlaybackEngine` (`ShakaPlaybackEngine` or `TizenAvplayEngine`) -- constructed once by the app shell. */
  engine: PlaybackEngine;
  apiBaseUrl: string;
  clientPlatform: ClientPlatform;
  /**
   * This build's own version (e.g. from the shell's `package.json`, injected
   * at build time), checked once on launch against `GET /api/system/version`'s
   * compatibility table -- see `VersionBanner`. webOS/Tizen/VIDAA-fallback
   * have no OTA loophole (per `docs/versioning-policy.md`'s per-platform
   * table), so this only ever surfaces a non-blocking banner, never forces
   * a reload the way the Web app's update flow does.
   */
  appVersion: string;
  playbackCapabilities?: PlaybackCapabilities;
  /**
   * Rendered behind every screen; only needed by MSE-based engines (Shaka)
   * that attach to a real `<video>` element -- Tizen's AVPlay renders to a
   * native display plane and needs none, so the Tizen shell omits this.
   */
  videoSurface?: ReactNode;
}

type Screen = { name: "browse" } | { name: "detail"; workId: string } | { name: "player"; mediaFileId: string };

/**
 * Top-level screen router shared by all three TV app shells (webOS, Tizen,
 * VIDAA fallback): gates access behind the real RFC 8628 pairing flow, then
 * switches between Browse / Detail / Player, each backed by the real
 * catalog/playback endpoints via the containers in `./screens`.
 */
export function TvApp({ engine, apiBaseUrl, clientPlatform, appVersion, playbackCapabilities, videoSurface }: TvAppProps) {
  // A mutable ref (rather than state) so acquiring/refreshing the token doesn't need to
  // recreate the ApiClient -- `getAccessToken` just reads whatever is current at call time.
  const tokenRef = useRef<string | undefined>(undefined);
  const client = useMemo(
    () => new ApiClient({ baseUrl: apiBaseUrl, getAccessToken: () => tokenRef.current }),
    [apiBaseUrl]
  );

  const [authenticated, setAuthenticated] = useState(false);
  const [screen, setScreen] = useState<Screen>({ name: "browse" });
  const [versionEvaluation, setVersionEvaluation] = useState<ClientVersionEvaluation | null>(null);

  // Check once on launch (not polled) -- see the `appVersion` doc comment
  // above: there is nothing a TV shell can do beyond notify the viewer, so
  // there is no forced-reload/retry loop to drive here the way the Web
  // client's OTA flow needs one.
  useEffect(() => {
    let cancelled = false;
    client
      .getVersion()
      .then((version) => {
        if (cancelled) return;
        setVersionEvaluation(evaluateClientVersion(appVersion, clientPlatform, version.compatibility));
      })
      .catch(() => {
        // Version-check endpoint unreachable -- non-fatal, just skip the banner this session.
      });
    return () => {
      cancelled = true;
    };
  }, [client, appVersion, clientPlatform]);

  function handleAuthenticated(token: DeviceTokenSuccess): void {
    tokenRef.current = token.accessToken;
    setAuthenticated(true);
  }

  function handleSelectWork(work: Work): void {
    setScreen({ name: "detail", workId: work.id });
  }

  return (
    <SpatialNavProvider>
      {versionEvaluation && <VersionBanner evaluation={versionEvaluation} />}
      {videoSurface}

      {!authenticated && (
        <PairingScreenContainer
          client={client}
          clientPlatform={clientPlatform}
          onAuthenticated={handleAuthenticated}
        />
      )}

      {authenticated && screen.name === "browse" && (
        <BrowseScreenContainer client={client} onSelectWork={handleSelectWork} />
      )}

      {authenticated && screen.name === "detail" && (
        <DetailScreenContainer
          client={client}
          workId={screen.workId}
          onPlay={(mediaFileId) => setScreen({ name: "player", mediaFileId })}
          onBack={() => setScreen({ name: "browse" })}
        />
      )}

      {authenticated && screen.name === "player" && (
        <PlayerScreenContainer
          client={client}
          engine={engine}
          mediaFileId={screen.mediaFileId}
          capabilities={playbackCapabilities}
          onExit={() => setScreen({ name: "browse" })}
        />
      )}
    </SpatialNavProvider>
  );
}
