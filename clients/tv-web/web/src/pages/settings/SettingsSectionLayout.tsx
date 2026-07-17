import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { navigationOriginFromState } from "../../lib/navigationLayer";

interface SettingsSectionLocationState {
  backTo?: unknown;
  navigationOrigin?: unknown;
}

/**
 * Shared chrome for every settings sub-page reached from the hub
 * (`pages/settings/Index.tsx`) -- the back link, kicker/title/description,
 * and the same `.settings-grid` shell the hub itself uses so a lone
 * full-width card lines up visually with the hub's cards. `backTo`/
 * `navigationOrigin` mirror the pattern `WorkDetail.tsx`/`Profiles.tsx` use:
 * the hub always passes `{ backTo: "/settings", navigationOrigin }` when
 * linking here (see `Index.tsx`), and `useTvNavigation`'s `parentRoute`
 * falls back to `/settings` for a `/settings/*` path even without that
 * state (direct navigation, a refresh).
 */
export function SettingsSectionLayout({
  kicker,
  title,
  description,
  children,
}: {
  kicker: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as SettingsSectionLocationState | null;
  const backTo = typeof state?.backTo === "string" ? state.backTo : "/settings";
  const navigationOrigin = navigationOriginFromState(state);

  return (
    <div className="page settings-page">
      <button
        type="button"
        className="back-link"
        onClick={() => (navigationOrigin ? navigate(-1) : navigate(backTo))}
      >
        <span aria-hidden="true">←</span> Settings
      </button>

      <div className="page-intro">
        <p className="page-kicker">{kicker}</p>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{description}</p>
      </div>

      <div className="settings-grid">{children}</div>
    </div>
  );
}
