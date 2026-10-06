import { useState } from "react";
import { describeApiError, type TitleSnapshot } from "@playarr-tv/api-client";
import { useApiClient } from "../lib/ApiClientProvider";
import { useLanguage } from "../lib/i18n/LanguageProvider";

/**
 * Asks the request provider to add a title. The server decides whether the
 * caller may, so failures (not allowed, already requested, provider down) are
 * shown as the server's own explanation instead of being guessed here.
 */
export function RequestButton({
  snapshot,
  className,
  focusKey,
  disabled,
  alreadyRequested,
}: {
  snapshot: TitleSnapshot;
  className?: string;
  focusKey?: string;
  /** The server says the caller cannot request this title (its reason is shown by the caller). */
  disabled?: boolean;
  /** The server says the title is already requested. */
  alreadyRequested?: boolean;
}) {
  const { t } = useLanguage();
  const client = useApiClient();
  const [state, setState] = useState<"idle" | "busy" | "done">(alreadyRequested ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);

  async function request() {
    if (state !== "idle" || disabled) return;
    setState("busy");
    setError(null);
    try {
      await client.requestTitle(snapshot);
      setState("done");
    } catch (failure) {
      setError(describeApiError(failure));
      setState("idle");
    }
  }

  return (
    <>
      <button
        type="button"
        className={className ?? "tv-watchlist-primary"}
        disabled={state !== "idle" || disabled}
        data-navigation-focus-key={focusKey}
        onClick={() => void request()}
      >
        {state === "done" ? t("discovery.request.requested") : t("discovery.action.request")}
      </button>
      {error ? (
        <span className="tv-watchlist-error" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
