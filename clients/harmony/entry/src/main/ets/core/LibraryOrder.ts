// core/LibraryOrder.ts: web pages/Library.tsx `orderWorks`, which re-sorts every loaded title on the client.
// Web compares `sort_title || title` with `Intl.Collator(undefined, { numeric: true, sensitivity: "base" })`;
// this is the same rule written out (digit runs by value; letters without case or accents), so it does not
// depend on the runtime's Intl data.
import type { Work } from "./Types/Work.ts";

const DIGITS = /^[0-9]+$/;

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function chunks(text: string): string[] {
  return fold(text).match(/[0-9]+|[^0-9]+/g) ?? [];
}

/** Natural, case- and accent-insensitive order: "2 Fast" < "9 Bullets" < "10 Cloverfield" < "12 Strong". */
export function compareTitles(a: string, b: string): number {
  const left = chunks(a);
  const right = chunks(b);
  const count = Math.min(left.length, right.length);
  for (let i = 0; i < count; i++) {
    const x = left[i];
    const y = right[i];
    if (DIGITS.test(x) && DIGITS.test(y)) {
      const difference = Number(x) - Number(y);
      if (difference !== 0) {
        return difference < 0 ? -1 : 1;
      }
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return left.length - right.length;
}

function titleKey(work: Work): string {
  return work.sort_title.length > 0 ? work.sort_title : work.title;
}

/** Web `orderWorks`: title (natural order) or date added, in either direction; other sorts keep server order. */
export function orderWorks(items: Work[], sort: string, order: string): Work[] {
  const direction = order === "asc" ? 1 : -1;
  if (sort === "date_added") {
    return items.slice().sort((a: Work, b: Work) => (Date.parse(a.added_at) - Date.parse(b.added_at)) * direction);
  }
  if (sort === "title") {
    return items.slice().sort((a: Work, b: Work) => compareTitles(titleKey(a), titleKey(b)) * direction);
  }
  return items;
}
