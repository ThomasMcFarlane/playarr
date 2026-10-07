# Page layout: one anatomy, enforced

Status: spec, 7 October 2026 (row 800); owner decisions recorded 7 and 8 October (section 10). Web is the source of truth. Applies to every client.

Owner order: every Playarr page uses one page layout, so page chrome can no longer drift between pages or between clients.
Trigger: a change restyled the library Filters button to match the Calendar, the reverse of what was asked.

> **Changing the look of a shared layout component needs an explicit owner request that names the reference.**
> This covers `PageLayout`, `PageHeader`, `PageActions`, `ActionPill`, `ScrollArea` and the state components, together with their tokens, CSS and goldens.
> A parity fix, a "consistency" pass or a request about one page is not such a request.
> A PR that changes them must carry the trailer line `Layout-Change: owner request <date>, reference <screen id or component>` in its body.
> CI enforces this ([section 7.4](#74-owner-request-gate)).

The **reference** for the action pill (owner decision Q1) is "whatever was on Web a week ago": the web library Filters button as of 30 September 2026, taken from git history. It is used on every client.
- The pinned commit is `54224f36`, the last `main` commit before the end of 30 September (UTC).
- At that commit the button is `button.tv-filter-launcher` in `clients/tv-web/web/src/pages/Library.tsx`, styled by the `.tv-filter-launcher` rules in `src/styles/global.css`. Section 2.1 quotes them.
- It is **not** today's `.page-filters-button` header pill. PR 164 introduced that pill on 4 October, replacing the launcher.
- Do not restyle the reference to match anything else. Everything else is restyled to match it.

## 1. Audit summary (7 October 2026)

The full per-page inventory is in [Appendix A](#appendix-a-audit-inventory). Headline findings follow.

### Web (`clients/tv-web/web/src`)

These parts are already in place and are the basis of this spec:
- `PageHeader`: back, title, detail, and an ordered action slot.
- The `filters`/`panelButtons` slots.
- `FiltersButton`/`PanelButton`, both on `Button variant="secondary" className="page-filters-button"`.
- `TvEmptyState`.
- `useScrollEdges`.
- The page-header registry test.

Gaps:
1. **The guards do not run on pull requests.** `pageHeaderRegistry.test.ts`, `buttonAudit.test.ts` and `drawerAudit.test.ts` are vitest tests. `ci-required` (`tv-web-check`) runs only lint and typecheck. The web package has no `lint` script, and vitest runs only in the post-merge deploy workflow (`web-ci.yml`). The guards therefore never block a PR.
2. **There are two page frames.** Most pages use `TvStageShell` with an absolute `.tv-library-heading` header and an absolute `.tv-rail-panel.tv-library-grid-panel` body:
   - Library, Playlists, Search, Downloads, Watchlist, Requests, Customise Home and Settings.
   - Detail pages, through `TvDetailHeading`.

   Only Calendar and Folders use `PageShell`, which is a padded flex frame.
3. **Per-page header overrides.** `PageHeader` accepts `className`/`detailClassName`, and pages use these to move the header:
   - `.tv-playlists-heading` sets right 176px on mobile.
   - `.tv-music-heading` sets 66px.
   - `.tv-search-heading` is also a per-page override.

   This is the drift vector.
4. **Customise Home bypasses the header.** It is a `ButtonLink size="sm"` positioned absolutely at top 16–32px, which is off the header row (34–66px). It has an opaque background, a smaller height and no icon.
5. **Four loading patterns.** There is no shared loading component:
   - `tv-compact-loading` with the orbit loader.
   - `tv-detail-loading`.
   - `p.tv-discovery-note`.
   - `SkeletonBlock`.

   Library and detail pages replace the whole page, header included, while loading.
6. **Error colour is split.** Pages use `.error-text` (`--danger`) or `.tv-watchlist-error` (hard-coded `#cf3157`), among others.
7. **Edge fades have three implementations:**
   - The panel glow, `.tv-library-grid-panel.can-scroll-*`.
   - `.tv-scroll-edge-window`.
   - The `.tv-media-track-window` mask and glow.

   `.tv-home-rail-window` is dead CSS. Calendar, Folders, Downloads, Watchlist, Requests, Customise Home and Settings have no fades. On Settings, the panel never gets `can-scroll-*`.
8. **Dead or contradictory hooks:**
   - `.page-header-stack` has no CSS rule.
   - `.page-header-actions.is-stacked` is dead.
   - `--page-safe-left` is defined but unused.
   - `--library-rail-*` is defined twice, with different values.
   - The pill height `clamp(38px,2.8vw,50px)` and the header top `clamp(34px, calc(5.2*var(--viewport-unit)), 66px)` are repeated as literals five or more times.
9. **Other defects:**
   - Calendar renders its period navigation twice: in the header, and inline on phones.
   - Detail pages render two `<h1>`.
   - `.tv-downloads-content` is marked as a scroll container but has no `overflow`.
   - `.calendar-scroll` lacks `data-tv-scroll-container`.
   - `SettingsSectionLayout` ignores its `title`/`kicker`/`description` props.
   - The Household registry reason is wrong.
   - Calendar overrides the focus ring for the whole page.

### Android (`clients/android`)

`PlayarrPageScaffold` (`app/.../ui/PlayarrPageScaffold.kt`) already exists, with back, title, breadcrumb, `filters`, `panelActions` and `trailingNav`. `PlayarrPageScaffoldRegistryTest` enforces it. Gaps:
1. **The Filters pill has three implementations:**
   - `PlayarrHeaderButton`, used by the scaffold.
   - The TV Search pill (absolute offset, 56 dp, no border).
   - The phone Search pill (42 dp).

   Customise Home has two more: a phone `Surface` and a TV `PlayarrButton` on Material colours.
2. **#154 (664185c7) restyled the shared `PlayarrHeaderButton`.** It turned it into the outlined Calendar pill on every page that uses it (Library, Playlists and Folders) and dropped its focus ring and scale. This is the regression the filter-fix worker is reverting.
3. **The phone branch of `PlayarrHeaderButton` ignores `icon`.** Playlists "Create" therefore draws the Filters glyph on phones.
4. **No focus ring on header pills, and no shared ring.** Focus rings are 3 dp `colorScheme.primary`, 3 dp `WebPink` (grey), 2 dp white (player), or none.
5. **Three loading and error families:** `Experience*`, `Parity*` and `Folders*`, plus Calendar's inline one. Library, Detail and Playlist detail show loading and failure without the frame or the back button.
6. **No spacing tokens.** Page gutters are literals: `154.dp` appears nine times outside the helpers. Bottom paddings are 96, 104, 108, 110, 118 and 120 dp. The music detail TV inset is 118 dp, where everything else uses 154 dp.
7. **Edge fades:** none on scroll containers. Only hero masks and the phone Home rail right edge have one.
8. **Other defects:**
   - The palette (`Web*`) lives in `app` as a plain `var`, so changes are not observable by Compose, and it is outside `core-designsystem`.
   - `PlayarrPageHeader` in `PlayarrExperience.kt` is dead code.
   - Library filter choices duplicate `PlayarrViewToggle`.
   - Playlists filters use `PlayarrPanel`, not `PlayarrFiltersSheet`.

**Established patterns (canonical, by majority):**
- Web: the `TvStageShell` frame with `PageHeader` and the rail-panel body.
- Android: the scaffold with `padBody = true` and a `LazyColumn`, with the states inside the frame.

## 2. Page anatomy

```
┌ rail ┐┌──────────────────────────── PageLayout ─────────────────────────────┐
│      ││ PageHeader  [←] Title │ DETAIL              clock    [nav group]    │  header row
│      ││                                                       [ Create ] ◄──┼─ shell action column
│      ││                                                       [ Filters ]   │  (right edge, vertical)
│      ││ ┌──────────────────────── body (ScrollArea) ──────────────────────┐ │
│      ││ │ ▒ top fade (only when content continues above)                  │ │
│      ││ │   content: grid / list / rails / panels                         │ │
│      ││ │   or exactly one of LoadingState / EmptyState / ErrorState      │ │
│      ││ │ ▒ bottom fade                                                   │ │
│      ││ └─────────────────────────────────────────────────────────────────┘ │
│      ││ safe bottom (profile chip zone)                                     │
└──────┘└─────────────────────────────────────────────────────────────────────┘
```

**Rules**
1. **One header per page, always rendered.** The header stays up while the page loads, errors or is empty, so Back is always reachable. Exceptions are listed in the exemption registries (section 7.1):
   - Home has no back and no title, but it does have `PageActions`.
   - Player.
   - Profile picker, Household gate and pre-auth pages.
   - NotFound.
2. **Header row geometry is fixed by tokens.** The row grows to the height of the action pill tile (Q9), and Back, the title, the clock and every action centre vertically on the tile. A page cannot move, resize or recolour the header or its controls. No `className` or `Modifier` reaches them.
3. **Header row and shell action column (owner ruling, 8 October 2026, Q1b; overrides the earlier header-slot rule).**
   1. The header row holds Back, the title and detail, the clock and the page's `navigation` group (for example the calendar's ‹ Today ›). It holds no side-panel or action pills.
   2. Every side-panel and action button (Filters, Create, Calendar link and any other button that opens a side panel) lives in the **shell action column**, one column owned by the app shell: `position: absolute` once, in the shell, at `right: var(--directory-controls-edge)`, `width: var(--directory-controls-width)`, `top: clamp(116px, calc(14 * var(--viewport-unit)), 164px)`, exactly where the 30 September launcher sat (`54224f36`).
   3. The buttons stack **vertically**, in the order the page gives them, **Filters last (lowest)**: Create above Filters on Playlists, Calendar link above Filters on the Calendar. Gap `clamp(10px, calc(1.2 * var(--viewport-unit)), 16px)`.
   4. On phones (as on 30 September) the column becomes a row of 44px icon squares, top `--mobile-top-inset`, right `66px`, left of the profile avatar, in the same order.
   5. Pages register their buttons through `PageHeader` (`filters`, `panelButtons`), which portals them into the column (`ShellActionColumnSlot`). A page never renders or positions these buttons itself; `PageHeader.test.tsx` fails when a page names `FiltersButton`, `PanelButton`, `page-filters-button` or `tv-filter-launcher`.
4. **One `ActionPill` look for every header action**: Filters, Calendar link, Create and Customise Home (owner decision Q3). It is the reference look in section 2.1. The only variants are:
   - `tile`: the reference, with the icon above a small label. On mobile it is a 44px icon-only square with the same radius.
   - `icon`: round, used by Back and the period arrows. It stays round (Q10), keeps today's geometry and takes only the shared focus ring (Q2, Q11).
   - `count` badge on Filters.
5. **Clock.** The global shell clock sits on the header row, left of the rail divider. It is shown on TV and desktop and hidden at ≤1100px with a header, and at ≤760px. Pages never render or position it. `PageHeader` treats it as an obstacle when wrapping the detail text.
6. **Body.** Exactly one `ScrollArea` per scrollable region. It is a real native scroll container with the edge fades built in. Variants:
   - `panel` (default): the rail panel, `.tv-rail-panel.tv-library-grid-panel` and `--library-rail-*`.
   - `bleed`: hero, detail, Home, Calendar and Folders (Q5).
7. **States** render inside the body, never instead of the page: `LoadingState`, `EmptyState` and `ErrorState`.
8. **Safe areas:**
   - The body never draws under the profile chip (`--page-safe-bottom`) or the nav rail (`--page-start`).
   - Phone bodies respect system insets through `PageLayout` only.

### 2.1 The reference action pill (web, commit `54224f36`)

These are the 30 September `.tv-filter-launcher` rules, quoted from `global.css` at that commit. `ActionPill` reproduces this **look** under its own class (`action-pill`). The `tv-filter-launcher` class itself stays banned: its look is the reference, and so is its position: the shell action column (rule 2.3, Q1b).

```css
/* box */
width: var(--directory-controls-width);          /* clamp(48px, 3.6vw, 62px) */
min-height: clamp(52px, 5.2vw, 72px);
display: flex; flex-direction: column; align-items: center; justify-content: center;
gap: 0.35rem; padding: 0.45rem 0.25rem;
border: 1px solid color-mix(in srgb, var(--line) 68%, transparent);
border-radius: 14px;
background: color-mix(in srgb, var(--surface-strong) 78%, transparent);
color: var(--ink-muted);
box-shadow: 0 14px 36px rgba(56, 38, 33, 0.08);
backdrop-filter: blur(22px) saturate(120%);
transition: background 180ms ease, color 180ms ease, transform 180ms ease;
/* icon */  width/height: clamp(18px, 1.4vw, 24px); fill: var(--surface-strong); stroke: currentColor;
            stroke-width: 1.5; stroke-linecap/linejoin: round;  (same sliders path as today)
/* label */ font-size: clamp(0.38rem, 0.43vw, 0.52rem); font-weight: 700; letter-spacing: 0.02em;
/* mobile (≤760px) */ width: 44px; min-height: 44px; padding: 0; border-radius: 14px; label hidden;
/* open (is-active) */ background: var(--ink); color: var(--bg);
```

Deliberate departures from the 30 September rules, all owner decisions:
- **Focus (Q2).** The reference filled with `--ink` and scaled 1.06 on `:focus-visible` and hover. Focus is now the theme focus ring (white in dark, ink in light; section 5, Q11) with **no fill**. The 1.06 scale is kept, drawn as a transform. Hover on pointer devices follows focus.
- **Open state.** The ink fill for `is-active` (drawer open) is kept. It is not a focus state. Owner decision Q12 (8 October): the drawer-open state keeps its ink fill, and the focus ring draws on top when focused.
- **Position (Q1b, 8 October).** Position is part of Q1. Every pill sits in the shell action column at the 30 September launcher position (right edge, below the header row), stacked vertically. Not in the header row, and not positioned per page.

The reference capture is produced in W1 from a build of `54224f36`. It is the TV Movies page, cropped to the launcher, in light and dark, and the mobile layout as well. It is committed as `docs/parity/web/layout/reference/{tv,mobile}/{light,dark}/filters-0930.png` and is the pin for section 7.3.
## 3. Tokens

Web tokens are defined once, in `clients/tv-web/web/src/styles/page-layout.css` on `.app-shell`, with mobile overrides under `@media (max-width: 760px)`.
- They replace the literals listed in section 1.
- They take their values from today's majority CSS, so adopting them changes no pixels on majority pages. The exceptions are the action-pill tokens (the 30 September reference) and the focus ring (Q2).

Android tokens are `object PlayarrPageTokens` in `core-designsystem/.../designsystem/page/PageTokens.kt`. They are selected by `LocalPlayarrFormFactor` (TV or Phone). The values below are what the scaffold uses today; 1 CSS px is 1 dp on the TV reference.

| Token (web) | Web value (TV/desktop) | Web mobile (≤760px) | Android TV | Android phone |
|---|---|---|---|---|
| `--page-header-top` | `clamp(34px, calc(5.2 * var(--viewport-unit)), 66px)` | `calc(var(--mobile-top-inset) + 2px)` | `headerTop` 56 dp | 2 dp + insets |
| `--page-start` | `max(clamp(102px, 8vw, 160px), var(--tv-nav-clearance))` | `var(--mobile-page-gutter)` (16px) | `start` 154 dp | 16 dp |
| `--page-end` | `clamp(24px, 4vw, 96px)` | 72px (clear of the avatar) | `end` 72 dp | 72 dp header / 16 dp body |
| `--page-control-height` (Back, icon buttons, clock; centred on the pill tile, Q9) | `clamp(38px, 2.8vw, 50px)` | 38px | `control` 50 dp | 38 dp |
| `--action-pill-width` | `clamp(48px, 3.6vw, 62px)` | 44px | 62 dp | 44 dp |
| `--action-pill-height` | `clamp(52px, 5.2vw, 72px)` | 44px | 72 dp | 44 dp |
| `--action-pill-radius` | 14px | 14px | 14 dp | 14 dp |
| `--page-header-gap` | `clamp(14px, 1.2vw, 24px)` | 10px | 23 dp (web at 1920) | 10 dp |
| `--page-actions-gap` | `clamp(8px, .8vw, 16px)` | 8px | as web at 1920 (16 dp), pending the restore PR | 8 dp |
| `--page-header-divider-pad` | 20px | 20px | 20 dp | 20 dp |
| `--page-body-top` (bleed body; the panel body uses `--library-rail-top`) | `clamp(104px, 15vh, 168px)` | `calc(var(--mobile-top-inset) + 72px)` | today 122 dp; A0 re-measures from the web dom dump | 72 dp |
| `--page-safe-bottom` | `clamp(92px, 11vh, 124px)` | `var(--mobile-nav-height)` | `safeBottom` 96 dp | 72 dp |
| `--page-icon-radius` (Back, arrows) | 50% | 50% | `CircleShape` | `CircleShape` |
| `--page-focus-ring` | `3px solid var(--focus-ring-color)`, offset 2px | 2px, offset 3px | 3 dp, outset 2 dp | 2 dp, outset 3 dp |
| `--focus-ring-color` | dark: `#ffffff`; light: the theme `--ink` token, a near-black ink (Q11) | same | dark `Color.White`; light the theme ink colour | same |
| `--page-header-height` | `max(var(--action-pill-height), var(--page-control-height))`: the row grows to fit the tile (Q9) | same | tile height, 72 dp | 44 dp |
| `--page-edge-fade` | the rail-panel glow (current `.tv-library-grid-panel::before/::after`), the single fade (Q6) | same | `edgeFade` from the web dom dump | same |

**Colours.** Colours come only from the theme tokens: `--ink`, `--ink-soft`, `--surface-strong`, `--line-strong` and `--danger` on web, and their Android equivalents. They are never hard-coded. The Android palette moves into `core-designsystem/theme/PlayarrWebPalette.kt`:
- It is backed by an `@Immutable` data class provided through `LocalPlayarrWebPalette`, so that a theme change recomposes.
- `WebPink` is renamed `WebAccent`. It is not pink: it is `#DFDCDD` in dark and `#675961` in light.
- Both themes are first-class. No token may be defined for one theme only.

## 4. Component API

### 4.1 Web: `clients/tv-web/web/src/components/shell/`

The components stay in the web app rather than in `packages/`, because `apps/tv-webos`, Tizen and the VIDAA fallback all import `web/src/main`. One copy therefore serves every web-stack client. Export everything from `components/shell/index.ts`.

```tsx
// PageLayout.tsx: replaces PageShell and TvStageShell for routed pages.
export interface PageLayoutProps {
  /** Stable id: registry key, `data-page-id`, scroll-restoration key prefix. */
  pageId: PageId;                       // union from lib/pageRegistry.ts
  header: PageHeaderProps | { kind: "none"; actions?: PageAction[] }; // "none": Home only (registry-checked)
  body?: "panel" | "bleed";             // default "panel"
  /** Background art (TvStageShell's key art / wash), unchanged visuals. */
  backdrop?: { art?: ReactNode; wash?: boolean };
  /** Exactly one of children or state. */
  state?: { kind: "loading" } | { kind: "empty"; props: EmptyStateProps } | { kind: "error"; props: ErrorStateProps };
  children?: ReactNode;
  ariaLabel?: string;
}

// PageHeader.tsx (existing, tightened): REMOVE className and detailClassName.
export interface PageHeaderProps {
  title: ReactNode;
  detail?: ReactNode;                   // text after the divider; wraps under the title when it collides
  back: { label: string } & ({ to: string } | { onBack: () => void }) | { kind: "none" };
  actions?: PageAction[];               // rendered by PageActions in the canonical order
  backRef?: Ref<HTMLElement>;
  backProps?: Record<`data-${string}`, string | boolean | undefined>;
  /** Detail-page variant (today's TvDetailHeading): detail is the item title, bold. */
  variant?: "page" | "detail";
}

// PageActions.tsx: the only thing that renders header controls.
export type PageAction =
  | { kind: "navigation"; id: string; items: NavigationItem[] }   // ‹ Today ›; icon/label ActionPills, grouped
  | { kind: "panel"; id: string; label: string; icon: ActionIcon; open: boolean; onToggle(): void; controls: string }
  | { kind: "link"; id: string; label: string; icon: ActionIcon; to: string }          // Customise Home
  | { kind: "filters"; label: string; open: boolean; onToggle(): void; controls: string; activeCount?: number }
  | { kind: "status"; id: string; label: string };                // non-interactive badge (Downloads offline)
// Order is enforced: navigation, then panel/link/status in array order, then filters.
// At most one filters. PageActions sorts; it does not trust the caller.
export function PageActions(props: { actions: PageAction[] }): JSX.Element;

// ActionPill.tsx: replaces FiltersButton and PanelButton (kept as deprecated aliases for one PR).
export type ActionIcon = "filters" | "bell" | "add" | "customise" | "prev" | "next" | "back";
export interface ActionPillProps {
  shape?: "tile" | "icon";              // tile = the reference, icon over label (icon-only ≤760px); icon = round
  icon: ActionIcon;                     // from one icon map, no inline SVG in pages
  label: string;                        // always the accessible name, visible on pill shape
  active?: boolean;                     // open/pressed
  count?: number;                       // Filters badge only
  // as button: onClick + aria-expanded/aria-controls; as link: to
}
// Renders <Button variant="secondary" className="action-pill …"> or <ButtonLink>; the CSS is the
// 30 September .tv-filter-launcher look (section 2.1) with the Q2 focus ring, under the action-pill class.
// .page-filters-button is retired in W1 (every page changes look at once; see section 8).

// ScrollArea.tsx: one scroll container with built-in edge fades.
export function ScrollArea(props: {
  axis: "vertical" | "horizontal";
  scrollKey: string;                    // data-navigation-scroll-key
  className?: string;                   // layout only (grid template); guard forbids colour/fade rules on it
  children: ReactNode;
}): JSX.Element;
// Sets data-tv-scroll-container, data-tv-scroll-axis, overflow, and can-scroll-{start,end} from useScrollEdges.
// One fade on every axis (Q6): the rail-panel glow. The media-track mask and glow and .tv-scroll-edge-window are retired.

// States.tsx
export function LoadingState(props: { label: string; size?: "page" | "inline" }): JSX.Element; // role=status
export function EmptyState(props: EmptyStateProps): JSX.Element;   // TvEmptyState tone=empty
export function ErrorState(props: ErrorStateProps & { onRetry?: () => void }): JSX.Element; // TvEmptyState tone=error, role=alert, --danger
```

**Notes**
- `PageShell`, `TvStageShell`, `TvDetailHeading`, `FiltersButton`, `PanelButton`, `.tv-home-customise` and `.tv-scroll-edge-window` are removed once every page has migrated.
- `TvEmptyState` becomes the private implementation of `EmptyState` and `ErrorState`.
- `SkeletonBlock` stays as a content placeholder that a page may put inside its body (the Calendar grid). It is not a page state.

### 4.2 Android: `clients/android/core-designsystem/src/main/kotlin/io/playarr/shared/designsystem/page/`

```kotlin
enum class PlayarrFormFactor { Tv, Phone }
val LocalPlayarrFormFactor = staticCompositionLocalOf { PlayarrFormFactor.Phone } // provided once in MainActivity

@Composable fun PlayarrPageLayout(
    pageId: PlayarrPageId,                    // enum; registry key
    header: PlayarrPageHeaderSpec?,           // null only for registry-exempt pages
    body: PlayarrPageBody = PlayarrPageBody.Panel,   // Panel | Bleed
    state: PlayarrPageState? = null,          // Loading | Empty(spec) | Error(spec, onRetry)
    backdrop: (@Composable BoxScope.() -> Unit)? = null,
    content: @Composable PlayarrPageBodyScope.() -> Unit,
)

@Immutable data class PlayarrPageHeaderSpec(
    val title: String,
    val detail: String? = null,
    val back: PlayarrBack?,                   // PlayarrBack(label, onBack) ; null only on Home
    val actions: List<PlayarrPageAction> = emptyList(),
    val variant: PlayarrHeaderVariant = PlayarrHeaderVariant.Page,  // Page | Detail
)

sealed interface PlayarrPageAction {
    data class Navigation(val id: String, val items: List<PlayarrNavItem>) : PlayarrPageAction
    data class Panel(val id: String, val label: String, val icon: PlayarrActionIcon, val open: Boolean, val onToggle: () -> Unit) : PlayarrPageAction
    data class Link(val id: String, val label: String, val icon: PlayarrActionIcon, val onClick: () -> Unit) : PlayarrPageAction
    data class Filters(val label: String, val open: Boolean, val activeCount: Int, val onToggle: () -> Unit) : PlayarrPageAction
    data class Status(val id: String, val label: String) : PlayarrPageAction
}

@Composable fun PlayarrActionPill(        // internal to the page package; screens never call it
    icon: PlayarrActionIcon, label: String, onClick: () -> Unit,
    shape: PlayarrPillShape = PlayarrPillShape.Tile, active: Boolean = false, count: Int = 0,
    focusRequester: FocusRequester? = null,
)

/** Scroll containers with built-in edge fades (drawWithContent gradient from PlayarrPageTokens.edgeFade). */
@Composable fun PlayarrScrollColumn(state: LazyListState, scrollKey: String, content: LazyListScope.() -> Unit)
@Composable fun PlayarrScrollGrid(state: LazyGridState, columns: GridCells, scrollKey: String, content: LazyGridScope.() -> Unit)
@Composable fun PlayarrScrollRow(state: LazyListState, scrollKey: String, content: LazyListScope.() -> Unit)
fun Modifier.playarrEdgeFades(canScrollBackward: Boolean, canScrollForward: Boolean, axis: Orientation): Modifier

@Composable fun PlayarrLoadingState(label: String)
@Composable fun PlayarrEmptyState(spec: PlayarrEmptySpec)
@Composable fun PlayarrErrorState(spec: PlayarrErrorSpec, onRetry: (() -> Unit)?)
```

**Notes**
- None of these takes a `Modifier`, a colour, a size or a `TextStyle`. That is deliberate.
- `PlayarrPageScaffold`, `PlayarrHeaderActions`, `PlayarrHeaderButton`, `PlayarrPhoneHeaderPill` (header use), `PlayarrPageHeaderRow`, the dead `PlayarrPageHeader`, and the `Experience*`/`Parity*`/`Folders*` state composables are removed once every page has migrated.
- The breadcrumb wrapping logic (`decideSubtitlePlacement`) moves into the page package, with its existing test.

## 5. Focus (TV, every client)

1. **The focus indicator is a ring, never a fill** (owner decisions Q2, Q11). It is `--page-focus-ring`:
   - 3px of `--focus-ring-color`, offset 2px. The colour is white (`#ffffff`) in dark theme and the theme's `--ink` token (near-black) in light theme.
   - Width, offset and the 1.06 scale are the same in both themes. There is no fill.
   - Phone, mobile and pointer use 2px with a 3px offset.
   - It is used everywhere: Back, action pills, the navigation group and content cards. **No ink fill on focus.** The fills web has today go, which affects Back, `.page-filters-button`, `.tv-page-back` and `.ui-btn` hover/focus.
   - Light theme: a white ring would vanish on `--bg` `#f5f3f2` and `--surface-strong` `#ffffff`, so light uses the ink ring (Q11). Every place that used a literal white ring reads `--focus-ring-color` instead.
2. **D-pad order:**
   - nav rail → Back → (Right) navigation items → secondary pills → Filters.
   - **Down** from any header control enters the content. It goes to the restored focus key if there is one, otherwise to the first item.
   - **Up** from the top row of the content returns to the header control nearest geometrically (web spatial nav). It never goes to the nav rail.
   - **Left** from Back goes to the nav rail.
   - **Right** from Filters does nothing.
   - The title, detail and clock are never focusable.
3. **Initial focus** on opening a page goes to content, never to the header. The exception is when the content is in a `LoadingState`, `EmptyState` or `ErrorState`: then it goes to the state's action (Retry) if there is one, otherwise to Back. The series page rule (next episode) is unchanged.
4. **Focus never moves the header.** Header controls do not scale in a way that shifts siblings. The focus scale (1.06 on the action pill, 1.1 on Back) is drawn with `transform`/`graphicsLayer` only.
5. **Back** (the remote key) closes an open drawer or panel first, then navigates. This is the existing rule.
6. **UP and DOWN between stacked horizontal rails are geometric** (Home rails, detail-page tracks, any stack of rails; owner rule 8 Oct). Native clients copy this exactly:
   - Take the on-screen horizontal centre `x` of the focused card, as drawn right now (after the rail's own scroll).
   - In the adjacent rail (next one down, or previous one up; empty rails are skipped), choose the card whose on-screen centre is closest to `x`. Only cards that intersect the rail's visible span are candidates; if none does, all cards are. A shorter rail with nothing at `x` therefore yields its nearest visible card. Ties go to the earlier card.
   - Never use the focused card's index, a remembered index per rail, or the previous rail's scroll offset. Moving back up or down repeats the same rule from wherever focus now is, so there is no index memory.
   - The target rail is not scrolled to match anything. It scrolls only by the minimum needed to unclip the chosen card (respecting the rail's scroll padding), and not at all when the card is already fully visible. The vertical page scroll then reveals the rail as usual.
   - LEFT and RIGHT inside a rail, and the nav rail rules, are unchanged. At the first or last rail UP and DOWN fall through to the normal edge rules.
   - Web reference: `pickNearestCardByCentre` in `clients/tv-web/web/src/lib/trackNavigation.ts`, checked by `scripts/rail-geometry-e2e.mjs` (both themes, 1920x1080).

## 6. Both themes

- Every component reads its colours from theme tokens. Light and dark references both exist at `docs/parity/web/{tv,mobile}/{light,dark}`.
- The header checks (7.3) run in both themes.
- Android goldens are recorded for TV and phone × light and dark.

## 7. Enforcement

### 7.1 Web guards (vitest, in `clients/tv-web/web/src/lib/`)

1. **Make the guards block PRs (first PR).**
   - Add a `Test (vitest)` step to `tv-web-check` in `.github/workflows/ci.yml`: `pnpm --filter @playarr-tv/web run test`.
   - Add `lint` to `web/package.json` as `vitest run src/lib/*Audit.test.ts src/lib/*Registry.test.ts`, so the existing `pnpm run lint` step runs the guards even on affected-only runs.
2. **`pageRegistry.ts`**, renamed from `pageHeaderRegistry.ts`. Every page file is listed:
   - as `layout`, meaning it renders `<PageLayout>`; or
   - as `exempt`, with a reason that the test checks against the source (for example, an exempt "TvStageChrome" reason must actually render it).

   Ratchet during migration: an `unmigrated` list may only shrink, and the test fails if a listed file already uses `PageLayout`.
3. **`pageLayoutAudit.test.ts` (new)** scans `src/pages/**` and `src/components/**`, excluding `components/shell/**`. It fails on:
   - `<PageShell`, `<TvStageShell`, `<TvDetailHeading` or `<PageHeader` used directly. Pages pass `header` to `PageLayout`.
   - `<FiltersButton`, `<PanelButton` or `<ActionPill`. Only `PageActions` renders pills.
   - The class names `page-filters-button`, `action-pill`, `tv-page-back`, `tv-library-heading`, `page-header` or `tv-home-customise` in TSX.
   - `data-tv-scroll-container` written by hand. Use `ScrollArea`.
   - Any `role="status"`/`role="alert"` element whose class matches `loading|loader|error|empty`. Use the state components.
4. **`pageLayoutCss.test.ts` (new)** parses `styles/*.css` and `pages/*.css` with a simple rule split, as `tooling/*.test.mjs` already does. It fails when a selector containing `.page-header`, `.tv-library-heading`, `.action-pill`, `.page-filters-button`, `.tv-page-back`, `.app-clock`, `.scroll-area` or `.page-layout` appears outside `styles/page-layout.css`.
   - Exception: platform blocks such as `html[data-platform=…]` inside `page-layout.css` itself.
   - This rule is what makes "restyle Filters on one page" impossible.
5. Keep `buttonAudit` and `drawerAudit`.

### 7.2 Android guards (JUnit source scans in `app/src/test/kotlin/io/playarr/mobile/ui/`)

These run in CI through `:app:testSideloadDebugUnitTest`.
1. **`PlayarrPageLayoutGuardTest`** replaces `PlayarrPageScaffoldRegistryTest`. It uses the same registry and exemption model, now keyed by `PlayarrPageId`, with a shrinking `unmigrated` ratchet set.
   - It extends the screen regex to cover `HouseholdBlockedScreen`, `PhoneSettingsIndex` and any `@Composable` that is passed to a `composable(` route.
2. **`PlayarrPageChromeGuardTest`** scans `app/src/main` and fails on:
   - `PlayarrPageScaffold(`, `PlayarrHeaderButton(`, `PlayarrPhoneHeaderPill(` or `PlayarrPageHeaderRow(` outside `core-designsystem/.../page/`.
   - `Surface(` with `onClick` in a file under `ui/` whose body contains `CircleShape` and a `height(` of 38, 42, 44, 50 or 56 dp. This catches hand-rolled pills.
   - The literals `154.dp`, `72.dp` (as padding) and `96.dp`/`104.dp`/`108.dp`/`110.dp`/`118.dp`/`120.dp` (as bottom padding) in `ui/`. Use `PlayarrPageTokens`.
   - Any `fun \w*(Loading|Failure|Failed|Empty)\w*\(` composable outside the page package.
   - `LazyColumn(`/`LazyVerticalGrid(`/`LazyRow(`/`verticalScroll(` in a registered screen body, unless it is wrapped by a `PlayarrScroll*` or carries `playarrEdgeFades`.
3. **`core-designsystem` unit tests (new source set):**
   - `PlayarrPageActionsOrderTest`: Filters is last, there is at most one Filters, and navigation comes first.
   - `PlayarrActionPillIconTest`: on phone the icon parameter is honoured, which pins the "Create shows the Filters glyph" bug.

### 7.3 Header parity: drift fails CI

**Web, CI.** Add a new job `web-layout-parity` in `ci.yml`. It is added to `ci-required` `needs`, runs when `tv-web` changed, uses `ubuntu-latest`, and needs no fixture server or Rust build.
- Script: `clients/tv-web/web/scripts/layout-parity.mjs`. It extends the existing `header-parity.mjs`/`smoke:header`, reusing the `nav-perf/server.mjs` mock API, the frozen clock and reduced motion.
- **Canonical capture.** A dev-only route `/__layout/header`, registered like `NavPerfHarness` and stripped from production builds, renders `PageLayout` with a header built from query parameters (`title`, `detail`, `back`, `actions=navigation,panel:bell:Label,link:customise:Label,filters:Label:count`).
- **Per page.** For every registered `layout` page, the script:
  1. Opens the page.
  2. Reads its title, detail and action list from the DOM (`data-action-kind`, `data-action-icon`, label).
  3. Opens the harness with exactly those values.
  4. Captures the **header band** on both: full width, y from 0 to `header.bottom + 8px`. On the TV layout the nav rail (x < `--page-start` − 8px) is masked, because its active item legitimately differs.
  5. Masks the title and detail text boxes.
  6. Diffs with `scripts/parity/diff.mjs` semantics (pixelmatch threshold 0.1).

  Acceptance is **0 mismatched pixels**. Layouts are TV 1920x1080, desktop 1280x720 and mobile 390x844 at DPR 3, in light and dark.
- **Pill identity.** For every `ActionPill` on every page, crop the pill and diff it against the harness pill with the same icon, label, state and count, at 0 pixels. This catches a restyle even if the page's header band moved as a whole.
- **Reference pin.** `docs/parity/web/layout/reference/{tv,mobile}/{light,dark}/filters-0930.png` holds the unfocused, closed 30 September launcher (section 2.1). The harness Filters pill in the same state must match it at 0 pixels.
  - Focus and open states are pinned by `docs/parity/web/layout/{tv,mobile}/{light,dark}/action-pill-{focus,open}.png`, captured from the harness once the Q2/Q11 ring is in.
  - `header-canonical.png` pins the header band.
  - The shared component therefore cannot change without updating a reference, which falls under 7.4.

**Android, CI.** Use Roborazzi (Robolectric screenshot tests; JVM-only, so it runs in the existing unit-test task). This is coordinator default Q7.
- Goldens are recorded for `PlayarrPageHeader` and `PlayarrActionPill` in every variant, in TV and phone, light and dark.
- Golden directory: `clients/android/core-designsystem/src/test/snapshots/`.
- `verifyRoborazziDebug` is added to the affected-module tasks in `scripts/ci/android-scope.sh`.

**Android, per screen** (evidence on each migration PR, not CI). `scripts/parity/android-{tv,mobile}/capture.sh` gains `--header-band`.
- It crops each screen's header band and diffs it against the client's canonical header rendered by a debug-only `HeaderHarnessActivity`, with the same masking, at 0 pixels.
- Native against web stays at the campaign's ≤1% (rasteriser differences).

### 7.4 Owner-request gate

Add `scripts/ci/check-layout-owner-request.sh` to `ci-required`. It runs `git diff --name-only origin/main...HEAD`. If the PR changes any **look file**, the PR body must contain `Layout-Change: owner request <YYYY-MM-DD>, reference <id>`. Look files are:
- `clients/tv-web/web/src/styles/page-layout.css`
- `clients/tv-web/web/src/components/shell/{ActionPill,PageActions,PageHeader,PageLayout,ScrollArea,States}.tsx`
- `docs/parity/web/layout/**`
- `clients/android/core-designsystem/.../page/**` (excluding pure-logic files listed in the script)
- `clients/android/core-designsystem/src/test/snapshots/**`

The check reads the PR body from `GITHUB_EVENT_PATH`. On train-started `workflow_dispatch` runs it reads it with `gh pr view --json body`. The trailer is the audit trail: agents must not add it without a quoted owner request.

## 8. Migration plan (small train PRs)

Each PR includes:
- Its rows (`tasks.d`).
- Before and after parity numbers: `capture-web.mjs` then `diff.mjs --theme both`, against the committed references.
- A list of every intentional visual change.

A PR with an unlisted pixel change fails review. Expected intentional changes are marked ⚑.

### Web (`clients/tv-web/web`)

| # | PR | Scope | Visual change |
|---|---|---|---|
| W0 | ci: run web vitest guards on PRs | ci.yml step, `lint` script, Household registry reason fixed | none |
| W1 | Shared primitives and the reference pill | `page-layout.css` (tokens; moves the header, clock and panel rules out of `global.css` unchanged); `PageLayout`, `PageActions`, `ActionPill` (section 2.1 look), `ScrollArea`, the states and the icon map; `FiltersButton`/`PanelButton` become aliases of `ActionPill`; the theme focus ring (Q2, Q11) on Back, pills and `.ui-btn`; `/__layout/header` harness; reference capture from `54224f36`; `layout-parity.mjs` and the CI job (pill pins); ratchet guards with every page `unmigrated`; web parity references re-captured | ⚑ every Filters, Calendar link and Create pill becomes the 30 September tile (Q1); ⚑ focus is a ring (white in dark, ink in light) with no fill (Q2, Q11); ⚑ the header row grows to the tile height and its items centre on it (Q9). Commit trailer: `Layout-Change: owner request 2026-10-07, reference filters-0930`. |
| W2 | Library, Playlists, Search | `PageLayout` (panel); Search results onto `ScrollArea`; drop `tv-playlists-heading`/`tv-search-heading` overrides; Library drawer onto `FilterSection` | ⚑ mobile Playlists actions right edge 176px → 72px; ⚑ Search results fade switches to the rail-panel fade (Q6) |
| W3 | Downloads, Watchlist, Requests, Customise Home page | `PageLayout` (panel); `ScrollArea` fixes the missing overflow; `LoadingState`/`ErrorState`; Downloads offline badge becomes `status` action | ⚑ fades appear; ⚑ loading text becomes `LoadingState` |
| W4 | Calendar, Folders | `PageShell` → `PageLayout(body="bleed")` (Q5); navigation rendered once (layout decides header or phone sub-row); Calendar.css focus override removed; `ScrollArea` with `data-tv-scroll-container` | ⚑ fades |
| W5 | Settings | `PageLayout`; panel fades wired; `SettingsSectionLayout` props removed or used; section states | ⚑ fades |
| W6 | Work detail, music detail; Library loading | `variant: "detail"`; single `<h1>` (body title becomes `h2`, same style); `LoadingState`/`ErrorState` inside the frame, here and on Library | ⚑ header and Back visible while loading and on error (Q4); ⚑ media-track fades become the rail-panel fade (Q6) |
| W7 | Home; Household | Home `header: { kind: "none" }` (no Customise Home action: it lives in Settings, Q3 override); Household gets the standard Back (Q8), still registry-exempt for the rest | ⚑ Customise Home leaves Home for Settings (Q3, override of 8 October); ⚑ Household Back |
| W8 | Guards final | Remove aliases, `PageShell`, `TvStageShell`, `TvDetailHeading` and dead CSS (`.tv-home-rail-window`, `.page-header-actions.is-stacked`, `--page-safe-left`, duplicate `--library-rail-*`); ratchet list empty; header-band CI over all pages; owner-request gate | none |

### Android (`clients/android`)

Coordinate with the D-pad/focus, calendar, parity-residue and player workers. Keep each PR to page chrome, and rebase onto `origin/main` before every push.

| # | PR | Scope | Visual change |
|---|---|---|---|
| A0 | Palette and tokens into core-designsystem | `PlayarrWebPalette` (CompositionLocal, `WebAccent` rename), `PlayarrPageTokens`, `LocalPlayarrFormFactor` provided in `MainActivity` | none |
| A1 | Page components | `page/` package (section 4.2); `PlayarrPageScaffold` reimplemented on top (same signature) so no screen changes; Roborazzi goldens; order and icon tests | none, except ⚑ phone Create pill shows the add glyph (bug) |
| A2 | Pills | Library, Playlists and Folders Filters, Calendar Bell, Search TV and phone pills onto `PlayarrPageAction`; Search's absolute-offset pill into the header slot (keep `PlayarrSearchFocusOrderTest` contract); theme focus ring (white dark, ink light) on Back and every pill, no focus fill | ⚑ every header pill becomes the 30 September tile (Q1); ⚑ theme focus ring (Q2, Q11); ⚑ header row grows to the tile height (Q9) |
| A3 | States | `Experience*`/`Parity*`/`Folders*`/Calendar inline → `PlayarrLoadingState`/`EmptyState`/`ErrorState` inside the frame | ⚑ header and Back visible while loading and on error (Q4) |
| A4 | Hero pages | Library, Search, Detail, Music detail onto `PlayarrPageLayout(body = Bleed)`; all `154.dp` and bottom-padding literals → tokens | ⚑ music detail TV inset 118 → 154 dp |
| A5 | List pages | Watchlist, Requests, Guardian approvals, Downloads, Playlists (+ detail), Folders, Settings onto `PlayarrPageLayout` and `PlayarrScroll*` | ⚑ fades |
| A6 | Calendar | Header actions and `trailingNav` → `Navigation` action; scroll areas (with the calendar worker) | ⚑ fades |
| A7 | Home and cleanup | Customise Home as `Link` action (one implementation, Q3); Household standard Back (Q8); delete `PlayarrPageScaffold`, `PlayarrPageHeader` (dead), header pill code; ratchet empty; owner-request gate covers `page/` | ⚑ Customise Home position and look; ⚑ Household Back |

### Other clients

Each gets a follow-up row to adopt the same anatomy, tokens and focus rules (rows 804–811):
- iOS
- tvOS
- Roku
- Fire TV
- Xbox
- Harmony
- VIDAA
- webOS

VIDAA and webOS run the web bundle, so their rows verify the web PRs on the platform, and that no `html[data-platform]` rule outside `page-layout.css` touches header classes.

Native clients implement one `PageLayout`/`PageHeader`/`ActionPill`/`ScrollArea`/states set in their design-system layer, plus a source-scan guard and a header-band diff, by analogy with sections 4.2 and 7.2.

## 9. Sequencing

1. **The filter-fix PR lands first.** It is another worker's: it restores the library Filters style and makes the Calendar's Filters and Calendar-link buttons match it. Its target must be the Q1 reference (section 2.1), not today's `.page-filters-button` pill or Android's pre-#154 button. If it restores anything else, W1 and A2 restyle it again. W1 and A1 start from main after it lands.
2. W0 landed in #196.
3. Web PRs go before the matching Android PRs. Android diffs against the web references, which must not move underneath it.
4. Each migration PR rebases often. The page files are shared with the parity, calendar and focus workers, and the merge train only merges `main` in when the PR's files are touched.

## 10. Owner decisions

Answered on 7 October 2026 (Q1 to Q8). **Owner** rows are owner decisions. **Default** rows are coordinator defaults, which the owner may override; an override is an owner request under 7.4.

| # | Question | Decision | Effect on this spec |
|---|---|---|---|
| Q1 | Which Filters look is the reference? | **Owner:** "whatever was on Web a week ago": web's library Filters button as of about 30 September 2026, from git history, used on every client. | Section 2.1: the `.tv-filter-launcher` tile at `54224f36`. It is neither today's `.page-filters-button` nor Android's pre-#154 button. W1 and A2 change every header pill to it. |
| Q2 | Focus: ring or fill? | **Owner:** the ring everywhere, including pills and Back. No ink fill on focus. | Section 5.1 and tokens (`--focus-ring-color`: white in dark, `--ink` in light, per Q11). The fills on Back, pills and `.ui-btn` go in W1. |
| Q3 | Customise Home in the header row? | **Owner (7 October):** yes, as a standard pill. **Overridden by the owner on 8 October (Q3b):** Customise Home is removed from Home entirely. Home customisation is a Settings section, `/settings/home` (same controls and behaviour; the old `/customise-home` link redirects there). Home has no action button and nothing in the shell action column. | W7 becomes: Home has `header: { kind: "none" }` and no actions. The web change ships as its own PR; native clients follow (A7). |
| Q4 | Header while loading or failed? | **Owner:** the header and Back always show. | Rule 2.7; W6 and A3. |
| Q5 | Calendar and Folders body? | **Default:** keep the full-bleed body. | W4 uses `body="bleed"`; edge fades still apply. |
| Q6 | One edge fade? | **Default:** the web rail fade becomes the single shared edge fade. | Read as the rail-panel glow (`.tv-rail-panel.tv-library-grid-panel::before/::after`) on every axis. `ScrollArea` loses its `track` variant, and the media-track mask and glow and `.tv-scroll-edge-window` are retired (W2, W6). If "rail fade" meant the Home rails' media-track fade, only the fade CSS in W1 changes. |
| Q7 | Android CI screenshots? | **Default:** Roborazzi. | Section 7.3. |
| Q8 | Exemptions? | **Default:** keep them; Household gets a standard Back. | W7 and A7. |

Answered on 8 October 2026 (owner rulings on Q1 and Q9 to Q12):

| # | Question | Decision | Effect on this spec |
|---|---|---|---|
| Q1 | Reference look (confirmed) | **Owner, confirmed:** the 30 September `.tv-filter-launcher` tile (commit `54224f36`) is the reference look for every header action pill on every client. | Section 2.1 stands. |
| Q1b | Position of the side-panel buttons | **Owner (8 October):** position is part of Q1 ("whatever was on web a week ago"). The app shell owns one fixed right-hand column where the 30 September launcher sat, and every page's side-panel and action buttons stack vertically in it. This overrides the coordinator default that put the pills in the header row. | Rule 2.3, section 2.1 and the `ShellActionColumn` component. Header row = Back, title, detail, clock, navigation. 30 September history: only Library (Filters) and Playlists (Create above Filters) had such buttons; the phone layout was a row left of the avatar. |
| Q3b | Customise Home | **Owner (8 October), overrides Q3:** Customise Home is not a pill in the header or the column. It is removed from Home and moves into Settings. | Recorded here; delivered in its own PR. |
| Q9 | Header row height | **Owner:** the header row grows to fit the tile, and all items centre vertically on the tile. | Rule 2.2 and the `--page-header-height` token. Back, title, clock and actions centre on the tile height. Each page's ⚑ list states the shift. |
| Q10 | Back and period arrows | **Owner:** they stay round. Only the focus ring is added. | Rule 2.4 `icon` variant. They do not take the tile look. |
| Q11 | Focus ring in the light theme | **Owner:** the ring is white (`#ffffff`) in dark theme and a near-black ink ring in light theme (the theme's ink token). Width, offset and the 1.06 scale are unchanged, with no fill. | Section 5.1 and the `--focus-ring-color` token. Wherever the spec said "literal white" or "white everywhere", it now reads as this theme-aware ring. |
| Q12 | Drawer-open state | **Owner:** the drawer-open state keeps its ink fill. | Section 2.1. The ring draws on top when focused. |

## Appendix A: audit inventory

### Web

Abbreviations:
- **TSS**: `TvStageShell`
- **PH**: `PageHeader`
- **LGP**: `.tv-rail-panel.tv-library-grid-panel`
- **TES**: `TvEmptyState`

| Page | Header | Actions | Body / scroll | Fades | Loading / empty / error |
|---|---|---|---|---|---|
| Home | none (exempt); hero `h2` | Customise Home `ButtonLink sm` `.tv-home-customise`, absolute, outside header | TSS; `TvRailSurface` vertical tracks | track mask and glow | orbit loader; TES page |
| Movies, Series, Music, Sites (Library) | PH, detail "N titles" | `filters` | TSS + LGP grid | panel glow | compact orbit loader (no header); TES page |
| Playlists | PH + `tv-playlists-heading` | `filters` + panel Create | TSS(`tv-home`) + LGP / tracks | panel glow / track | `tv-home` loader; TES |
| Search | PH + `tv-search-heading` | none (form in body) | TSS; `.tv-scroll-edge-window` | edge-window | mini loader; TES rail |
| Calendar | PageShell | navigation (‹ Today ›, duplicated inline on phone), panel Bell, `filters` | `.calendar-scroll` (no scroll attr) | none | skeleton; `.calendar-state` |
| Downloads | PH, detail storage | `actions` offline badge | TSS + LGP; `.tv-downloads-content` (no overflow) | none | compact loader; TES |
| Watchlist, Requests | PH | none | as Downloads | none | `p.tv-discovery-note`; TES; `.tv-watchlist-error` (#cf3157) |
| Customise Home | PH (borrowed back label) | none | as Downloads | none | discovery note; TES |
| Folders | PageShell, `onBack` up a level | `filters` when a root is open | `.folders-scroll` | none | discovery note; TES |
| Settings + sections | PH (index owns it) | none | TSS; two columns; LGP never gets `can-scroll-*` | none (inert) | mixed `p.muted`/`.error-text`/TES |
| Work detail | `TvDetailHeading`; second `h1` in body | none | TSS; tracks | track | detail loader (no header); TES |
| Music detail | `TvDetailHeading` + `tv-music-heading` | none | TSS; tracks + edge-window | track, edge-window | detail loader; TES |
| Profiles, Clients, Legal | `TvStageChrome` (own back) | ad hoc | own | Profiles row | own |
| Household | bare `h1`, text back link at the bottom | raw buttons | none | none | bare `p` |
| NotFound | exempt | none | app-main | none | n/a |

### Android

Phone and TV share one composable per screen and branch on `isTelevision`.

| Screen | Frame | Actions | Scroll | States |
|---|---|---|---|---|
| Home | own stage (exempt) | Customise Home: phone `Surface`, TV `PlayarrButton` (Material colours) | `LazyColumn` rails | `Experience*` outside the frame |
| Library (all kinds) | scaffold `padBody=false` | `filters` | Lazy column, grid or row | `Experience*` outside the frame |
| Search | scaffold `padBody=false` | own TV and phone Filters pills, absolute offsets | `LazyColumn` | spinner, `Experience*` |
| Calendar | scaffold | `filters`, Bell (TV through the scaffold, phone hand-rolled), TV `trailingNav` | `LazyColumn`, `verticalScroll` | `PlayarrSkeleton`, inline failure |
| Folders | scaffold | `filters` | Lazy column or grid | `Folders*` |
| Downloads, Watchlist, Requests, Guardian | scaffold `padBody=true` | none | `LazyColumn` | `Parity*`/`ExperienceEmpty` |
| Playlists (+ detail) | scaffold | `filters` + Create (wrong glyph on phone) | grid / `LazyColumn` | `Parity*`; detail outside the frame |
| Settings | scaffold, `backActive` | none | `LazyColumn` | spinner, `ParityFailure` |
| Detail, music detail | scaffold `padBody=false` | none | `LazyColumn`/`verticalScroll` | outside the frame; music TV inset 118 dp |
| Profiles, Household, Player, NotFound, Offline | exempt | own | own | own |
