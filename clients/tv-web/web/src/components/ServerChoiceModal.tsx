import { isBackKey } from "../lib/backKey";
import { useEffect, useRef, useState } from "react";
import type { JoinedWorkSource } from "../lib/joinedServers";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import { Button } from "./ui";

export function ServerChoiceModal({
  sources,
  title,
  onCancel,
  onSelect,
}: {
  sources: JoinedWorkSource[];
  title: string;
  onCancel: () => void;
  onSelect: (source: JoinedWorkSource) => Promise<void> | void;
}) {
  const { t } = useLanguage();
  const firstButtonRef = useRef<HTMLButtonElement>(null);
  const [selectingUrl, setSelectingUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (source: JoinedWorkSource) => {
    if (selectingUrl) return;
    setSelectingUrl(source.url);
    setError(null);
    try {
      await onSelect(source);
    } catch (selectionError) {
      setError(
        selectionError instanceof Error ? selectionError.message : String(selectionError)
      );
      setSelectingUrl(null);
    }
  };

  useEffect(() => {
    firstButtonRef.current?.focus({ preventScroll: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isBackKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onCancel]);

  return (
    <div className="server-choice-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="server-choice-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="server-choice-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="page-kicker">
          {t("components.serverChoiceModal.availableOnServers", { count: sources.length })}
        </p>
        <h2 id="server-choice-title">
          {t("components.serverChoiceModal.wherePlay", { title })}
        </h2>
        <p className="muted">{t("components.serverChoiceModal.chooseServer")}</p>
        <div className="server-choice-options">
          {sources.map((source, index) => (
            <button
              ref={index === 0 ? firstButtonRef : undefined}
              key={`${source.url}:${source.work.id}`}
              type="button"
              className="server-choice-option"
              disabled={selectingUrl !== null}
              onClick={() => void handleSelect(source)}
            >
              <strong>{source.label}</strong>
              <span>
                {selectingUrl === source.url
                  ? t("components.serverChoiceModal.connecting")
                  : source.url}
              </span>
            </button>
          ))}
        </div>
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="button" onClick={onCancel}>
          {t("components.serverChoiceModal.cancel")}
        </Button>
      </section>
    </div>
  );
}
