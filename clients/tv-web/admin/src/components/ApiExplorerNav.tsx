import { useState, type MouseEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { useApiExplorer } from "../lib/ApiExplorerContext";
import { ChevronIcon } from "./ChevronIcon";

const INTRODUCTION_HASH = "#description/introduction";

/**
 * Same-page hash links (jumping between tag sections) need to actually
 * notify Scalar, which only finds out about a URL change via the native
 * `hashchange` event -- and `history.pushState` (what `<Link>`/`navigate`
 * use under the hood) deliberately does *not* fire one. Confirmed live:
 * clicking a `<Link>`-based tag link updated the URL and this sidebar's own
 * active-highlight, but Scalar's content pane silently stayed on whatever
 * section it was already showing.
 *
 * Assigning `window.location.hash` directly *does* fire `hashchange` (it's
 * the same code path a real `<a href="#x">` click takes), so that's used
 * instead whenever we're already on `/api-explorer` -- only a genuine
 * cross-route navigation (arriving at `/api-explorer` for the first time)
 * goes through the normal `<Link>`/router path, since Scalar reads the
 * initial hash itself on mount.
 */
function handleHashLinkClick(event: MouseEvent<HTMLAnchorElement>, alreadyOnPage: boolean, hash: string) {
  if (!alreadyOnPage) return;
  event.preventDefault();
  window.location.hash = hash;
}

/**
 * The "API Explorer" accordion section in the app's own (always-visible,
 * viewport-fixed) sidebar -- see `ApiExplorerContext`'s doc comment for why
 * this and `ApiExplorerPage` share state via context rather than props.
 *
 * Previously the API Explorer rendered its own inner navigation sidebar
 * (Scalar's built-in one, `showSidebar: true`); that's gone, replaced by
 * this section, since it's the sidebar that's actually pinned to the
 * viewport instead of scrolling away with the page content. The tag links
 * below set `location.hash` to the same values Scalar's own hash-based
 * routing already understands (confirmed live, e.g. clicking into
 * "catalog" navigates to `#tag/catalog`), so Scalar still drives which
 * section is shown -- this is a second way to reach the same navigation
 * state, not a reimplementation of it.
 *
 * Impersonation is deliberately NOT here -- it lives in
 * `ApiExplorerToolbar`, a second nav bar directly under the app's main
 * header, not nested inside this (or any) sidebar section.
 */
export function ApiExplorerNavSection() {
  const location = useLocation();
  const startsActive = location.pathname.startsWith("/api-explorer");
  const [open, setOpen] = useState(startsActive);
  const { tags } = useApiExplorer();

  const currentHash = startsActive ? location.hash : "";

  return (
    <div className={`sidebar-section${open ? " is-open" : ""}`}>
      <Link
        to="/api-explorer"
        className={`sidebar-section-toggle${startsActive ? " is-open" : ""}`}
        onClick={(event) => {
          // A real link (not a button) so the section header itself
          // navigates to the page -- but also toggles open/closed like
          // every other accordion header, so clicking it a second time
          // while already on the page doesn't just no-op.
          if (startsActive) {
            event.preventDefault();
            setOpen((o) => !o);
          } else {
            setOpen(true);
          }
        }}
      >
        API Explorer
        <ChevronIcon open={open} />
      </Link>
      {open && (
        <div className="sidebar-section-items">
          <Link
            to={`/api-explorer${INTRODUCTION_HASH}`}
            className={`sidebar-link${currentHash === INTRODUCTION_HASH ? " is-active" : ""}`}
            onClick={(event) => handleHashLinkClick(event, startsActive, INTRODUCTION_HASH)}
          >
            Introduction
          </Link>
          {tags.map((tag) => {
            const hash = `#tag/${tag.name}`;
            return (
              <Link
                key={tag.name}
                to={`/api-explorer${hash}`}
                className={`sidebar-link${currentHash === hash ? " is-active" : ""}`}
                title={tag.description}
                onClick={(event) => handleHashLinkClick(event, startsActive, hash)}
              >
                {tag.name}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
