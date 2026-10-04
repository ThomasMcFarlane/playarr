/**
 * Decides whether a page header's detail text (subtitle / breadcrumb) fits on
 * the title line. It must never run under the shell clock or under the
 * header's own right-side actions; when it does not fit it wraps beneath the
 * title and the divider turns from a vertical rule into a horizontal one.
 */
export interface DetailFitInput {
  /** Left edge of the header in px. */
  headerLeft: number;
  backWidth: number;
  titleWidth: number;
  /** Natural (unwrapped) width of the detail text including its own padding. */
  detailWidth: number;
  /** Flex gap between header children. */
  gap: number;
  /** Left edges of things the detail must stay clear of (clock, actions); empty when none. */
  obstacles: readonly number[];
  /** Minimum breathing room before an obstacle. */
  margin?: number;
}

export function detailFitsInline(input: DetailFitInput): boolean {
  if (input.obstacles.length === 0) return true;
  const margin = input.margin ?? 16;
  const right = input.headerLeft + input.backWidth + input.gap + input.titleWidth + input.gap + input.detailWidth;
  return right + margin <= Math.min(...input.obstacles);
}
