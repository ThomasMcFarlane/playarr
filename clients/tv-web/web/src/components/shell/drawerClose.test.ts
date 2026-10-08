import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  DRAWER_CLOSE_SLACK_MS,
  DRAWER_CLOSING_CLASS,
  longestCssTime,
  playDrawerClose,
  findOpener,
  openerSelector,
  restoreOpenerFocus,
  restoreOpenerFocusWhenReady,
  snapshotDrawer,
  type DrawerCloseEnv,
} from "./drawerClose";

/** The smallest element surface drawerClose.ts touches; the web suite runs in the node environment. */
class FakeElement {
  attributes = new Map<string, string>();
  classes = new Set<string>();
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  listeners = new Map<string, Array<(event: unknown) => void>>();
  removed = false;
  constructor(classes: string[] = [], id?: string) {
    classes.forEach((name) => this.classes.add(name));
    if (id) this.attributes.set("id", id);
  }
  get parentElement() {
    return this.parent;
  }
  get classList() {
    return {
      add: (name: string) => void this.classes.add(name),
      contains: (name: string) => this.classes.has(name),
    };
  }
  append(child: FakeElement) {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  appendChild(child: FakeElement) {
    return this.append(child);
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  getBoundingClientRect() {
    return { top: 0, left: 1500, width: 420, height: 1080 };
  }
  cloneNode() {
    const copy = new FakeElement([...this.classes]);
    this.attributes.forEach((value, name) => copy.attributes.set(name, value));
    this.children.forEach((child) => copy.append(child.cloneNode()));
    return copy;
  }
  all(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.all()]);
  }
  querySelectorAll(selector: string) {
    return selector === "[id]" ? this.all().filter((element) => element.attributes.has("id")) : [];
  }
  querySelector(selector: string) {
    const name = selector.replace(".", "");
    return this.all().find((element) => element.classes.has(name)) ?? null;
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== listener));
  }
  dispatch(type: string, target: FakeElement) {
    (this.listeners.get(type) ?? []).slice().forEach((listener) => listener({ target }));
  }
  remove() {
    this.removed = true;
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
}

function setup(options: { scrim?: boolean; reduced?: boolean; duration?: string } = {}) {
  const body = new FakeElement(["body"]);
  const drawer = new FakeElement(["tv-filter-drawer", "drawer"], "filters-drawer");
  drawer.append(new FakeElement(["drawer-body"], "inner"));
  if (options.scrim) new FakeElement(["media-context-backdrop"]).append(drawer);
  else new FakeElement(["page"]).append(drawer);

  const timers: Array<{ callback: () => void; ms: number; cancelled: boolean }> = [];
  const env = {
    document: { body } as unknown as Document,
    reducedMotion: () => Boolean(options.reduced),
    setTimeout: (callback: () => void, ms: number) => {
      const timer = { callback, ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (handle: unknown) => {
      (handle as { cancelled: boolean }).cancelled = true;
    },
  } satisfies DrawerCloseEnv;
  const snapshot = snapshotDrawer(drawer as unknown as HTMLElement);
  const ghost = snapshot.ghost as unknown as FakeElement;
  const panel = snapshot.panel as unknown as FakeElement;
  const computed = () => ({ animationDuration: options.duration ?? "360ms", animationDelay: "0s" });
  return { body, drawer, env, snapshot, ghost, panel, timers, computed };
}

describe("drawer closing state", () => {
  it("copies the drawer into an inert, id-free ghost that plays the closing class", () => {
    const { ghost, panel, drawer } = setup();
    expect(panel).toBe(ghost);
    expect(panel.classes.has(DRAWER_CLOSING_CLASS)).toBe(true);
    expect(drawer.classes.has(DRAWER_CLOSING_CLASS)).toBe(false);
    expect(ghost.attributes.get("aria-hidden")).toBe("true");
    expect(ghost.attributes.has("inert")).toBe(true);
    expect(ghost.attributes.has("role")).toBe(false);
    expect([ghost, ...ghost.all()].some((element) => element.attributes.has("id"))).toBe(false);
    expect(ghost.style).toMatchObject({ position: "fixed", left: "1500px", width: "420px", height: "1080px" });
  });

  it("copies the scrim wrapper too and animates the drawer inside it", () => {
    const { ghost, panel } = setup({ scrim: true });
    expect(ghost.classes.has("media-context-backdrop")).toBe(true);
    expect(panel).not.toBe(ghost);
    expect(panel.classes.has(DRAWER_CLOSING_CLASS)).toBe(true);
    expect(ghost.classes.has(DRAWER_CLOSING_CLASS)).toBe(false);
    expect(ghost.style.position).toBeUndefined();
  });

  it("stays mounted until animationend, then removes the ghost and reports done once", () => {
    const { env, snapshot, ghost, panel, body, computed } = setup();
    const done = vi.fn();
    playDrawerClose(snapshot, env, done, computed);
    expect(body.children).toContain(ghost);
    expect(done).not.toHaveBeenCalled();

    panel.dispatch("animationend", new FakeElement());
    expect(done).not.toHaveBeenCalled();
    expect(body.children).toContain(ghost);

    panel.dispatch("animationend", panel);
    expect(done).toHaveBeenCalledTimes(1);
    expect(ghost.removed).toBe(true);
    panel.dispatch("animationend", panel);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("falls back to a timer of the animation duration plus slack when animationend never fires", () => {
    const { env, snapshot, ghost, timers, computed } = setup({ duration: "0.24s" });
    const done = vi.fn();
    playDrawerClose(snapshot, env, done, computed);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(240 + DRAWER_CLOSE_SLACK_MS);
    timers[0]!.callback();
    expect(done).toHaveBeenCalledTimes(1);
    expect(ghost.removed).toBe(true);
  });

  it("cancels the timer when the animation ends first", () => {
    const { env, snapshot, panel, timers, computed } = setup();
    playDrawerClose(snapshot, env, () => undefined, computed);
    panel.dispatch("animationend", panel);
    expect(timers[0]!.cancelled).toBe(true);
  });

  it("closes without a ghost when the user prefers reduced motion", () => {
    const { env, snapshot, body, timers, computed } = setup({ reduced: true });
    const done = vi.fn();
    playDrawerClose(snapshot, env, done, computed);
    expect(done).toHaveBeenCalledTimes(1);
    expect(body.children).toHaveLength(0);
    expect(timers).toHaveLength(0);
  });

  it("can be cut short, which still removes the ghost and reports done", () => {
    const { env, snapshot, ghost, computed } = setup();
    const done = vi.fn();
    const finish = playDrawerClose(snapshot, env, done, computed);
    finish();
    expect(ghost.removed).toBe(true);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe("drawer focus return", () => {
  const doc = (active: unknown, contains = true) =>
    ({ activeElement: active, body: "body", documentElement: "html", contains: () => contains }) as unknown as Document;

  it("focuses the launcher when nothing else holds focus", () => {
    const focus = vi.fn();
    restoreOpenerFocus({ focus } as unknown as HTMLElement, doc("body"));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("leaves focus alone when the user has moved on, or the launcher is gone", () => {
    const focus = vi.fn();
    restoreOpenerFocus({ focus } as unknown as HTMLElement, doc({}));
    restoreOpenerFocus({ focus } as unknown as HTMLElement, doc("body", false));
    restoreOpenerFocus(null, doc("body"));
    expect(focus).not.toHaveBeenCalled();
  });
});

describe("launcher lookup after a re-render", () => {
  const launcher = (attrs: Record<string, string>) =>
    ({ tagName: "BUTTON", getAttribute: (name: string) => attrs[name] ?? null }) as unknown as HTMLElement;

  it("describes the launcher by what it controls, then by its label", () => {
    expect(openerSelector(launcher({ "aria-controls": "filters-panel" }))).toBe('[aria-controls="filters-panel"]');
    expect(openerSelector(launcher({ "aria-label": "Filters" }))).toBe('button[aria-label="Filters"]');
    expect(openerSelector(launcher({}))).toBeNull();
    expect(openerSelector(null)).toBeNull();
  });

  it("finds the replacement launcher when the original element was removed", () => {
    const replacement = { focus: vi.fn() } as unknown as HTMLElement;
    const gone = {} as HTMLElement;
    const document = { contains: (node: unknown) => node === replacement, querySelector: () => replacement } as unknown as Document;
    expect(findOpener(gone, '[aria-controls="x"]', document)).toBe(replacement);
    expect(findOpener(gone, null, document)).toBeNull();
  });

  it("waits for a re-rendered page to mount the launcher, then focuses it", () => {
    const focus = vi.fn();
    const replacement = { focus } as unknown as HTMLElement;
    let mounted = false;
    const document = {
      body: {},
      documentElement: {},
      activeElement: null as unknown,
      contains: (node: unknown) => mounted && node === replacement,
      querySelector: () => (mounted ? replacement : null),
    } as unknown as Document;
    (document as { activeElement: unknown }).activeElement = document.body;
    const frames: Array<() => void> = [];
    restoreOpenerFocusWhenReady({} as HTMLElement, '[aria-controls="x"]', document, (callback) => frames.push(callback));
    expect(focus).not.toHaveBeenCalled();
    mounted = true;
    frames.shift()!();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("stops waiting once the user has focused something else", () => {
    const other = {};
    const document = { body: {}, documentElement: {}, activeElement: other, contains: () => false, querySelector: () => null } as unknown as Document;
    const requestFrame = vi.fn();
    restoreOpenerFocusWhenReady({} as HTMLElement, '[aria-controls="x"]', document, requestFrame);
    expect(requestFrame).not.toHaveBeenCalled();
  });
});

describe("drawer closing styles", () => {
  const css = readFileSync(new URL("../../styles/global.css", import.meta.url), "utf8");

  it("closing is the opening keyframes reversed, with an ease that moves at once (not the mirrored expo)", () => {
    const opening = /@keyframes tv-filter-drawer-in\s*\{[^}]*from\s*\{([^}]*)\}\s*to\s*\{([^}]*)\}/.exec(css)!;
    const closing = /@keyframes drawer-out\s*\{[^}]*from\s*\{([^}]*)\}\s*to\s*\{([^}]*)\}/.exec(css)!;
    const norm = (value: string) => value.replace(/\s+/g, " ").trim();
    expect(norm(closing[1]!)).toBe(norm(opening[2]!));
    expect(norm(closing[2]!)).toBe(norm(opening[1]!));

    const close = /\.tv-filter-drawer\.is-closing \{[^}]*animation-timing-function: cubic-bezier\(([^)]+)\)/.exec(css)!;
    const [x1, y1, x2, y2] = close[1]!.split(",").map(Number) as [number, number, number, number];
    const bez = (a: number, b: number, u: number) => 3 * a * (1 - u) ** 2 * u + 3 * b * (1 - u) * u ** 2 + u ** 3;
    const progressAt = (time: number) => {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 40; i += 1) {
        const mid = (lo + hi) / 2;
        if (bez(x1, x2, mid) < time) lo = mid;
        else hi = mid;
      }
      return bez(y1, y2, lo);
    };
    // A time-reversed expo-out is still at about 1% after a quarter of the time, then dashes: a visible jump.
    expect(progressAt(0.25)).toBeGreaterThan(0.2);
    expect(progressAt(0.5)).toBeGreaterThan(0.5);
    expect(progressAt(0.5)).toBeLessThan(0.95);
  });

  it("closing does not set its own duration, so it always matches the opening one", () => {
    const rule = /\.tv-filter-drawer\.is-closing \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).not.toMatch(/animation-duration|animation:/);
  });
});

describe("Drawer component", () => {
  const source = readFileSync(new URL("./Drawer.tsx", import.meta.url), "utf8");
  it("plays the closing animation on unmount and returns focus afterwards", () => {
    expect(source).toMatch(/playDrawerClose\(snapshot, env, \(\) =>\s*restoreOpenerFocusWhenReady/);
    expect(source).not.toMatch(/opener\.focus/);
  });
});
