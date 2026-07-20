/** Small rotating chevron marking a `.sidebar-section-toggle`'s open/closed state. */
export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        marginLeft: "auto",
        transform: open ? "rotate(90deg)" : "none",
        transition: "transform 0.15s ease",
      }}
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}
