import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from "react";
import { Link, type LinkProps } from "react-router-dom";

/**
 * The one button family. Every button in new UI goes through here so shape,
 * focus ring and TV focus scale stay consistent (`button-audit.test.ts`
 * fails on raw `btn` styling outside this file and the legacy allow-list).
 *
 *  - `primary`   solid accent, the main action of a surface
 *  - `secondary` outlined pill, the default
 *  - `ghost`     text-only, for low emphasis and selectable labels
 *  - `icon`      round, glyph only (needs `aria-label`)
 *  - `danger`    destructive confirmation
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "icon" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface StyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Pressed/open state; renders the inverted "active" look. */
  active?: boolean;
}

export function buttonClassName({ variant = "secondary", size = "md", active }: StyleProps, extra?: string): string {
  const base = variant === "icon" ? "secondary" : variant === "ghost" ? "ghost" : variant;
  return [
    "btn",
    `btn-${base}`,
    "ui-btn",
    `ui-btn--${variant}`,
    `ui-btn--${size}`,
    active ? "is-active" : "",
    extra ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & StyleProps;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, active, className, type = "button", ...rest },
  ref
) {
  return <button ref={ref} type={type} className={buttonClassName({ variant, size, active }, className)} {...rest} />;
});

export type ButtonLinkProps = Omit<LinkProps, "className"> & StyleProps & { className?: string };

/** A router link that looks and focuses like a {@link Button}. */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant, size, active, className, ...rest },
  ref
) {
  return <Link ref={ref} className={buttonClassName({ variant, size, active }, className)} {...rest} />;
});

export type { AnchorHTMLAttributes };
