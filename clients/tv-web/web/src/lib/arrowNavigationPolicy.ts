const VERTICALLY_ESCAPABLE_INPUT_TYPES = new Set([
  "text",
  "url",
  "email",
  "password",
  "search",
  "tel",
]);

export type FormControlDescriptor =
  | { kind: "input"; type: string }
  | { kind: "select" | "textarea" };

/**
 * Text-entry controls keep Left/Right for caret movement but release Up/Down
 * to spatial navigation. Controls where arrows change a native value keep
 * every arrow key.
 */
export function shouldNavigateFromFormControl(
  key: string,
  control: FormControlDescriptor
): boolean {
  return (
    control.kind === "input" &&
    VERTICALLY_ESCAPABLE_INPUT_TYPES.has(control.type) &&
    (key === "ArrowUp" || key === "ArrowDown")
  );
}
