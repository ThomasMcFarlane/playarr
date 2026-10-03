import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { TokenStore } from "@playarr-tv/device-auth";
import { SourceInstancesPage } from "./pages/SourceInstances";
import { UsersPage } from "./pages/Users";
import { UserSettingsPage } from "./pages/UserSettings";
import { LibraryPage } from "./pages/Library";
import { WorkDetailPage } from "./pages/WorkDetail";
import { TasksPage } from "./pages/Tasks";
import { ActivityPage } from "./pages/Activity";
import { SystemSettingsPage } from "./pages/SystemSettings";
import { BackupsPage } from "./pages/Backups";
import { ServerCapabilitiesPage } from "./pages/ServerCapabilities";
import { PeerGroupsPage } from "./pages/PeerGroups";
import { ViewsPage } from "./pages/ViewsPage";
import { ViewEditPage } from "./pages/ViewEditPage";
import { PlaylistsPage } from "./pages/PlaylistsPage";
import { PlaylistEditPage } from "./pages/PlaylistEditPage";
import { LoginPage } from "./pages/Login";
import { useEnsureSignedIn } from "./lib/ApiClientProvider";
import { ApiExplorerProvider } from "./lib/ApiExplorerContext";
import { TopNav } from "./components/TopNav";
import { ChevronIcon } from "./components/ChevronIcon";
import { ApiExplorerNavSection } from "./components/ApiExplorerNav";
import { ApiExplorerToolbar } from "./components/ApiExplorerToolbar";

/**
 * Lazy-loaded: swagger-ui-react (and its swagger-client/apidom dependency
 * chain) adds well over 1MB minified to whatever chunk imports it -- code-
 * splitting it here keeps that weight out of the initial bundle every
 * admin page pays for, since most sessions never open the API Explorer.
 */
const ApiExplorerPage = lazy(() =>
  import("./pages/ApiExplorer").then((m) => ({ default: m.ApiExplorerPage }))
);

const NAV_LINKS = [
  { to: "/", label: "Source instances", end: true },
  { to: "/users", label: "Users", end: false },
] as const;

/**
 * "System" nav group -- a single accordion section (`.sidebar-section`,
 * per DESIGN.md Sec 2.2) whose one child is Tasks, mirroring Sonarr/
 * Radarr's own top-level "System" nav that nests "Tasks"/Activity under
 * it rather than as a flat sidebar item. Neither client app had actually
 * exercised this CSS (it existed unused, see DESIGN.md), so this is the
 * first real usage of the accordion pattern.
 */
const SYSTEM_NAV_LINKS = [
  { to: "/settings", label: "Settings", end: false },
  { to: "/peer-groups", label: "Peer groups", end: false },
  { to: "/capabilities", label: "Server capabilities", end: false },
  { to: "/backups", label: "Backups", end: false },
  { to: "/tasks", label: "Tasks", end: false },
  { to: "/activity", label: "Activity", end: false },
] as const;

/**
 * "Library" nav group -- a single accordion section, same shape as
 * `SystemNavSection`/`SYSTEM_NAV_LINKS`. "Views" (named, saved filter+sort
 * presets over the catalog -- see `playarr_model::LibraryView`'s doc
 * comment, surfaced to Playarr as Home screen shelves) is explicitly a
 * sub-nav item of Library, not its own top-level section -- it was briefly
 * shipped as a standalone "Views" accordion; that was wrong per the
 * original request ("a 'Views' filter for libraries (new sub nav on the
 * left)") and got called out directly.
 */
const LIBRARY_NAV_LINKS = [
  { to: "/library", label: "Browse", end: false },
  { to: "/views", label: "Views", end: false },
  { to: "/playlists", label: "Playlists", end: false },
] as const;

/**
 * Redirects to /login only once a real sign-in attempt (including
 * redeeming a stored refresh token, not just checking the access token's
 * own expiry) has actually failed -- see `ApiClientContextValue.
 * ensureSignedIn`'s doc comment for the exact bug this fixes: an expired-
 * but-refreshable access token used to bounce straight to `/login` every
 * ~15 minutes without ever trying to refresh first, even though the
 * refresh token was still valid the whole time.
 *
 * Renders nothing (not even a spinner -- this check is near-instant when
 * the access token is already valid, the common case, and only briefly
 * pending during an actual refresh round-trip) while `ensureSignedIn` is
 * in flight, to avoid a login-page flash on every normal navigation.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const ensureSignedIn = useEnsureSignedIn();
  const [status, setStatus] = useState<"checking" | "signed-in" | "signed-out">(() =>
    new TokenStore().hasValidAccessToken() ? "signed-in" : "checking"
  );

  useEffect(() => {
    if (status !== "checking") return;
    let cancelled = false;
    ensureSignedIn().then((ok) => {
      if (!cancelled) setStatus(ok ? "signed-in" : "signed-out");
    });
    return () => {
      cancelled = true;
    };
  }, [status, ensureSignedIn]);

  if (status === "checking") return null;
  if (status === "signed-out") {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

/**
 * The "System" accordion nav group -- see `SYSTEM_NAV_LINKS`'s doc comment.
 * Starts open whenever the current route is already one of its children
 * (so a reload/direct link into /tasks doesn't hide its own nav item), and
 * is otherwise toggled by clicking the section header.
 */
function SystemNavSection() {
  const location = useLocation();
  const startsActive = SYSTEM_NAV_LINKS.some((link) => location.pathname.startsWith(link.to));
  const [open, setOpen] = useState(startsActive);

  return (
    <div className={`sidebar-section${open ? " is-open" : ""}`}>
      <button type="button" className="sidebar-section-toggle" onClick={() => setOpen((o) => !o)}>
        System
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="sidebar-section-items">
          {SYSTEM_NAV_LINKS.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `sidebar-link${isActive ? " is-active" : ""}`}
            >
              {label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The "Library" accordion nav group -- see `LIBRARY_NAV_LINKS`'s doc
 * comment. Mirrors `SystemNavSection` exactly (starts open whenever the
 * current route is already one of its children, otherwise toggled by
 * clicking the section header).
 */
function LibraryNavSection() {
  const location = useLocation();
  const startsActive = LIBRARY_NAV_LINKS.some((link) => location.pathname.startsWith(link.to));
  const [open, setOpen] = useState(startsActive);

  return (
    <div className={`sidebar-section${open ? " is-open" : ""}`}>
      <button type="button" className="sidebar-section-toggle" onClick={() => setOpen((o) => !o)}>
        Library
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="sidebar-section-items">
          {LIBRARY_NAV_LINKS.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `sidebar-link${isActive ? " is-active" : ""}`}
            >
              {label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Playarr Server's own admin UI: source-instance registration and user
 * management. Co-hosted by playarr-bin at its own origin (see
 * playarr_api::build_router's `web_assets_dir`) -- this is the operator
 * control plane, not a Playarr client (see clients/tv-web/web for that).
 */
export function App() {
  const location = useLocation();

  return (
    <Routes>
      <Route
        path="/login"
        element={new TokenStore().hasValidAccessToken() ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <ApiExplorerProvider>
              <div className="app-shell">
                <aside className="sidebar">
                  <div className="sidebar-header">
                    <span className="app-logo">
                      <img className="app-logo-icon" src="/playarr-icon.svg" alt="" />
                      <span className="app-logo-accent">Play</span>arr Server
                    </span>
                  </div>
                  <nav className="sidebar-nav">
                    {NAV_LINKS.map(({ to, label, end }) => (
                      <NavLink
                        key={to}
                        to={to}
                        end={end}
                        className={({ isActive }) => `sidebar-link${isActive ? " is-active" : ""}`}
                      >
                        {label}
                      </NavLink>
                    ))}
                    <LibraryNavSection />
                    <SystemNavSection />
                    <ApiExplorerNavSection />
                  </nav>
                </aside>

                <div className="app-content">
                  <header className="app-header">
                    <TopNav />
                  </header>
                  {location.pathname.startsWith("/api-explorer") && <ApiExplorerToolbar />}
                  <main
                    className={`app-main${location.pathname.startsWith("/library") ? " app-main--library" : ""}`}
                  >
                    <Routes>
                      <Route path="/" element={<SourceInstancesPage />} />
                      <Route path="/library" element={<LibraryPage />} />
                      <Route path="/library/:id" element={<WorkDetailPage />} />
                      <Route path="/users" element={<UsersPage />} />
                      <Route path="/users/:id" element={<UserSettingsPage />} />
                      <Route path="/tasks" element={<TasksPage />} />
                      <Route path="/activity" element={<ActivityPage />} />
                      <Route path="/settings" element={<SystemSettingsPage />} />
                      <Route path="/capabilities" element={<ServerCapabilitiesPage />} />
                      <Route path="/backups" element={<BackupsPage />} />
                      <Route path="/peer-groups" element={<PeerGroupsPage />} />
                      <Route
                        path="/api-explorer"
                        element={
                          <Suspense
                            fallback={<div className="muted" style={{ padding: "2rem" }}>Loading API Explorer…</div>}
                          >
                            <ApiExplorerPage />
                          </Suspense>
                        }
                      />
                      <Route path="/views" element={<ViewsPage />} />
                      <Route path="/views/new" element={<ViewEditPage />} />
                      <Route path="/views/:id" element={<ViewEditPage />} />
                      <Route path="/playlists" element={<PlaylistsPage />} />
                      <Route path="/playlists/:id" element={<PlaylistEditPage />} />
                    </Routes>
                  </main>
                </div>
              </div>
            </ApiExplorerProvider>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
