import postcss from "postcss";

function matchingParen(value, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function topLevelParts(value) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") depth -= 1;
    else if (value[index] === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function firstMixedColour(contents) {
  const parts = topLevelParts(contents);
  if (parts.length < 3 || !/^in\s+srgb(?:-linear)?$/i.test(parts[0])) return undefined;
  return parts[1].replace(/\s+[+-]?(?:\d+(?:\.\d+)?|\.\d+)%\s*$/, "").trim();
}

/**
 * Gives the Chromium 94 vendor floor a usable solid-colour fallback while preserving the
 * richer color-mix declaration for newer TVs. Playarr's mixes consistently
 * put the semantic theme colour first, so the fallback follows theme changes.
 */
export function replaceUnsupportedColorMix(value) {
  let output = "";
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf("color-mix(", cursor);
    if (start < 0) return output + value.slice(cursor);
    output += value.slice(cursor, start);
    const open = start + "color-mix".length;
    const close = matchingParen(value, open);
    if (close < 0) return output + value.slice(start);
    const replacement = firstMixedColour(value.slice(open + 1, close));
    output += replacement || value.slice(start, close + 1);
    cursor = close + 1;
  }
  return output;
}

function insetSides(value) {
  const values = postcss.list.space(value);
  if (values.length < 1 || values.length > 4) return undefined;
  const [top, second = top, third = top, fourth = second] = values;
  return values.length === 2
    ? [top, second, top, second]
    : values.length === 3
      ? [top, second, third, second]
      : [top, second, third, fourth];
}

export function addLegacyTvCssFallbacks(css, from = undefined) {
  const root = postcss.parse(css, { from });
  root.walkDecls((declaration) => {
    if (declaration.prop === "inset") {
      const sides = insetSides(declaration.value);
      if (sides) {
        for (const [property, value] of ["top", "right", "bottom", "left"].map(
          (property, index) => [property, sides[index]]
        )) {
          declaration.cloneBefore({ prop: property, value });
        }
      }
    }

    if (declaration.value.includes("color-mix(")) {
      const fallback = replaceUnsupportedColorMix(declaration.value);
      if (fallback !== declaration.value && !fallback.includes("color-mix(")) {
        declaration.cloneBefore({ value: fallback });
      }
    }
  });
  return root.toString();
}

export function legacyTvCssPlugin() {
  return {
    name: "playarr-legacy-tv-css",
    enforce: "pre",
    transform(code, id) {
      if (!id.split("?", 1)[0].endsWith(".css")) return null;
      return { code: addLegacyTvCssFallbacks(code, id), map: null };
    },
  };
}
