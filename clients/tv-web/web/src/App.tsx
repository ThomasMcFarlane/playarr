import { NavLink, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/Home";
import { LibraryPage } from "./pages/Library";
import { WorkDetailPage } from "./pages/WorkDetail";
import { PlayerPage } from "./pages/Player";
import { SettingsPage } from "./pages/Settings";
import { AdminPage } from "./pages/Admin";
import { UpdateToast } from "./components/UpdateToast";
import { useAppUpdate } from "./lib/appUpdate";
import { useApiClient } from "./lib/ApiClientProvider";

const NAV_LINKS = [
  { to: "/", label: "Home", end: true },
  { to: "/library", label: "Library" },
  { to: "/settings", label: "Settings" },
  { to: "/admin", label: "Admin" },
] as const;

/**
 * Top-level routing for the standalone web app. `/player` now takes a
 * `:mediaFileId` param -- reached from a title's detail page rather than a
 * standalone nav link, since playback always starts from a specific work.
 * `Admin` hosts the real request-management UI (approve/reject
 * `MediaRequest`s against `GET/POST /api/v1/requests`).
 *
 * Also mounts the Web app's OTA self-update flow (`useAppUpdate`) at the
 * top level so the "Update available" toast (or a forced reload once the
 * running bundle drops below the server's version floor) can surface from
 * anywhere in the app -- see `lib/appUpdate.ts`.
 */
export function App() {
  const client = useApiClient();
  const appUpdate = useAppUpdate(client, "web");

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <UpdateToast state={appUpdate} />
      <nav
        style={{
          display: "flex",
          gap: "1.5rem",
          padding: "1rem 1.5rem",
          borderBottom: "1px solid #2a2a2a",
        }}
      >
        {NAV_LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={"end" in link ? link.end : false}
            style={({ isActive }) => ({
              color: isActive ? "#ffffff" : "#a0a0a0",
              textDecoration: "none",
              fontWeight: isActive ? 600 : 400,
            })}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>

      <main style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/library/:workId" element={<WorkDetailPage />} />
          <Route path="/player/:mediaFileId" element={<PlayerPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </main>
    </div>
  );
}
