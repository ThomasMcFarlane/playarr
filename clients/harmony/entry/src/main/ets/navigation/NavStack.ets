/**
 * `NavPathStack` accessor plus typed push/replace/pop helpers (brief
 * section 3.2, "navigation/"). Wraps the ONE shared `NavPathStack` behind
 * exactly one `AppStorage` key, `NAV_STACK_STORAGE_KEY`; this file has no
 * other global mutable state.
 *
 * `pages/Index.ets` is the root `Navigation` host: it calls
 * `installNavStack()` once, at construction, to obtain the shared
 * instance and hand it to its own `Navigation(...)` component. Every other
 * page that needs to navigate (push a route, replace the current one, or
 * pop back) calls `getNavStack()` to fetch that same instance, then calls
 * `pushRoute` / `replaceRoute` / `popRoute` below rather than calling
 * `NavPathStack`'s own methods directly, so every route name and every
 * navigation-parameter shape stays pinned to `navigation/Routes.ets` (its
 * `ROUTES` object and its per-route parameter interfaces) instead of
 * drifting into an ad hoc string or an untyped payload at each call site.
 *
 * `@ohos.router` is deliberately NOT used anywhere in this file or its
 * callers (brief section 3.2): its global functions are deprecated since
 * API 18, and `Navigation` + `NavPathStack` already gives the automatic
 * single/double-column adaptation the TV/phone split needs on the Library
 * screen for free.
 */


/** The one `AppStorage` key the shared `NavPathStack` instance lives
 * under. Exported so a debug page can read it back directly; ordinary
 * callers should use `installNavStack` / `getNavStack` instead of reading
 * this key themselves. */
export const NAV_STACK_STORAGE_KEY: string = 'navPathStack';

/**
 * Returns the shared `NavPathStack`, creating and publishing one into
 * `AppStorage` the first time it is called. Idempotent: a second call
 * (from anywhere, including a re-run of `pages/Index.ets`'s own
 * construction) returns the already-published instance rather than
 * resetting the back-stack.
 *
 * Call this from `pages/Index.ets`, at the root `Navigation` host's
 * construction, and nowhere else. Every other page should call
 * `getNavStack` instead, which fails loudly rather than silently creating
 * a second, disconnected stack.
 */
export function installNavStack(): NavPathStack {
  const existing: NavPathStack | undefined = AppStorage.get<NavPathStack>(NAV_STACK_STORAGE_KEY);
  if (existing !== undefined) {
    return existing;
  }
  const stack: NavPathStack = new NavPathStack();
  AppStorage.setOrCreate<NavPathStack>(NAV_STACK_STORAGE_KEY, stack);
  return stack;
}

/**
 * Returns the shared `NavPathStack` installed by `pages/Index.ets`.
 * Throws if called before `installNavStack()` has ever run: the same
 * "call init first, or throw" discipline `AppContainer.ets` and
 * `auth/SettingsStore.ets` already use elsewhere in this client.
 */
export function getNavStack(): NavPathStack {
  const stack: NavPathStack | undefined = AppStorage.get<NavPathStack>(NAV_STACK_STORAGE_KEY);
  if (stack === undefined) {
    throw new Error('NavStack: installNavStack() must run (from pages/Index.ets) before getNavStack() is called');
  }
  return stack;
}

/** Stands in for "no parameters" (ArkTS forbids a bare `{}` literal as an `Object`). */
class NoRouteParams {}

/**
 * Pushes `route`, one of `navigation/Routes.ets`'s `ROUTES` values, onto
 * `stack`, carrying `params` typed as that route's own parameter
 * interface (`DetailRouteParams`, `LibraryRouteParams`,
 * `PlayerRouteParams`). Omit `params` entirely for a route that has none:
 * per `Routes.ets`, that is Index, ServerSetup, Pairing, Profiles and
 * Home.
 */
export function pushRoute<P extends Object>(stack: NavPathStack, route: string, params?: P): void {
  if (params === undefined) {
    stack.pushPathByName(route, new NoRouteParams());
    return;
  }
  stack.pushPathByName(route, params);
}

/**
 * Replaces the current top of `stack` with `route`, the same parameter
 * rules as `pushRoute`. Used for boot-flow transitions that should not
 * leave a back-stack entry behind, for example landing on Home once
 * pairing and profile selection have both completed.
 */
export function replaceRoute<P extends Object>(stack: NavPathStack, route: string, params?: P): void {
  if (params === undefined) {
    stack.replacePathByName(route, new NoRouteParams());
    return;
  }
  stack.replacePathByName(route, params);
}

/** Pops the top entry off `stack`, returning to whatever route pushed it. */
export function popRoute(stack: NavPathStack): void {
  stack.pop();
}
