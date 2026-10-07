import { Button } from "../ui";
import { TvEmptyState } from "../tv/TvEmptyState";

export type EmptyStateProps = {
  title: string;
  description?: string;
  graphic?: Parameters<typeof TvEmptyState>[0]["graphic"];
  variant?: "page" | "rail" | "track" | "compact";
};
export type ErrorStateProps = EmptyStateProps;

/** The one loading state: the orbit loader and a label, always inside the page body (the header stays up). */
export function LoadingState({ label, size = "page" }: { label: string; size?: "page" | "inline" }) {
  return (
    <div className={`loading-state is-${size}`} role="status" aria-label={label}>
      <div className="tv-orbit-loader" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <p>{label}</p>
    </div>
  );
}

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
