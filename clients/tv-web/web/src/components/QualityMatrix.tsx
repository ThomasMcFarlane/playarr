import { Fragment } from "react";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import {
  QUALITY_LEVELS,
  QUALITY_TIERS,
  type QualityLevel,
  type QualityTierId,
} from "../lib/qualityMatrix";

export interface QualityMatrixStandaloneChoice {
  id: string;
  label: string;
  detail: string;
}

const QUALITY_LEVEL_KEYS = {
  low: "quality.level.low",
  medium: "quality.level.medium",
  high: "quality.level.high",
} as const;

const QUALITY_TIER_KEYS = {
  sd: "quality.tier.sd",
  hd: "quality.tier.hd",
  fhd: "quality.tier.fhd",
  uhd: "quality.tier.uhd",
} as const;

function levelLabel(level: QualityLevel, t: ReturnType<typeof useLanguage>["t"]) {
  return t(QUALITY_LEVEL_KEYS[level]);
}

function tierLabel(tier: QualityTierId, t: ReturnType<typeof useLanguage>["t"]) {
  return t(QUALITY_TIER_KEYS[tier]);
}

export function QualityMatrix({
  availableIds,
  buttonRef,
  disabled = false,
  onSelect,
  role,
  selectedId,
  standaloneChoices,
  variant,
}: {
  availableIds?: ReadonlySet<string>;
  buttonRef?: (id: string, element: HTMLButtonElement | null) => void;
  disabled?: boolean;
  onSelect: (id: string) => void;
  role: "radio" | "menuitemradio";
  selectedId: string;
  standaloneChoices: readonly QualityMatrixStandaloneChoice[];
  variant: "player" | "settings";
}) {
  const { t } = useLanguage();

  function choiceButton({
    id,
    label,
    detail,
    row,
    column,
  }: QualityMatrixStandaloneChoice & { row: number; column: number }) {
    const selected = id === selectedId;
    return (
      <button
        key={id}
        ref={(element) => buttonRef?.(id, element)}
        type="button"
        role={role}
        aria-checked={selected}
        className={`quality-matrix-choice${selected ? " is-selected" : ""}`}
        data-quality-id={id}
        data-quality-row={row}
        data-quality-column={column}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(id);
        }}
      >
        <span>
          <strong>{label}</strong>
          <small>{detail}</small>
        </span>
        <span className="quality-matrix-check" aria-hidden="true">
          {selected ? "✓" : ""}
        </span>
      </button>
    );
  }

  return (
    <div className={`quality-matrix is-${variant}`}>
      <div className="quality-matrix-standalone">
        {standaloneChoices.map((choice, index) =>
          choiceButton({
            ...choice,
            row: index - standaloneChoices.length,
            column: 1,
          })
        )}
      </div>

      <div className="quality-matrix-grid">
        <span className="quality-matrix-corner" aria-hidden="true" />
        {QUALITY_LEVELS.map((level) => (
          <strong key={level} className="quality-matrix-column-heading">
            {levelLabel(level, t)}
          </strong>
        ))}

        {QUALITY_TIERS.map((tier, row) => (
          <Fragment key={tier.id}>
            <span className="quality-matrix-row-heading">
              <strong>{tierLabel(tier.id, t)}</strong>
              <small>{tier.resolution}</small>
            </span>
            {tier.options.map((option, column) => {
              if (availableIds && !availableIds.has(option.id)) {
                return (
                  <span
                    key={option.id}
                    className="quality-matrix-unavailable"
                    title={t("quality.unavailable")}
                    aria-hidden="true"
                  >
                    —
                  </span>
                );
              }
              return choiceButton({
                id: option.id,
                label: `${option.bitrateMbps} Mbps`,
                detail: levelLabel(option.level, t),
                row,
                column,
              });
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
