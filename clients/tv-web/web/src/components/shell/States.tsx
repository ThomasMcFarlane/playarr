import { Button } from "../ui";
import { TvEmptyState } from "../tv/TvEmptyState";

export type EmptyStateProps = {
  title: string;
  description?: string;
  graphic?: Parameters<typeof TvEmptyState>[0]["graphic"];
  variant?: "page" | "rail" | "track" | "compact";
};
export type ErrorStateProps = EmptyStateProps;

/** A valid, empty collection. */
export function EmptyState(props: EmptyStateProps) {
  return <TvEmptyState variant="page" {...props} tone="empty" />;
}

/** A failure: `--danger`, announced as an alert, with an optional Retry. */
export function ErrorState({
  onRetry,
  retryLabel,
  ...props
}: ErrorStateProps & ({ onRetry?: undefined; retryLabel?: undefined } | { onRetry: () => void; retryLabel: string })) {
  return (
    <div className="error-state">
      <TvEmptyState variant="page" {...props} tone="error" />
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry} data-tv-focus-default>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
