import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  matchPath,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { LibraryPage } from "./pages/Library";
import { HomePage } from "./pages/Home";
import { WorkDetailPage } from "./pages/WorkDetail";
import { DownloadsPage } from "./pages/Downloads";
import {
  PlayerPage,
  type PlayerLocationState,
} from "./pages/Player";
import { SettingsIndexPage } from "./pages/settings/Index";
import { SettingsAppearancePage } from "./pages/settings/Appearance";
import { SettingsLanguagePage } from "./pages/settings/Language";
import { SettingsPlayerPage } from "./pages/settings/Player";
import { SettingsServerPage } from "./pages/settings/Server";
import { SettingsProfileLockPage } from "./pages/settings/ProfileLock";
import { SettingsInvitePage } from "./pages/settings/Invite";
import { SettingsRequestLatencyPage } from "./pages/settings/RequestLatency";
import { SettingsProfileAvatarPage } from "./pages/settings/ProfileAvatar";
import { LoginPage, QrLoginPage } from "./pages/Login";
import { SignupPage } from "./pages/Signup";
import { DeviceLinkPage } from "./pages/DeviceLink";
import { SearchPage } from "./pages/Search";
import { PlaylistsPage } from "./pages/Playlists";
import { ProfilesPage } from "./pages/Profiles";
import { MusicDetailPage } from "./pages/MusicDetail";
import { NotFoundPage } from "./pages/NotFound";
import { ClientsPage } from "./pages/Clients";
import {
  AcceptableUsePage,
  AccountDeletionPage,
  LicencesPage,
  PrivacyPolicyPage,
  TermsPage,
} from "./pages/Legal";
import { UpdateToast } from "./components/UpdateToast";
import { PageScrollRoot } from "./components/PageScrollRoot";
import { TvEmptyState } from "./components/tv/TvEmptyState";
import { ProfileAvatar, useStoredProfileAvatar } from "./components/ProfileAvatar";
import {
  DownloadsIcon,
  HomeIcon,
  MusicIcon,
  MoviesIcon,
  PlaylistsIcon,
  SearchIcon,
  SeriesIcon,
  SitesIcon,
} from "./components/NavIcons";
import type { WorkKind } from "@playarr-tv/api-client";
import { useAppUpdate } from "./lib/appUpdate";
import { useApiBaseUrl, useApiClient, useAuth } from "./lib/ApiClientProvider";
import {
  captureNavigationLayer,
  navigationOriginFromState,
} from "./lib/navigationLayer";
import {
  clearActivePlayerSession,
  hydrateActivePlayerSession,
  readActivePlayerSession,
  writeActivePlayerSession,
  type ActivePlayerSession,
} from "./lib/playerSession";
import { useTvNavigation } from "./lib/useTvNavigation";
import { useOnlineStatus } from "./lib/useOnlineStatus";
import { useDownloads } from "./lib/DownloadsProvider";
import {
  IS_TV,
  PLAYARR_CLIENT_PLATFORM,
  shouldStartTvLink,
} from "./lib/clientPlatform";
import { PRODUCT_NAV_GROUPS } from "./lib/productSurfaces";
import { useLanguage } from "./lib/i18n/LanguageProvider";
import type { TranslationKey } from "./lib/i18n/translations";
import {
  createCatalogKindsCacheScope,
  readCachedCatalogKinds,
  writeCachedCatalogKinds,
} from "./lib/catalogKindsCache";
import { profileAvatarScope } from "./lib/profileAvatar";

const PLAYARR_ICON_URL = `${import.meta.env.BASE_URL}playarr-icon.svg`;

const LOCALE_TAGS: Record<string, string> = {
  en: "en-GB",
  th: "th-TH",
  ja: "ja-JP",
};

interface NavItem {
  to: string;
  labelKey: TranslationKey;
  end: boolean;
  Icon: ComponentType;
  workKind?: WorkKind;
  /** Hidden until `DownloadsProvider`'s `canDownload` and `downloadStorageAvailable` both resolve `true` -- see the render filter below. */
  requiresDownload?: boolean;
}

interface NavGroup {
  id: string;
  items: ReadonlyArray<NavItem>;
}

export interface AppShellOutletContext {
  availableWorkKinds: ReadonlySet<WorkKind> | null;
  activePlayerSession: ActivePlayerSession | null;
  startPlayerSession: (session: ActivePlayerSession) => void;
}

const NAV_ICONS: Record<string, ComponentType> = {
  "/downloads": DownloadsIcon,
  "/search": SearchIcon,
  "/": HomeIcon,
  "/series": SeriesIcon,
  "/movies": MoviesIcon,
  "/sites": SitesIcon,
  "/music": MusicIcon,
  "/playlists": PlaylistsIcon,
};

/** Shell nav hierarchy from productSurfaces (shared with tv-vidaa parity tests). */
const NAV_GROUPS: ReadonlyArray<NavGroup> = PRODUCT_NAV_GROUPS.map((group) => ({
  id: group.id,
  items: group.items.map((item) => {
    const Icon = NAV_ICONS[item.to];
    if (!Icon) {
      throw new Error(`Missing nav icon for ${item.to}`);
    }
    return {
      to: item.to,
      labelKey: item.labelKey as TranslationKey,
      end: item.end,
      Icon,
      workKind: item.workKind,
      requiresDownload: item.requiresDownload,
    };
  }),
}));

function isBackKey(event: KeyboardEvent): boolean {
  return (
    event.key === "Escape" ||
    event.key === "BrowserBack" ||
    event.key === "GoBack" ||
    event.keyCode === 10009 ||
    event.keyCode === 461
  );
}

/**
 * The sidebar/header chrome, shared by every authenticated route (a React
 * Router v6 layout route -- its matched children render into `<Outlet/>`).
 * `/login` is a sibling of this layout in `App`'s route tree, not a child
 * of it, so it never gets sidebar/nav chrome -- there's nothing
 * authenticated to navigate to from a pre-auth screen.
 *
 * Also where "not authenticated, nothing worked" is detected and acted on:
 * `authFailed` (see `ApiClientProvider`) flips true the moment a protected
 * request's transparent login fails with no fallback left. The profile
 * selector is then rendered in place, without replacing the requested URL,
 * so successful sign-in can reveal that exact route.
 */
function AppShell() {
  const client = useApiClient();
  const [apiBaseUrl] = useApiBaseUrl();
  const { t, language } = useLanguage();
  const localeTag = LOCALE_TAGS[language] ?? "en-GB";
  const {
    authFailed,
    connectedServers,
    currentUserId,
    currentUserName,
    savedProfiles,
  } = useAuth();
  const currentAvatarScope = currentUserId
    ? profileAvatarScope(apiBaseUrl, currentUserId)
    : undefined;
  const currentAvatar = useStoredProfileAvatar(
    currentAvatarScope,
    currentUserId,
    client
  );
  const catalogKindsCacheScope = createCatalogKindsCacheScope(
    currentUserId,
    connectedServers.map((server) => server.url)
  );
  const [availableWorkKindsState, setAvailableWorkKindsState] = useState<{
    scope: string | null;
    kinds: ReadonlySet<WorkKind> | null;
  }>(() => ({
    scope: catalogKindsCacheScope,
    kinds: readCachedCatalogKinds(catalogKindsCacheScope),
  }));
  const availableWorkKinds =
    availableWorkKindsState.scope === catalogKindsCacheScope
      ? availableWorkKindsState.kinds
      : null;
  const appUpdate = useAppUpdate(client, PLAYARR_CLIENT_PLATFORM);
  const location = useLocation();
  const navigate = useNavigate();
  const now = useMinuteClock();
  const online = useOnlineStatus();
  const { canDownload, downloadStorageAvailable } = useDownloads();
  const playerRouteMatch = matchPath("/player/:mediaFileId", location.pathname);
  const routeMediaFileId = playerRouteMatch?.params.mediaFileId;
  const isPlayerRoute = routeMediaFileId !== undefined;
  // Downloads (and playback of an already-downloaded item, handled by
  // `isPlayerRoute` below) are the two surfaces designed to keep working
  // fully offline -- everything else this shell routes to needs the
  // network it was already built around, so it shows a plain offline
  // empty-state instead of a half-broken screen full of failed requests.
  const isOfflineGated = !online && !isPlayerRoute && location.pathname !== "/downloads";
  const routePlayerState = isPlayerRoute
    ? (location.state as PlayerLocationState | null)
    : null;
  const [playerSession, setPlayerSession] = useState<ActivePlayerSession | null>(() =>
    routeMediaFileId
      ? {
          mediaFileId: routeMediaFileId,
          locationState: routePlayerState,
        }
      : readActivePlayerSession(currentUserId)
  );
  const playerSessionUserIdRef = useRef(currentUserId);
  const requestedBackTo = (location.state as { backTo?: unknown } | null)?.backTo;
  const backTo = typeof requestedBackTo === "string" ? requestedBackTo : undefined;
  const navigationOrigin = navigationOriginFromState(location.state);
  useTvNavigation(location.pathname, isPlayerRoute, backTo, navigationOrigin);
  const startPlayerSession = useCallback(
    (session: ActivePlayerSession) => {
      setPlayerSession(session);
      writeActivePlayerSession(currentUserId, session);
    },
    [currentUserId]
  );

  useEffect(() => {
    if (!playerSession || isPlayerRoute) return;
    const closeMinimisedPlayer = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      setPlayerSession(null);
      clearActivePlayerSession();
    };
    const closeMinimisedPlayerOnBack = (event: KeyboardEvent) => {
      if (!isBackKey(event)) return;
      closeMinimisedPlayer(event);
    };
    window.addEventListener("playarr:back", closeMinimisedPlayer);
    window.addEventListener("keydown", closeMinimisedPlayerOnBack, true);
    return () => {
      window.removeEventListener("playarr:back", closeMinimisedPlayer);
      window.removeEventListener("keydown", closeMinimisedPlayerOnBack, true);
    };
  }, [isPlayerRoute, playerSession]);

  // Gated on `!authFailed`, and `authFailed` is a dependency: re-authenticating
  // as the same profile after a session expiry flips `authFailed` true -> false
  // without `catalogKindsCacheScope`/`client` ever changing, and this is the
  // only dependency that transition touches -- omitting it risked a fetch that
  // failed while auth was broken leaving `availableWorkKinds` stuck on the
  // fail-closed empty set (when there's no cache to fall back on) until a full
  // page reload.
  useEffect(() => {
    if (authFailed) return;
    let cancelled = false;
    const cachedKinds = readCachedCatalogKinds(catalogKindsCacheScope);
    setAvailableWorkKindsState({
      scope: catalogKindsCacheScope,
      kinds: cachedKinds,
    });
    void client
      .listCatalogKinds()
      .then((kinds) => {
        writeCachedCatalogKinds(catalogKindsCacheScope, kinds);
        if (!cancelled) {
          // Always apply the server's answer once it arrives, even over a
          // cached value shown for the instant paint -- library ACL can
          // change mid-session (e.g. an admin revoking a source instance),
          // and a stale cache must not keep a now-forbidden nav item visible
          // for the rest of this sign-in.
          setAvailableWorkKindsState({
            scope: catalogKindsCacheScope,
            kinds: new Set(kinds),
          });
        }
      })
      .catch(() => {
        if (!cancelled && !cachedKinds) {
          setAvailableWorkKindsState({
            scope: catalogKindsCacheScope,
            kinds: new Set(),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authFailed, catalogKindsCacheScope, client]);

  useEffect(() => {
    if (!routeMediaFileId) return;
    const session = {
      mediaFileId: routeMediaFileId,
      locationState: routePlayerState,
    };
    setPlayerSession(session);
    writeActivePlayerSession(currentUserId, session);
  }, [currentUserId, location.key, location.state, routeMediaFileId]);

  useEffect(() => {
    const previousUserId = playerSessionUserIdRef.current;
    if (previousUserId === currentUserId) return;
    playerSessionUserIdRef.current = currentUserId;

    if (previousUserId !== undefined || currentUserId === undefined) {
      setPlayerSession(null);
      clearActivePlayerSession();
      return;
    }

    const hydratedSession = hydrateActivePlayerSession(playerSession, currentUserId);
    if (hydratedSession) {
      setPlayerSession(hydratedSession);
      writeActivePlayerSession(currentUserId, hydratedSession);
    }
  }, [currentUserId, playerSession]);

  if (shouldStartTvLink(IS_TV, currentUserId, savedProfiles.length)) {
    return <Navigate to="/login/qr" replace state={{ from: location }} />;
  }

  if (authFailed) {
    return (
      <ProfilesPage
        loginFrom={`${location.pathname}${location.search}${location.hash}`}
      />
    );
  }

  const activePlayerSession = routeMediaFileId
    ? {
        mediaFileId: routeMediaFileId,
        locationState: routePlayerState,
      }
    : playerSession;
  const activePlayerBackTo = activePlayerSession?.locationState?.backTo;
  const activePlayerIsMusic =
    typeof activePlayerBackTo === "string" &&
    /^\/music\/[^/?]+$/.test(activePlayerBackTo);
  const inlineMusicPlayer =
    !isPlayerRoute &&
    activePlayerIsMusic &&
    location.pathname === activePlayerBackTo;

  return (
    <div
      className={`app-shell${isPlayerRoute ? " is-player-route" : ""}`}
    >
      <UpdateToast state={appUpdate} />

      {!isPlayerRoute && (
        <header className="app-header">
          <div
            className="app-clock"
            aria-label={t("shell.clock.ariaLabel", {
              time: formatTime(now, localeTag),
            })}
          >
            <span className="app-clock-time">{formatTime(now, localeTag)}</span>
            <span className="app-clock-date">{formatDate(now, localeTag)}</span>
          </div>

          <div className="app-utility">
            <div className="app-logo" aria-hidden="true">
              <img
                className="app-logo-icon"
                src={PLAYARR_ICON_URL}
                alt=""
              />
            </div>
          </div>
        </header>
      )}

      {isOfflineGated ? (
        <div className="page tv-state-page">
          <TvEmptyState
            graphic="details"
            variant="page"
            title={t("shell.offline.title")}
            description={t("shell.offline.description")}
          />
        </div>
      ) : (
        <PageScrollRoot scrollKey={`page:${location.pathname}`}>
          <Outlet
            context={{
              availableWorkKinds,
              activePlayerSession,
              startPlayerSession,
            } satisfies AppShellOutletContext}
          />
        </PageScrollRoot>
      )}

      {activePlayerSession && (
        <PlayerPage
          mediaFileId={activePlayerSession.mediaFileId}
          locationState={activePlayerSession.locationState}
          minimised={!isPlayerRoute}
          inlineMusic={inlineMusicPlayer}
          onSessionChange={(mediaFileId, locationState) =>
            startPlayerSession({ mediaFileId, locationState })
          }
          onClose={() => {
            setPlayerSession(null);
            clearActivePlayerSession();
          }}
          onMaximise={() => {
            if (activePlayerIsMusic && activePlayerBackTo) {
              navigate(activePlayerBackTo, {
                state: {
                  backTo:
                    activePlayerSession.locationState?.detailParentBackTo ??
                    "/music",
                  mediaFileId: activePlayerSession.mediaFileId,
                  navigationOrigin:
                    activePlayerSession.locationState?.detailNavigationOrigin,
                },
              });
              return;
            }
            navigate(`/player/${activePlayerSession.mediaFileId}`, {
              state: activePlayerSession.locationState,
            });
          }}
        />
      )}

      {!isPlayerRoute && availableWorkKinds !== null && (
        <nav className="app-nav" aria-label={t("shell.nav.ariaLabel")}>
          {NAV_GROUPS.map((group) => (
            <div
              className={`app-nav-group app-nav-group-${group.id}`}
              key={group.id}
            >
              {group.items
                .filter(
                  (item) =>
                    (!item.workKind || availableWorkKinds?.has(item.workKind)) &&
                    (!item.requiresDownload || (canDownload === true && downloadStorageAvailable === true))
                )
                .map(({ to, labelKey, end, Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      `app-nav-link${isActive ? " is-active" : ""}`
                    }
                  >
                    <span className="app-nav-icon">
                      <Icon />
                    </span>
                    <span className="app-nav-label">{t(labelKey)}</span>
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>
      )}

      {!isPlayerRoute && (
        <div className="app-user-identity-cluster">
          <button
            type="button"
            className="app-user-identity"
            aria-label={t("shell.user.ariaLabel", {
              name: currentUserName ?? t("shell.user.viewerFallback"),
            })}
            data-navigation-focus-key="shell:user"
            onClick={(event) => {
              const origin = captureNavigationLayer(
                location.pathname,
                location.key,
                event.currentTarget
              );
              navigate("/profiles", {
                state: {
                  backTo: `${location.pathname}${location.search}`,
                  navigationOrigin: origin,
                },
              });
            }}
          >
            {currentAvatar ? (
              <ProfileAvatar
                className="app-user-avatar"
                preference={currentAvatar}
              />
            ) : (
              <span className="app-user-avatar" aria-hidden="true" />
            )}
            <span className="app-user-name">
              {currentUserName ?? t("shell.user.viewerFallback")}
            </span>
          </button>
          <span className="app-user-version" aria-hidden="true">
            v{__APP_VERSION__}
          </span>
        </div>
      )}
    </div>
  );
}

function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  return now;
}

function formatTime(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDate(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "long",
  }).format(date);
}

/**
 * Top-level routing for Playarr Web -- the consumer streaming client
 * (browse/watch), one of the Playarr client family alongside Android/iOS/
 * TV. `/player` takes a `:mediaFileId` param -- reached from a title's
 * detail page rather than a standalone nav link, since playback always
 * starts from a specific work. `/login` is real username/password sign-in
 * (`pages/Login.tsx`) -- see `AppShell`'s doc comment for how a page ends
 * up there.
 *
 * This app has no admin surface -- source-instance registration and user
 * management are Playarr Server's own concern (see clients/tv-web/admin), not
 * Playarr's. Playarr only ever authenticates as a user and talks to
 * Playarr Server's API to browse/play content.
 *
 * `AppShell` mounts Playarr Web's OTA self-update flow (`useAppUpdate`) so
 * the "Update available" toast (or a forced reload once the running bundle
 * drops below the server's version floor) can surface from anywhere in the
 * authenticated app -- see `lib/appUpdate.ts`.
 */
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/login/qr" element={<QrLoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/link" element={<DeviceLinkPage />} />
      <Route path="/profiles" element={<ProfilesPage />} />
      <Route path="/clients/:clientId?" element={<ClientsPage />} />
      <Route path="/download" element={<Navigate to="/clients" replace />} />
      <Route path="/install" element={<Navigate to="/clients" replace />} />
      <Route path="/legal/privacy" element={<PrivacyPolicyPage />} />
      <Route path="/legal/terms" element={<TermsPage />} />
      <Route path="/legal/acceptable-use" element={<AcceptableUsePage />} />
      <Route path="/legal/licences" element={<LicencesPage />} />
      <Route path="/legal/account-deletion" element={<AccountDeletionPage />} />
      <Route element={<AppShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/downloads" element={<DownloadsPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/search/:workId" element={<WorkDetailPage />} />
        <Route path="/library" element={<Navigate to="/series" replace />} />
        <Route path="/library/:workId" element={<WorkDetailPage />} />
        <Route path="/series" element={<LibraryPage kind="series" />} />
        <Route path="/series/:workId" element={<WorkDetailPage />} />
        <Route path="/movies" element={<LibraryPage kind="movie" />} />
        <Route path="/movies/:workId" element={<WorkDetailPage />} />
        <Route path="/sites" element={<LibraryPage kind="site" />} />
        <Route path="/sites/:workId" element={<WorkDetailPage />} />
        <Route path="/music" element={<LibraryPage kind="artist" />} />
        <Route path="/music/:workId" element={<MusicDetailPage />} />
        <Route path="/playlists" element={<PlaylistsPage />} />
        <Route path="/playlists/:workId" element={<WorkDetailPage />} />
        <Route path="/player/:mediaFileId" element={null} />
        <Route path="/settings" element={<SettingsIndexPage />}>
          <Route index element={<SettingsAppearancePage />} />
          <Route path="appearance" element={<SettingsAppearancePage />} />
          <Route path="profile-avatar" element={<SettingsProfileAvatarPage />} />
          <Route path="language" element={<SettingsLanguagePage />} />
          <Route path="player" element={<SettingsPlayerPage />} />
          <Route path="server" element={<SettingsServerPage />} />
          <Route path="profile-lock" element={<SettingsProfileLockPage />} />
          <Route path="invite" element={<SettingsInvitePage />} />
          <Route path="request-latency" element={<SettingsRequestLatencyPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
