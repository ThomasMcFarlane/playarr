import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { captureNavigationLayer } from "../../lib/navigationLayer";

export interface ProfileNavLinkProps {
  /** The signed-in profile's full name: the accessible name and the tooltip. */
  displayName: string;
  ariaLabel: string;
  /** Avatar drawn where the other tiles draw their icon. */
  avatar: ReactNode;
  /** Where Back returns to, and the history entry the tile was opened from. */
  backTo: string;
  route: string;
  entryKey: string;
}

/** The tile label: the first name, cut with an ellipsis by CSS when it does not fit the tile. */
export function shortProfileName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || displayName;
}

/**
 * The profile tile at the foot of the left nav. A real router link, so a plain click navigates client-side and
 * modifier clicks, middle click and the context menu get the browser's own behaviour.
 */
export function ProfileNavLink({ displayName, ariaLabel, avatar, backTo, route, entryKey }: ProfileNavLinkProps) {
  return (
    <Link
      to="/profiles"
      state={{ backTo, navigationOrigin: { route, entryKey } }}
      className="app-nav-link app-user-identity"
      aria-label={ariaLabel}
      title={displayName}
      data-navigation-focus-key="shell:user"
      onClick={(event) => {
        captureNavigationLayer(route, entryKey, event.currentTarget);
      }}
    >
      <span className="app-nav-icon">{avatar}</span>
      <span className="app-nav-label app-user-name">{shortProfileName(displayName)}</span>
    </Link>
  );
}
