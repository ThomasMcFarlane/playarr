import { useEffect } from "react";

/**
 * Sets `document.title` for as long as the calling page is mounted --
 * `index.html`'s static `<title>Streamarr Admin</title>` only covers the
 * very first paint; without this every route keeps whatever title the
 * last-visited route left behind (or the static default forever), which is
 * exactly the "no real page titles" gap reported live: the browser tab
 * still read "Streamarr Admin" after navigating to Library/Tasks/Users.
 *
 * No cleanup on unmount -- the next page's own `useDocumentTitle` call sets
 * the title it wants, so there's nothing to restore.
 */
export function useDocumentTitle(section?: string): void {
  useEffect(() => {
    document.title = section ? `${section} · Streamarr` : "Streamarr Admin";
  }, [section]);
}
