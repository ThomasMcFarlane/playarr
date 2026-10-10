/**
 * Runtime half of the `:has()` fallback in legacy-tv-css.mjs, for TV engines older than
 * Chromium 105 (Tizen 7, webOS 23). The build rewrites `A:has(R)` to `A[data-lc-has~="hN"]` inside
 * `@supports not selector(:has(a))` and publishes each definition as `--lc-has-hN` on :root. This
 * keeps `data-lc-has` on every element matching A in sync with whether R matches relative to it.
 */
const ATTRIBUTE = "data-lc-has";

function collectDefinitions(styleSheets) {
  const definitions = new Map();
  const visit = (rules) => {
    for (const rule of rules ?? []) {
      if (rule.cssRules) visit(rule.cssRules);
      if (rule.selectorText !== ":root" || !rule.style) continue;
      for (let index = 0; index < rule.style.length; index += 1) {
        const property = rule.style[index];
        if (!property.startsWith("--lc-has-")) continue;
        try {
          definitions.set(property.slice("--lc-has-".length), JSON.parse(JSON.parse(rule.style.getPropertyValue(property).trim())));
        } catch {
          // A malformed definition only loses that one fallback.
        }
      }
    }
  };
  for (const sheet of styleSheets) {
    try {
      visit(sheet.cssRules);
    } catch {
      // Cross-origin sheets are not readable and never carry definitions.
    }
  }
  return definitions;
}

function splitTopLevel(list) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < list.length; index += 1) {
    if (list[index] === "(") depth += 1;
    else if (list[index] === ")") depth -= 1;
    else if (list[index] === "," && depth === 0) {
      parts.push(list.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts;
}

/** Whether relative selector `relative` (as written inside :has()) matches from `element`. */
export function matchesRelative(element, relative) {
  return splitTopLevel(relative).some((part) => {
    try {
      if (part.startsWith("+")) return Boolean(element.nextElementSibling?.matches(part.slice(1).trim()));
      if (part.startsWith("~")) {
        const target = part.slice(1).trim();
        for (let sibling = element.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
          if (sibling.matches(target)) return true;
        }
        return false;
      }
      return Boolean(element.querySelector(`:scope ${part}`));
    } catch {
      return false;
    }
  });
}

export function updateHasAttributes(documentObject, definitions) {
  const wanted = new Map();
  for (const [id, { anchor, relative }] of definitions) {
    let anchors;
    try {
      anchors = documentObject.querySelectorAll(anchor);
    } catch {
      continue;
    }
    for (const element of anchors) {
      if (!matchesRelative(element, relative)) continue;
      if (!wanted.has(element)) wanted.set(element, []);
      wanted.get(element).push(id);
    }
  }
  for (const element of documentObject.querySelectorAll(`[${ATTRIBUTE}]`)) {
    if (!wanted.has(element)) element.removeAttribute(ATTRIBUTE);
  }
  for (const [element, ids] of wanted) {
    const value = ids.join(" ");
    if (element.getAttribute(ATTRIBUTE) !== value) element.setAttribute(ATTRIBUTE, value);
  }
}

export function installLegacyHas({ windowObject = window, documentObject = document } = {}) {
  if (windowObject.CSS?.supports?.("selector(:has(a))")) return () => {};
  let definitions = new Map();
  let sheetCount = -1;
  let frame;
  const run = () => {
    frame = undefined;
    // Route chunks add style sheets later; re-read the definitions whenever the set changes.
    if (documentObject.styleSheets.length !== sheetCount) {
      sheetCount = documentObject.styleSheets.length;
      definitions = collectDefinitions(documentObject.styleSheets);
    }
    if (definitions.size) updateHasAttributes(documentObject, definitions);
  };
  const schedule = () => {
    if (frame === undefined) frame = windowObject.requestAnimationFrame(run);
  };
  const observer = new windowObject.MutationObserver((mutations) => {
    if (mutations.every((mutation) => mutation.attributeName === ATTRIBUTE)) return;
    schedule();
  });
  observer.observe(documentObject.documentElement, { subtree: true, childList: true, attributes: true });
  // :focus-visible and similar states change without a DOM mutation.
  documentObject.addEventListener("focusin", schedule, true);
  documentObject.addEventListener("focusout", schedule, true);
  schedule();
  return () => {
    observer.disconnect();
    documentObject.removeEventListener("focusin", schedule, true);
    documentObject.removeEventListener("focusout", schedule, true);
    if (frame !== undefined) windowObject.cancelAnimationFrame(frame);
  };
}
