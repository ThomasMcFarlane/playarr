/** 27 letter buckets, "#" first -- matches the Sonarr rail exactly. */
export const ALPHA_RAIL_LETTERS = [
  "#",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
] as const;

/** Which bucket a work's `sort_title` falls into -- uppercase first char, anything not A-Z is "#". */
export function bucketLetter(sortTitle: string): string {
  const first = sortTitle.trim().charAt(0).toUpperCase();
  return first >= "A" && first <= "Z" ? first : "#";
}

interface AlphabetIndexRailProps {
  onSelect: (letter: string) => void;
}

/**
 * Sonarr's `PageJumpBar` reproduced structurally: a flex *sibling* of the
 * scrolling grid (`position: static`, not sticky/fixed -- see
 * `.library-content-row`/`.poster-grid-scroll` in global.css), 27 always-
 * enabled letter buttons. Every letter is clickable even when its own
 * bucket is empty -- `Library.tsx`'s `onSelect` scans forward to the
 * nearest populated bucket rather than producing a dead click, matching
 * the research finding that the real rail never disables a letter.
 */
export function AlphabetIndexRail({ onSelect }: AlphabetIndexRailProps) {
  return (
    <nav className="alpha-rail" aria-label="Jump to letter">
      {ALPHA_RAIL_LETTERS.map((letter) => (
        <button
          key={letter}
          type="button"
          className="alpha-rail-item"
          onClick={() => onSelect(letter)}
        >
          {letter}
        </button>
      ))}
    </nav>
  );
}
