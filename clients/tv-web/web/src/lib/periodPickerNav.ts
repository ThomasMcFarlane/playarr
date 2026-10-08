/**
 * D-pad movement inside the calendar period picker. The picker is a focus trap: every arrow key is consumed, so
 * focus can never escape to the chips behind the popover (audit A3, R22). UP and DOWN move within a list and hold at
 * the ends; LEFT and RIGHT switch between the month and year lists.
 */
export function periodPickerMove(
  key: string,
  list: number,
  index: number,
  lengths: readonly number[]
): { list: number; index: number } | null {
  switch (key) {
    case "ArrowDown":
      return { list, index: Math.min((lengths[list] ?? 1) - 1, index + 1) };
    case "ArrowUp":
      return { list, index: Math.max(0, index - 1) };
    case "ArrowRight":
    case "ArrowLeft": {
      const nextList = key === "ArrowRight" ? list + 1 : list - 1;
      if (nextList < 0 || nextList >= lengths.length) return { list, index };
      return { list: nextList, index: Math.min(index, (lengths[nextList] ?? 1) - 1) };
    }
    default:
      return null;
  }
}
