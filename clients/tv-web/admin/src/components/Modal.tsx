import { useEffect } from "react";
import { createPortal } from "react-dom";

/** Close ("x") icon for a modal's header -- purely decorative. */
function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Pre-arranged footer content -- typically a `.modal-footer-left` (e.g. a
   * lone Delete button, or nothing) followed by a `.modal-footer-right`
   * cluster (Cancel/Test/Save-style buttons, rightmost = most prominent),
   * per DESIGN.md Sec 4.3's "far-left Delete, rightmost Save" pattern.
   */
  footer?: React.ReactNode;
}

/**
 * Centered overlay panel -- there is no modal/dialog library anywhere in
 * this monorepo (checked package.json + grepped for "Modal"/"Dialog"
 * across clients/tv-web before writing this), so this is a small,
 * dependency-free implementation built directly on `.modal-overlay`/
 * `.modal`/`.modal-header`/`.modal-body`/`.modal-footer` (global.css).
 * Rendered via a portal into `document.body` so it always sits above
 * `.app-shell`'s own stacking/overflow context regardless of which page
 * mounts it.
 */
export function Modal({ title, onClose, children, footer }: ModalProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        // Only a direct click on the scrim itself closes the modal -- a
        // click that starts inside the panel and drags out (e.g. text
        // selection) must not.
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
