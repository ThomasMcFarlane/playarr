import { color, spacing, typeScale } from "@playarr-tv/design-tokens";

export interface AsyncStateMessageProps {
  kind: "loading" | "empty" | "error";
  /** Shown for `"empty"`/`"error"`; a sensible default is used for `"loading"`. */
  message?: string;
}

/**
 * The one loading/empty/error visual used by every TV screen container
 * (`BrowseScreenContainer`, `DetailScreenContainer`, `PlayerScreenContainer`)
 * so those three states look and behave identically everywhere they occur.
 */
export function AsyncStateMessage({ kind, message }: AsyncStateMessageProps) {
  const text =
    message ?? (kind === "loading" ? "Loading..." : kind === "empty" ? "Nothing to show yet." : "Something went wrong.");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100%",
        padding: spacing.xxxl,
        background: color.background.base,
      }}
    >
      <p
        style={{
          fontSize: typeScale.subtitle.fontSize,
          color: kind === "error" ? color.state.error : color.text.secondary,
          textAlign: "center",
          maxWidth: 640,
        }}
      >
        {text}
      </p>
    </div>
  );
}
