// Guards the owner rule that the Calendar's header buttons and every other page's Filters button are one
// component per client (web .page-filters-button, Android PlayarrHeaderButton, iOS PlayarrHeaderPill, tvOS
// TVHeaderPill). Source-level checks so the Swift clients are covered on Linux CI too. Android has its own
// PlayarrHeaderButtonParityTest.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repo = (p: string) =>
  readFileSync(new URL(`../../../../../../${p}`, import.meta.url), "utf8");
const m = (text: string, re: RegExp, message?: string) =>
  expect(text, message).toMatch(re);
const nm = (text: string, re: RegExp, message?: string) =>
  expect(text, message).not.toMatch(re);

describe("header button parity across clients", () => {
  it("iOS: Filters and the Calendar link are both PlayarrHeaderPill", () => {
    const header = repo(
      "clients/ios/Sources/PlayarrApp/Views/PlayarrPageHeader.swift",
    );
    m(header, /struct PlayarrHeaderPill: View/);
    m(header, /struct PlayarrFiltersButton: View[\s\S]*PlayarrHeaderPill\(/);
    const calendar = repo(
      "clients/ios/Sources/PlayarrApp/Views/CalendarView.swift",
    );
    m(calendar, /PlayarrHeaderPill\(label: "Calendar link"/);
    m(repo("clients/ios/Sources/PlayarrApp/Views/LibraryView.swift"), /PlayarrHeaderPill\(label: "Filters"/);
    nm(
      calendar,
      /in: Circle\(\)/,
      "the calendar must not hand-draw its header buttons",
    );
  });

  it("tvOS: calendar pills and the library Filters launcher are both TVHeaderPill", () => {
    m(
      repo("clients/apple-tv/Sources/TVTheme.swift"),
      /struct TVHeaderPill: View/,
    );
    const calendar = repo("clients/apple-tv/Sources/TVCalendarView.swift");
    const pill = calendar.slice(calendar.indexOf("private func pill("));
    m(pill, /TVHeaderPill\(/);
    nm(pill, /Capsule\(\)/);
    const library = repo("clients/apple-tv/Sources/TVLibraryViews.swift");
    const launcher = library.slice(
      library.indexOf("private var filterLauncher"),
      library.indexOf("private var filterLauncher") + 400,
    );
    m(launcher, /TVHeaderPill\(label: "Filters"/);
  });

  it("web: Calendar passes its buttons through PageHeader like every other page", () => {
    const calendar = repo("clients/tv-web/web/src/pages/Calendar.tsx");
    m(calendar, /filters=\{\{/);
    m(calendar, /panelButtons=\{\[/);
    nm(calendar, /page-filters-button/);
  });
});
