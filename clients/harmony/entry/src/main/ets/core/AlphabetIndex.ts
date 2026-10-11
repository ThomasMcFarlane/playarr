/**
 * The library A-Z rail, as web `Library.tsx` (`ALPHABET`, `titleLetter`, `jumpToLetter`): "#" for titles
 * that do not start with A-Z after stripping accents; a jump lands on the first title at or after the
 * letter in the current sort order.
 */

export const ALPHABET: string[] = ["#", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"];

/** The rail's letters in display order: reversed for a descending sort, as on web. */
export function alphabetFor(order: string): string[] {
  const letters = ALPHABET.slice();
  if (order === "desc") {
    letters.reverse();
  }
  return letters;
}

export function titleLetter(title: string): string {
  const first = title.trim().normalize("NFKD").replace(/[̀-ͯ]/g, "").charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : "#";
}

/** Web `workLetter`: the sort title when there is one, else the title. */
export function workLetter(sortTitle: string, title: string): string {
  return titleLetter(sortTitle.length > 0 ? sortTitle : title);
}

/**
 * Index of the first title whose letter is at or after `letter` in `order`, or -1 when none of the
 * loaded titles is (the caller loads more pages, or falls back to the last title).
 */
export function firstIndexAtOrAfter(letters: string[], letter: string, order: string): number {
  const alphabet = alphabetFor(order);
  const target = alphabet.indexOf(letter);
  for (let i = 0; i < letters.length; i++) {
    if (alphabet.indexOf(letters[i]) >= target) {
      return i;
    }
  }
  return -1;
}
