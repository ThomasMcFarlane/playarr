# Streamarr / Playarr Design Reference

Status: living reference, first written 2026-07-16. Covers the design system (elevation, color,
components) and a page inventory for both client apps in this repo. Written to directly inform an
upcoming redesign of Streamarr Admin's Source Instances page, so it favors concrete hex values and
class names over general design principles.

Snapshot note: file lengths and statements labelled "current" describe the 2026-07-16 research
snapshot. Use the checked-in source and `CHANGELOG.md` for the repository's present implementation.

## 1. Source of truth

The elevation, typography, and per-app branding facts in this document come from a live, logged-in
browser scan of private Sonarr and Radarr instances — screenshots plus `getComputedStyle` reads
of CSS custom properties on
`:root`, not a reading of the *arr source code and not guesswork. Sonarr and Radarr were confirmed
to share byte-identical CSS architecture (the same theme engine Lidarr also uses), differing only
in one accent custom property per app. Only the pages the scan actually visited are described here
(see §5 for what wasn't visited); everywhere this document generalizes beyond an observed page, it
says so explicitly as an inference.

Streamarr's own side of the comparison — its current design tokens — was **read in full, not
assumed**, from both:

- `clients/tv-web/web/src/styles/global.css` (Playarr Web, the consumer streaming client) — 1056 lines
- `clients/tv-web/admin/src/styles/global.css` (Streamarr Admin, the operator control plane) — 998 lines

A full diff of the two files confirms the research notes' claim that Admin copied Web's stylesheet
verbatim, with two small, apparently-unintentional gaps where Admin hasn't caught up to a later Web
edit (worth fixing in the same PR that does the color work, since both apps are meant to stay
byte-identical on tokens the same way Sonarr/Radarr/Lidarr are):

1. Web's checkbox has an explicit checkmark glyph drawn on top of the checked state
   (`.checkbox-label input[type="checkbox"]:checked::after`); Admin's checkbox only changes fill
   color when checked, no glyph. Web's own code comment explains why this matters: a color-only
   change "reads ambiguously at a glance."
2. Web has a `.auth-page` / `.auth-card` / `.auth-header` / `.auth-label` block (a dedicated,
   centered, no-chrome login layout) that Admin's copy doesn't have — Admin's `Login.tsx` instead
   improvises its own layout inline with a `.page` wrapper and inline `style={{ maxWidth: 360,
   margin: "4rem auto" }}`, rather than using shared classes.

Every hex value quoted below for Streamarr/Playarr's *current* state is copied directly from these
two files as they exist today, not from the earlier research summary.

## 2. Elevation & layout

### 2.1 Three-tier dark background system

Confirmed identical on Sonarr and Radarr via `getComputedStyle`, and already matched almost
exactly in Streamarr's tokens:

| Tier | Real *arr value | Streamarr token | Streamarr value | Match |
|---|---|---|---|---|
| Base (page background) | `#202020` | `--color-bg-base` | `#202020` | exact |
| Chrome (sidebar / header / modals / popovers) | `#2a2a2a` | `--color-bg-chrome` | `#2a2a2a` | exact |
| Raised (cards, inputs) | real theme doesn't separately name this tier in the findings, but sidebar active-item bg is `#333333` | `--color-bg-raised` | `#333333` | consistent |
| Shadow | `#111` card shadow color | `--shadow-color` / `--card-shadow` | `#111111`, `0 0 10px 1px var(--shadow-color)` | exact |
| Text primary / help / disabled | `#ccc` / `#555` / `#999` | `--color-text-primary` / `--color-text-help` / `--color-text-disabled` | `#cccccc` / `#909293` / `#909293` | primary exact; help/disabled use one shared `#909293` token where the real theme uses two distinct grays (`#555` and `#999`) — see §5, not independently re-verified which real element maps to which |
| Border | `#858585` general / `#dde6e9` input-only | `--color-border` | `#858585` | exact (Streamarr doesn't yet have a distinct lighter input-border token) |
| Font | Roboto, "open sans", "Helvetica Neue", Helvetica, Arial, sans-serif @ 14px body | `--font-sans` / `--font-size-body` | identical stack, `14px` | exact |

No new work is needed here — this is already a faithful port. Flagged only because the color-system
work in §3 will sit on top of it.

### 2.2 Sidebar nav pattern

Observed on both Sonarr and Radarr: a persistent left rail, ~200px wide, icon+label rows stacked
vertically, with the active (and, per the CSS, hovered) item distinguished by **a colored left
border strip plus text recoloring to the app's accent** — not a filled background block. Streamarr
already implements this exactly:

- `.sidebar` is `--sidebar-width: 210px` (real *arr is "~200px" per the scan — close enough to be
  the same design decision, not independently re-measured to the pixel).
- `.sidebar-link` has `border-left: 3px solid transparent` at rest.
- `.sidebar-link.is-active` sets `border-left-color: var(--color-accent)` and `color:
  var(--color-accent)`, plus (a Streamarr-specific addition not called out in the *arr findings)
  a `background: var(--color-bg-raised)` fill on the active row — the real *arr pattern per the
  findings is left-border-strip-only, with no fill; Streamarr's raised-background fill is an
  enhancement beyond what was observed, not a contradiction of it, but should be understood as
  Streamarr's own choice rather than a directly-copied fact.
- `.sidebar-link:hover` also recolors to `--color-accent`, matching the observed hover behavior.

Both client apps (Playarr Web and Streamarr Admin) already use this shell (`App.tsx` in both).
Playarr Web additionally has an accordion-style nested nav group (`.sidebar-section`) for
settings-with-children; this wasn't something the Sonarr/Radarr scan specifically documented, so
treat it as a plausible *arr-family pattern (Sonarr/Radarr do have collapsible Settings sub-items
in their own real nav) rather than a directly-confirmed one — it isn't currently exercised by either
app's actual `NAV_LINKS` array today, both of which are flat lists.

### 2.3 Toolbar pattern

Confirmed on Radarr's Settings > Download Clients screen: a horizontal row of **icon-over-label**
buttons (icon stacked above its text label, not beside it), no visible border/background at rest,
positioned directly under the header bar with a thin bottom divider. Example buttons seen: "Show
Advanced", "No Changes" (a disabled save button when nothing's changed), "Test All Clients",
"Manage Clients". Radarr's Movies screen has the same toolbar composition plus a right-aligned
View/Sort/Filter icon-button cluster.

**This pattern does not exist in Streamarr yet.** Neither Playarr Web nor Streamarr Admin currently
renders a toolbar row under `.app-header` — `.app-header` is present as an empty `<header
className="app-header" />` in both apps' `App.tsx` today (a fixed-height chrome band with no content
in it). Page-level actions currently live inline in the page body instead (e.g. Source Instances'
"Add & test connection" button sits inside the add-form card, not in a toolbar).

**Inference, not an observed fact:** it's reasonable to generalize that every *arr settings-style
page uses this same toolbar composition, since it was observed consistently across two different
Radarr screens with two different button sets. Adopting it for Streamarr would mean building a
`.toolbar` / `.toolbar-btn` (icon-over-label, transparent at rest, bottom divider) class pair and
mounting instances of it inside `.app-header` per-page — this is a real gap worth a follow-up task,
but out of scope for the color-token change this document exists to drive.

## 3. Color system

### 3.1 The actual branding mechanism in the real apps

The critical finding from the research: Sonarr and Radarr's `--primaryColor` is **identical**
(`#5d9cec`, a Bootstrap-ish blue) — it is not the per-app brand color. The per-app identity color is
a *different* variable, `--menuItemHoverColor`:

| App | `--menuItemHoverColor` | Where it's visible |
|---|---|---|
| Sonarr | `#35c5f4` (cyan-blue) | Logo mark; active/hovered sidebar nav item's left border + text |
| Radarr | `#ffc230` (gold/amber) | "RADARR" logo text; active "Download Clients" nav item's left border + text (confirmed via screenshot) |

`--primaryColor` (`#5d9cec`) stays the shared blue for general buttons, links, focus rings, the
input-focus border variant (`#66afe9`), and info-colored text, in **both** apps. Semantic colors
(success/danger/warning/info) are also shared and app-agnostic: success `#00853d` label /
`~#27c24c` button, danger `#f05050`, warning `#ffa500`, info `#5d9cec`.

So each *arr app has exactly **one** identity color, and it is used narrowly (nav + logo) while a
shared blue does all the actual UI-primary work. Streamarr's current tokens copy this structure
faithfully: `--color-brand: #5d9cec` (explicitly commented "NOT Streamarr's own color") does the
general-purpose work, and `--color-accent: #e5484d` (explicitly commented "Streamarr's own red
identity") is scoped only to `.sidebar-link:hover`, `.sidebar-link.is-active`, `.app-logo-accent`,
and `.sidebar-section-toggle:hover` — i.e. nav-hover/active plus the logo, nothing else. That is a
correct, literal translation of the observed Sonarr/Radarr pattern.

### 3.2 The color decision this task asks for

The task is explicitly to widen Streamarr's red beyond that narrow nav-only role: make
`--color-accent` (the `#e5484d` family) the **primary brand/action color** — buttons, active states,
focus rings — the same way Sonarr's cyan and Radarr's gold are, in principle, each app's *one*
consistent identity color. This is a deliberate **departure** from what was literally observed
(where the identity color stays nav-only and a shared blue does the primary-action work), made
because Streamarr/Playarr are not third-party skins of someone else's shared *arr theme — they're
products in their own right, and the user has directed that their own red carry the brand
everywhere, not just in the sidebar. Flagging this explicitly: §3.1's observed pattern is being used
as *precedent for having one consistent identity color*, not as license to claim "the real apps also
use their accent for primary actions" — they don't, per the findings.

### 3.3 The `--color-danger` naming collision

Streamarr today has two reds sitting close to each other:

- `--color-accent: #e5484d` (currently nav-only; proposed to become primary brand)
- `--color-danger: #f05050` (destructive actions: `.btn-danger`, `.error-text`, `.badge-danger`,
  `.icon-btn-danger`, `.corner-ribbon`, focus-glow-error)

Converting `--color-accent` into the *general* primary/CTA color while leaving `--color-danger` as
a nearby, distinguishable-but-close red creates a real risk: once red is the dominant color of the
whole UI (primary buttons, active nav, focus rings), a *second*, subtly different red used
specifically for "delete this" / "this failed" loses its warning power — the eye has been trained
all page long that "red = this app's normal color", not "red = stop."

**Recommendation: keep the two reds, but push them further apart and give danger a different hue
lean, not just a different lightness.** Concretely:

- Keep `--color-accent` at `#e5484d` (Streamarr's brand red — already well-established across both
  apps' logos in the codebase, no reason to reprint it everywhere as a different value).
- **Change `--color-danger` from `#f05050` to `#dc2626`** — a cooler, more saturated, noticeably
  darker red (closer to a fire-engine/Tailwind `red-600` than the current fairly pastel `#f05050`).
  Rationale: `#e5484d` and `#f05050` are only ~7% apart in perceived lightness and near-identical in
  hue — fine when accent was confined to a 3px nav border, not fine once accent is everywhere.
  `#dc2626` is darker and pulls very slightly toward orange-red rather than pink-red, so the two
  reds read as "brand" vs. "alarm" even at a glance, at small sizes, and for red/green colorblind
  users who rely on lightness/saturation cues rather than hue alone. This also happens to be closer
  to the real *arr theme's own semantic-danger intent (`#f05050` was already the *arr-standard
  danger red pre-Streamarr; `#dc2626` keeps the same role, same family, just pushed to stay legible
  against a now-red-heavy brand palette).
- Do **not** try to solve this by making danger a non-red color (e.g. orange) — that would break
  the universal "red = destructive" convention the *arr family (and virtually every dark-themed
  admin UI) relies on, for a much smaller problem than it would create.

### 3.4 Before/after token table

Applies identically to both `clients/tv-web/web/src/styles/global.css` and
`clients/tv-web/admin/src/styles/global.css` — confirmed these are the same file (see §1), so this
table is one edit applied twice, keeping them in sync as they are today.

| Token | Old value | Old role | New value | New role |
|---|---|---|---|---|
| `--color-brand` | `#5d9cec` | Primary buttons, links, checkbox fill, `::selection`, focus ring source | `#e5484d` | **Removed as a separate concept** — primary UI actions now use `--color-accent` directly (see rows below). `--color-brand` may be kept as a deprecated alias pointing at `--color-accent` for one release to avoid a big-bang class rename, then deleted. |
| `--color-brand-hover` | `#7badf0` | `.btn-primary:hover` | `#ef6469` | Reuses `--color-accent-hover`'s existing value — no new hex needed, already defined |
| `--color-brand-pressed` | `#4a84d1` | `.btn-primary:active` | `#c93a3e` | Reuses `--color-accent-pressed`'s existing value — no new hex needed |
| `--color-accent` | `#e5484d` | Nav hover/active text + left border, logo accent span | `#e5484d` (unchanged) | Same value, **widened role**: now also `.btn-primary`, `.poster-toggle.is-active`, general focus-ring source |
| `--color-focus-ring` | `#5d9cec` | `:focus-visible` outline | `#e5484d` | Matches new primary color |
| `--color-input-focus-border` | `#66afe9` | `.input:focus` border | `#ef6469` (i.e. `--color-accent-hover`) | Keep the "focus border is a lighter tint of primary, not primary itself" real-theme pattern, just re-based on red instead of blue |
| `--color-focus-glow` | `rgba(102, 175, 233, 0.6)` (blue) | `.input:focus` box-shadow | `rgba(229, 72, 77, 0.55)` (red, from `--color-accent`) | Same treatment, new hue; alpha nudged down slightly (0.6 → 0.55) since red glows read "hotter" than blue at equal alpha |
| `--color-info` | `#5d9cec` | Info-colored text/badges, `.sidebar-badge` default | `#5d9cec` (**unchanged**) | Blue is kept alive here deliberately — see note below |
| `--color-danger` | `#f05050` | `.btn-danger`, `.error-text`, `.badge-danger`, `.icon-btn-danger`, `.corner-ribbon`, `--color-focus-glow-error` source | `#dc2626` | Same roles, pushed darker/cooler per §3.3 so it stays visually distinct from the now-widespread accent red |
| `.checkbox-label input:checked` background | `var(--color-brand)` | Checked checkbox fill | `var(--color-accent)` | Follows the primary-color swap |
| `::selection` background | `var(--color-brand)` | Text selection highlight | `var(--color-accent)` | Follows the primary-color swap |

**Why `--color-info` stays blue:** `--color-info` is a *semantic* color (like danger/warning/success),
not a *brand* color — in the real *arr theme it happens to reuse the same hex as `--primaryColor`
because that app's primary action color *is* blue. Streamarr's primary is becoming red, but its
"informational" semantic meaning shouldn't also become red — that would collide with danger even
harder than the current brand/danger closeness does. Recommend `--color-info` keep `#5d9cec` as its
own standalone value (no longer aliased to primary, just its own blue) so info-badges, help-icons,
etc. stay a calm, distinct blue against an otherwise red-and-neutral UI. This is a judgment call for
whoever implements this table, flagged here explicitly rather than silently decided.

**`--color-queue` (`#7a43b6`, purple, used only for active-download/progress bars)** is unaffected
by any of this and should stay as-is — it's a third, deliberately distinct hue already, not part of
the red/blue swap.

### 3.5 Playarr Web is covered by the same change

Per §1's verified diff, `clients/tv-web/admin/src/styles/global.css` and
`clients/tv-web/web/src/styles/global.css` define an identical token block (the divergence is
limited to two component-level rules unrelated to color, see §1). The token table in §3.4 applies
to both files verbatim, and both logos (`<span class="app-logo-accent">Play</span>arr` in Web,
`<span class="app-logo-accent">Stream</span>arr` in Admin) already key off `--color-accent`, so no
logo-specific change is needed — they'll simply continue rendering in Streamarr's red, now
reinforced by the rest of the UI matching it instead of being an isolated red accent against an
otherwise-blue app.

## 4. Component patterns catalog

### 4.1 Settings card-grid with a "+" add tile

**Observed on:** Radarr Settings > Download Clients (screenshot + accessibility snapshot).

Pattern: a CSS grid of rectangular cards (~280px wide, `#2a2a2a`-ish raised dark background), each
showing only:
- The item's **name**, large (~20px), light-weight text, at the top.
- A **status pill** below it — gray "Disabled" or green "Enabled", rounded, small, padded, no
  border.
- Nothing else at rest — all configuration is behind a click into a modal.

The grid's **last tile** is a dedicated "add new" tile: identical size/shape to a real card, but
just a large "+" glyph centered in a thin-bordered (not filled) box. Clicking it opens the same
modal used for editing, in "create" mode.

**Maps to Streamarr's `.provider-grid` / `.provider-card`** (already defined in `global.css`,
already documented there as "Admin -> Source Instances, and any future provider-style config
list"). **Applies to:**
- **Source Instances** (`clients/tv-web/admin/src/pages/SourceInstances.tsx`) — this is the
  screen the user explicitly asked to mirror against Radarr's Download Clients. Currently this page
  already uses `.provider-grid`/`.provider-card`, but **diverges from the observed pattern in three
  ways** worth fixing in the redesign: (1) each card currently shows name + `base_url` + a kind
  badge + two always-visible icon buttons (sync/remove), rather than name + a single status pill
  with everything else behind a click; (2) there is no enabled/disabled-style status pill at all
  today — the closest equivalent is the neutral `kind` badge (e.g. "sonarr"), which communicates
  provider type, not connection health; (3) there is no "+" add tile — new instances are added via
  an always-visible `.card` form permanently rendered below the grid, not a modal reached by
  clicking a tile. A faithful redesign would move the add-form into a modal (see §4.3) launched from
  a "+" tile, and consider a status pill (e.g. "Reachable"/"Unreachable", sourced from the sync
  status this page already tracks in `syncStatus`) as the one piece of at-rest information on each
  card, keeping base_url/kind visible only once the card is opened.
- **Users** (`clients/tv-web/admin/src/pages/Users.tsx`) — already uses the same
  `.provider-grid`/`.provider-card` classes (confirmed by reading the file) for its user list, with
  username as the card name and role/lockout-state badges in `.provider-card-tags`. This is a
  reasonable reuse of the same pattern, and per the task's framing is *likely* the right pattern for
  Users generally — noted as an inference (the real *arr apps were never observed using this
  card-grid pattern for a user-management screen specifically; the inference is "this generic
  settings-card-grid pattern probably extends to any settings collection," not a direct observation
  of an *arr Users page).

### 4.2 Status pill badges

**Observed on:** Radarr Download Clients cards (gray "Disabled" / green "Enabled" pill, rounded,
padded, no border).

**Maps to Streamarr's `.badge` + `.badge-pill`** combination (already defined), specifically
`.badge-success.badge-pill` for an "Enabled"/"Reachable" state and `.badge-neutral.badge-pill` for
"Disabled". Streamarr already has both badge-success and badge-neutral defined; no new CSS needed,
just applying the existing pair in the enabled/disabled role Radarr uses it for, on Source Instances
and Users cards per §4.1.

### 4.3 Modal-based add/edit forms

**Observed on:** clicking a Download Clients card opens a modal titled "Edit Download Client -
`<Type>`" (e.g. "Edit Download Client - Deluge"). Structure, in order:

1. **Vertical form**, one full-width field per row: label left-aligned above or beside a full-width
   input; labels in a muted gray, placeholder-style.
2. **Real input variety** seen: text (Name, Host), number (Port), checkbox (Enable, Use SSL —
   rendered as a small solid-fill square that visibly turns blue+checked *with a checkmark glyph*,
   not just a color change), password (masked dots), select/dropdown (Recent Priority / Older
   Priority), tags input.
3. A **section divider** ("Completed Download Handling") splitting the form into logical groups
   within the same modal — confirms long forms are one modal with internal sections, not multiple
   modals or a wizard.
4. **Helper/description text**, smaller and dimmer, directly under fields that need explanation
   (e.g. "Adding a category specific to Radarr avoids conflicts...").
5. **Footer button row, explicitly not centered:**
   - "Delete" (red/danger) pinned to the **far left**, isolated from the rest.
   - Right-aligned cluster, in this order: a small gear/reset icon, "Test", "Cancel", "Save"
     (blue/primary) — **Save is rightmost, the most prominent position.**

**Maps to:** Streamarr already has every primitive this modal needs (`.input`, the checkbox pattern
with checkmark glyph — currently only in Web's copy of `global.css`, see §1's fix-it note — `.btn`
variants, `.hint` for helper text, `.section`/`.section-title` for the divider). What's **missing**
is the modal container itself: there is no `.modal` / `.modal-overlay` / `.modal-header` /
`.modal-footer` class set in `global.css` today, and neither Source Instances nor Users currently
opens anything in a modal — both render their "add" form as a permanently-visible `.card` below the
grid, and neither has an edit flow for an existing item at all (Source Instances only offers
sync/remove per-card; Users' cards were not inspected in this pass for their action set beyond
sync/remove-style icon buttons visible in the earlier grep). Building `.modal-overlay` (full-screen
scrim, reusing `--color-bg-overlay` which already exists for the detail-banner scrim),
`.modal` (centered panel, `--color-bg-chrome` background per §2.1's "sidebar / header / modal" tier,
`--radius-modal` which is already defined at `6px` but currently unused anywhere), `.modal-header`,
`.modal-body`, and `.modal-footer` (with a `justify-content: space-between` layout to get the
far-left-Delete / rightmost-Save button order) is new work implied by this pattern, not something
already sitting unused in the stylesheet. **Applies to:** Source Instances (edit/add flow) as the
direct ask; Users, if its add/edit flow is redesigned the same way, by the same inference as §4.1.

### 4.4 Table layout for simple tabular data

**Observed on:** Radarr Settings > Download Clients page, below the client cards — a separate
"Remote Path Mappings" section rendered as a plain 3-column table (Host / Remote Path / Local Path),
confirming the real theme mixes card-grid and table layouts on one page depending on what the data
actually is (a handful of rich, individually-configurable entities → cards; a flat list of simple
tuples → table).

**Maps to Streamarr's `.table` class** (already defined, already explicitly commented in
`global.css`: "for any data-heavy table; provider-config lists should use the `.provider-grid` /
`.provider-card` set below instead of a table" — i.e. this distinction is already understood and
encoded in the existing stylesheet). No current Streamarr page was found using `.table` yet (Home,
Library, WorkDetail, Settings, Source Instances, and Users were all checked; none render a
`<table>`). Worth keeping in mind for any future screen that's a flat list of simple fields (e.g. if
Source Instances ever grows a "Remote Path Mappings"-equivalent), but there's no current Streamarr
screen this pattern needs to be retrofitted onto today.

### 4.5 Poster grid (out of scope for this task, noted for later)

**Observed on:** Radarr's main "Movies" library screen — dense poster grid (~10 columns), each
poster with a colored underline strip (green = monitored/available, red = a flagged/different
state) and two caption lines below ("Monitored" / a quality-profile line like "Any"), plus an
alphabet index rail pinned to the viewport's right edge for scroll-to-letter, and a toolbar with the
same icon-over-label composition as settings pages *plus* a right-aligned View/Sort/Filter icon
cluster.

**Maps to Streamarr's `.poster-grid` / `.poster-card`** (already defined and already in active use
— `Home.tsx` renders a `<ul className="poster-grid">` of `WorkCard` components for "recently added"
titles; `Library.tsx` presumably extends this to the full catalog, though its file wasn't inspected
in detail this pass). This is Streamarr's own catalog/library browsing surface (`Home.tsx`,
`Library.tsx`, `WorkDetail.tsx` in Playarr Web) and is explicitly **out of scope for the Source
Instances redesign this document exists to drive** — noted here only so the pattern is on record for
whenever that screen gets its own design pass (e.g. the alphabet index rail and the colored
underline-strip status signal are both real *arr details Streamarr hasn't attempted to port yet).

## 5. Explicitly out of scope / not yet observed

Being direct about the boundaries of this document so a future pass knows what still needs
verification:

- **Only two *arr apps were scanned, and only one page in depth per app.** Sonarr was scanned for
  its root-level theme tokens only (no specific settings page walked in detail per the findings
  handed to this task). Radarr was scanned more deeply: its Download Clients settings page (cards +
  modal + table) and its Movies library page (poster grid + toolbar-with-filters). No other Sonarr
  page, and no Radarr page beyond those two, was part of the findings this document is based on.
- **Lidarr, Bazarr, Prowlarr, and Readarr were not scanned at all** — despite Streamarr's own
  `SOURCE_KINDS` list (`sonarr`, `radarr`, `lidarr`, `bazarr`, `prowlarr`, `readarr`) treating all
  six as first-class source types. The "byte-identical CSS architecture" claim is stated by the
  research findings to hold for Sonarr/Radarr/Lidarr, but only Sonarr and Radarr were actually
  browsed to confirm it — Lidarr's shared-architecture claim is secondhand, and Bazarr/Prowlarr/
  Readarr (which are not Servarr-family apps in the same codebase lineage as Sonarr/Radarr/Lidarr)
  weren't addressed by the findings at all. Don't assume they share this exact theme engine.
- **No light theme was scanned.** Everything in this document is the dark theme only; the real *arr
  apps do ship a light theme, but no tokens for it were captured.
- **No responsive/mobile behavior was scanned.** Sidebar-collapse-on-narrow-viewport, modal behavior
  on small screens, etc. are unaddressed — Streamarr's own `@media (max-width: 720px)` rule in
  `global.css` (padding-only) is not verified against any real *arr equivalent.
