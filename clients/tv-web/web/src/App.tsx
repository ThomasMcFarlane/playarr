import { NavLink, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/Home";
import { LibraryPage } from "./pages/Library";
import { PlayerPage } from "./pages/Player";
import { SettingsPage } from "./pages/Settings";
import { AdminPage } from "./pages/Admin";

const NAV_LINKS = [
  { to: "/", label: "Home", end: true },
  { to: "/library", label: "Library" },
  { to: "/player", label: "Player" },
  { to: "/settings", label: "Settings" },
  { to: "/admin", label: "Admin" },
] as const;

/**
 * Placeholder top-level routing for the standalone web app. `Admin` is
 * reserved for the future request-management UI (approve/reject
 * `MediaRequest`s) per the plan; it's routed and stubbed now so the nav
 * shape is real even before that screen is built out.
 */
export function App() {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
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
          <Route path="/player" element={<PlayerPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </main>
    </div>
  );
}
