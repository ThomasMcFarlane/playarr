#!/usr/bin/env node
// Right-side panel section spacing (owner report, 10 October 2026: "Right panels like Filters: labels are squished
// with the items above"). Every section label in a drawer needs clear space above it, and that space must be larger
// than the gap between the label and its own items, so the label reads as heading the group below it (proximity).
//
// Movies, Series, Search and Calendar Filters (plus the Calendar link panel), both themes, 1920x1080 and 1280x720.
// For every section after the first: gap above its label >= MIN_ABOVE_PX and > the label-to-items gap.
//
//   node scripts/drawer-spacing-e2e.mjs [--no-build] [--dist dir]
import { boot } from "./e2e-common.mjs";

const { check, open, finish } = await boot({ movies: 24, series: 12 });
const MIN_ABOVE_PX = 20;

const MEASURE = () => {
  const drawer = document.querySelector(".tv-filter-drawer");
  if (!drawer) return null;
  const sections = [...drawer.querySelectorAll(".drawer-body section")];
  const rows = [];
  sections.forEach((section, i) => {
    const label = section.querySelector(":scope > h3");
    if (!label) return;
    const items = label.nextElementSibling;
    // The block above is whatever precedes the section: the previous section, or the body's earlier content.
    const prev = section.previousElementSibling;
    rows.push({
      text: label.textContent,
      above: prev ? section.getBoundingClientRect().top - prev.getBoundingClientRect().bottom : null,
      toItems: items ? items.getBoundingClientRect().top - label.getBoundingClientRect().bottom : null,
      first: i === 0 || !prev,
    });
  });
  return rows;
};

const panels = [
  ["movies", "/movies?panel=filters"],
  ["series", "/series?panel=filters"],
  ["search", "/search?q=a&panel=filters"],
  ["calendar", "/calendar?panel=filters"],
];

for (const [name, path] of panels) {
  for (const [width, height] of [[1920, 1080], [1280, 720]]) {
    for (const theme of ["dark", "light"]) {
      const label = `${name} ${width}x${height} ${theme}`;
      const { context, page } = await open(path, { width, height, theme });
      try {
        await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
        await page.waitForSelector(".tv-filter-drawer .drawer-body section", { timeout: 8000 });
        await page.waitForTimeout(700);
        const rows = await page.evaluate(MEASURE);
        const later = (rows ?? []).filter((r) => !r.first);
        check(`${label}: panel has at least two labelled sections`, later.length >= 1, JSON.stringify(rows));
        for (const r of later) {
          check(`${label}: "${r.text}" has >= ${MIN_ABOVE_PX}px above it`, r.above >= MIN_ABOVE_PX, `${r.above}px`);
          check(`${label}: "${r.text}" gap above (${r.above}px) is larger than label-to-items (${r.toItems}px)`, r.above > r.toItems, `${r.above} vs ${r.toItems}`);
        }
      } finally {
        await context.close();
      }
    }
  }
}
await finish();
