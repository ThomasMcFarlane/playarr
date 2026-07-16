import { useEffect, useRef, useState } from "react";
import type { UserResponse } from "@streamarr-tv/api-client";
import { useApiClient, useCurrentUserId } from "../lib/ApiClientProvider";
import { handleLogout } from "../lib/auth";

/** Small rotating chevron, duplicated from `App.tsx`'s `ChevronIcon` (that one isn't exported). */
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/**
 * Avatar + name trigger in the header, opening a dropdown with account info
 * and "Sign out" -- replaces the sidebar's old standalone Sign out button
 * (see `App.tsx`).
 *
 * There is no `/auth/me` endpoint, so the display name is a best-effort
 * lookup: `listUsers()` (admin-only) is called once on mount and matched
 * against `useCurrentUserId()`. A non-admin signed-in user will 403 that
 * call -- caught silently, falling back to an avatar-only, name-omitted
 * rendering rather than showing a raw UUID or an error.
 */
export function UserMenu() {
  const client = useApiClient();
  const currentUserId = useCurrentUserId();
  const [user, setUser] = useState<UserResponse | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    client
      .listUsers()
      .then((users) => {
        const match = users.find((u) => u.id === currentUserId);
        setUser(match ?? null);
      })
      .catch(() => setUser(null));
  }, [client, currentUserId]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const initial = user?.display_name ? user.display_name.charAt(0).toUpperCase() : "?";

  return (
    <div className="header-user-menu" ref={menuRef}>
      <button type="button" className="header-user-trigger" onClick={() => setOpen((o) => !o)}>
        <span className="header-user-avatar">{initial}</span>
        {user?.display_name && <span className="header-user-name">{user.display_name}</span>}
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="header-user-dropdown">
          {user && (
            <div className="header-user-dropdown-header">
              <div>{user.display_name}</div>
              {user.email && <div className="muted">{user.email}</div>}
            </div>
          )}
          <button type="button" className="header-user-dropdown-item" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
