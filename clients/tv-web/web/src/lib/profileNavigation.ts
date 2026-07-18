type ProfileAction = "select" | "settings";

/** A gated route should retry its saved current profile before asking for credentials. */
export function shouldRevalidateCurrentProfile(
  isCurrent: boolean,
  action: ProfileAction,
  loginFromOverride?: string
): boolean {
  return isCurrent && action === "select" && loginFromOverride !== undefined;
}
