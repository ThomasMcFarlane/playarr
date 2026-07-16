import { useEffect, useState, type ComponentType } from "react";
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
import {
  PlayerPage,
  type PlayerLocationState,
} from "./pages/Player";
import { SettingsPage } from "./pages/Settings";
import { LoginPage } from "./pages/Login";
import { SearchPage } from "./pages/Search";
import { PlaylistsPage } from "./pages/Playlists";
import { ProfilesPage } from "./pages/Profiles";
import { MusicDetailPage } from "./pages/MusicDetail";
import { UpdateToast } from "./components/UpdateToast";
import {
  HomeIcon,
  MusicIcon,
  MoviesIcon,
  PlaylistsIcon,
  SearchIcon,
  SeriesIcon,
  SitesIcon,
} from "./components/NavIcons";
import type { WorkKind } from "@streamarr-tv/api-client";
import { useAppUpdate } from "./lib/appUpdate";
import { useApiClient, useAuth } from "./lib/ApiClientProvider";
import {
  captureNavigationLayer,
  navigationOriginFromState,
} from "./lib/navigationLayer";
import { useTvNavigation } from "./lib/useTvNavigation";

interface NavItem {
  to: string;
  label: string;
  end: boolean;
  Icon: ComponentType;
  workKind?: WorkKind;
}

interface NavGroup {
  id: string;
  items: ReadonlyArray<NavItem>;
}

export interface AppShellOutletContext {
  availableWorkKinds: ReadonlySet<WorkKind> | null;
}

const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  {
    id: "search",
    items: [{ to: "/search", label: "Search", end: false, Icon: SearchIcon }],
  },
  {
    id: "library",
    items: [
      { to: "/", label: "Home", end: true, Icon: HomeIcon },
      {
        to: "/series",
        label: "Series",
        end: false,
        Icon: SeriesIcon,
        workKind: "series",
      },
      {
        to: "/movies",
        label: "Movies",
        end: false,
        Icon: MoviesIcon,
        workKind: "movie",
      },
      {
        to: "/sites",
        label: "Sites",
        end: false,
        Icon: SitesIcon,
        workKind: "site",
      },
      {
        to: "/music",
        label: "Music",
        end: false,
        Icon: MusicIcon,
        workKind: "artist",
      },
    ],
  },
  {
    id: "playlists",
    items: [
      {
        to: "/playlists",
        label: "Playlists",
        end: false,
        Icon: PlaylistsIcon,
      },
    ],
  },
];

/**
 * The sidebar/header chrome, shared by every authenticated route (a React
 * Router v6 layout route -- its matched children render into `<Outlet/>`).
 * `/login` is a sibling of this layout in `App`'s route tree, not a child
 * of it, so it never gets sidebar/nav chrome -- there's nothing
 * authenticated to navigate to from a pre-auth screen.
 *
 * Also where "not authenticated, nothing worked" is detected and acted on:
 * `authFailed` (see `ApiClientProvider`) flips true the moment a protected
 * request's transparent login fails with no fallback left, and this
 * redirects to `/login` immediately instead of letting the shelled page
 * underneath render its own opaque, un-actionable "sign-in required"
 * error -- exactly the confusing failure mode a real login page fixes.
 */
function AppShell() {
  const client = useApiClient();
  const { authFailed, currentUserName } = useAuth();
  const [availableWorkKinds, setAvailableWorkKinds] =
    useState<ReadonlySet<WorkKind> | null>(null);
  const appUpdate = useAppUpdate(client, "web");
  const location = useLocation();
  const navigate = useNavigate();
  const now = useMinuteClock();
  const playerRouteMatch = matchPath("/player/:mediaFileId", location.pathname);
  const routeMediaFileId = playerRouteMatch?.params.mediaFileId;
  const isPlayerRoute = routeMediaFileId !== undefined;
  const routePlayerState = isPlayerRoute
    ? (location.state as PlayerLocationState | null)
    : null;
  const [playerSession, setPlayerSession] = useState<{
    mediaFileId: string;
    locationState: PlayerLocationState | null;
  } | null>(() =>
    routeMediaFileId
      ? {
          mediaFileId: routeMediaFileId,
          locationState: routePlayerState,
        }
      : null
  );
  const isProfilesRoute = location.pathname === "/profiles";
  const requestedBackTo = (location.state as { backTo?: unknown } | null)?.backTo;
  const backTo = typeof requestedBackTo === "string" ? requestedBackTo : undefined;
  const navigationOrigin = navigationOriginFromState(location.state);
  useTvNavigation(location.pathname, isPlayerRoute, backTo, navigationOrigin);

  useEffect(() => {
    let cancelled = false;
    setAvailableWorkKinds(null);
    void client
      .listCatalogKinds()
      .then((kinds) => {
        if (!cancelled) setAvailableWorkKinds(new Set(kinds));
      })
      .catch(() => {
        if (!cancelled) setAvailableWorkKinds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    if (!routeMediaFileId) return;
    setPlayerSession({
      mediaFileId: routeMediaFileId,
      locationState: routePlayerState,
    });
  }, [location.key, location.state, routeMediaFileId]);

  if (authFailed) {
    // Carries where the viewer was headed so `LoginPage` can return them
    // there on success, instead of always landing on Home.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const activePlayerSession = routeMediaFileId
    ? {
        mediaFileId: routeMediaFileId,
        locationState: routePlayerState,
      }
    : playerSession;

  return (
    <div
      className={`app-shell${isPlayerRoute ? " is-player-route" : ""}${
        isProfilesRoute ? " is-profiles-route" : ""
      }`}
    >
      <UpdateToast state={appUpdate} />

      {!isPlayerRoute && (
        <header className="app-header">
          <div className="app-clock" aria-label={`Local time ${formatTime(now)}`}>
            <span className="app-clock-time">{formatTime(now)}</span>
            <span className="app-clock-date">{formatDate(now)}</span>
          </div>

          <div className="app-utility">
            <div className="app-logo" aria-hidden="true">
              <img className="app-logo-icon" src="/playarr-icon.svg" alt="" />
            </div>
          </div>
        </header>
      )}

      <main className="app-main">
        <Outlet context={{ availableWorkKinds } satisfies AppShellOutletContext} />
      </main>

      {activePlayerSession && (
        <PlayerPage
          mediaFileId={activePlayerSession.mediaFileId}
          locationState={activePlayerSession.locationState}
          minimised={!isPlayerRoute}
          onClose={() => setPlayerSession(null)}
          onMaximise={() => {
            navigate(`/player/${activePlayerSession.mediaFileId}`, {
              state: activePlayerSession.locationState,
            });
          }}
        />
      )}

      {!isPlayerRoute && !isProfilesRoute && (
        <nav className="app-nav" aria-label="Primary navigation">
          {NAV_GROUPS.map((group) => (
            <div
              className={`app-nav-group app-nav-group-${group.id}`}
              key={group.id}
            >
              {group.items
                .filter(
                  (item) =>
                    !item.workKind || availableWorkKinds?.has(item.workKind)
                )
                .map(({ to, label, end, Icon }) => (
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
                    <span className="app-nav-label">{label}</span>
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>
      )}

      {!isPlayerRoute && !isProfilesRoute && (
        <button
          type="button"
          className="app-user-identity"
          aria-label={`Signed in as ${currentUserName ?? "Viewer"}. Open profiles.`}
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
          <span className="app-user-avatar" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path
                d="M12 12.25a4.25 4.25 0 1 0 0-8.5 4.25 4.25 0 0 0 0 8.5Zm-7.25 8c.55-3.42 3.34-5.5 7.25-5.5s6.7 2.08 7.25 5.5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.75"
              />
            </svg>
          </span>
          <span className="app-user-name">{currentUserName ?? "Viewer"}</span>
        </button>
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

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
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
 * management are Streamarr's own concern (see clients/tv-web/admin), not
 * Playarr's. Playarr only ever authenticates as a user and talks to
 * Streamarr's API to browse/play content.
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
      <Route element={<AppShell />}>
        <Route path="/" element={<HomePage />} />
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
        <Route path="/profiles" element={<ProfilesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
