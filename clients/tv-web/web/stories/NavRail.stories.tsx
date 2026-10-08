import type { Meta, StoryObj } from "@storybook/react-vite";
import { NavLink, MemoryRouter } from "react-router-dom";
import { CalendarIcon, DownloadsIcon, HomeIcon, MoviesIcon, MusicIcon, PlaylistsIcon, SearchIcon, SeriesIcon, SettingsIcon, WatchlistIcon } from "../src/components/NavIcons";

// Mirrors the markup of `<nav className="app-nav">` in src/App.tsx; the classes and icons are the real ones.
const GROUPS = [
  { id: "search", items: [{ to: "/downloads", label: "Downloads", Icon: DownloadsIcon }, { to: "/search", label: "Search", Icon: SearchIcon }] },
  {
    id: "library",
    items: [
      { to: "/", label: "Home", Icon: HomeIcon },
      { to: "/series", label: "Series", Icon: SeriesIcon },
      { to: "/movies", label: "Movies", Icon: MoviesIcon },
      { to: "/music", label: "Music", Icon: MusicIcon },
      { to: "/playlists", label: "Playlists", Icon: PlaylistsIcon },
      { to: "/watchlist", label: "Watchlist", Icon: WatchlistIcon },
      { to: "/calendar", label: "Calendar", Icon: CalendarIcon },
      { to: "/settings", label: "Settings", Icon: SettingsIcon },
    ],
  },
];

function NavRail({ active }: { active: string }) {
  return (
    <MemoryRouter initialEntries={[active]}>
      <div className="app-shell" style={{ minHeight: "100vh" }}>
        <nav className="app-nav" aria-label="Main">
          {GROUPS.map((group) => (
            <div className={`app-nav-group app-nav-group-${group.id}`} key={group.id}>
              {group.items.map(({ to, label, Icon }) => (
                <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `app-nav-link${isActive ? " is-active" : ""}`}>
                  <span className="app-nav-icon">
                    <Icon />
                  </span>
                  <span className="app-nav-label">{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </div>
    </MemoryRouter>
  );
}

const meta = { title: "Components/Nav rail", component: NavRail, tags: ["autodocs"], args: { active: "/movies" }, argTypes: { active: { control: "select", options: ["/", "/series", "/movies", "/music", "/playlists", "/watchlist", "/calendar", "/settings", "/downloads", "/search"] } } } satisfies Meta<typeof NavRail>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
