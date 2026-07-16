import { GlobalSearchInput } from "./GlobalSearchInput";
import { UserMenu } from "./UserMenu";

/** Fills the previously-empty `<header className="app-header" />` -- see `App.tsx`. */
export function TopNav() {
  return (
    <>
      <GlobalSearchInput />
      <div className="header-spacer" />
      <UserMenu />
    </>
  );
}
