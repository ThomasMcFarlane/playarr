const VERTICALLY_ESCAPABLE_INPUT_TYPES = new Set([
  "text",
  "url",
  "email",
  "password",
  "search",
  "tel",
]);

export type FormControlDescriptor =
  | {
      kind: "input";
      type: string;
      selectionStart: number | null;
      selectionEnd: number | null;
      valueLength: number;
    }
  | { kind: "select" | "textarea" };

/**
 * Text-entry controls keep Left/Right while the caret can move, then release
 * the key to spatial navigation at the matching boundary. They always release
 * Up/Down. Controls where arrows change a native value keep every arrow key.
 */
export function shouldNavigateFromFormControl(
  key: string,
  control: FormControlDescriptor
): boolean {
  if (
    control.kind !== "input" ||
    !VERTICALLY_ESCAPABLE_INPUT_TYPES.has(control.type)
  ) {
    return false;
  }

  if (key === "ArrowUp" || key === "ArrowDown") return true;
  if (
    control.selectionStart === null ||
    control.selectionEnd === null ||
    control.selectionStart !== control.selectionEnd
  ) {
    return false;
  }

  if (key === "ArrowLeft") return control.selectionStart === 0;
  if (key === "ArrowRight") return control.selectionEnd === control.valueLength;
  return false;
}
