import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import {
  PLAY_METHOD_FILTER_OPTIONS,
  STOP_REASON_FILTER_OPTIONS,
  activeActivityFilterCount,
  fromLocalDateTimeValue,
  hasActivityFilterErrors,
  recentActivityRange,
  toLocalDateTimeValue,
  type ActivityFilterErrors,
  type ActivityFilters,
} from "../lib/activityFilters";
import {
  SearchableMultiSelect,
  type SearchableMultiSelectOption,
} from "./SearchableMultiSelect";

interface ScaledUnit {
  value: string;
  label: string;
  multiplier: number;
}

const DURATION_UNITS: ScaledUnit[] = [
  { value: "seconds", label: "seconds", multiplier: 1_000 },
  { value: "minutes", label: "minutes", multiplier: 60_000 },
  { value: "hours", label: "hours", multiplier: 3_600_000 },
];

const BYTE_UNITS: ScaledUnit[] = [
  { value: "MB", label: "MB", multiplier: 1024 ** 2 },
  { value: "GB", label: "GB", multiplier: 1024 ** 3 },
  { value: "TB", label: "TB", multiplier: 1024 ** 4 },
];

export interface ActivityFilterOptions {
  users: SearchableMultiSelectOption[];
  libraries: SearchableMultiSelectOption[];
  peerNodes: SearchableMultiSelectOption[];
}

function DateTimeRangeFilter({
  from,
  to,
  error,
  onChange,
}: {
  from: string | undefined;
  to: string | undefined;
  error?: string;
  onChange: (range: { from?: string; to?: string }) => void;
}) {
  function selectRecent(durationMs: number) {
    onChange(recentActivityRange(durationMs));
  }

  return (
    <fieldset
      className={`activity-range-filter${error ? " is-error" : ""}`}
      aria-describedby={error ? "activity-date-range-error" : undefined}
    >
      <legend>Date and time</legend>
      <div className="activity-date-presets" aria-label="Date range presets">
        <button type="button" onClick={() => selectRecent(60 * 60 * 1000)}>
          1 hour
        </button>
        <button type="button" onClick={() => selectRecent(24 * 60 * 60 * 1000)}>
          24 hours
        </button>
        <button
          type="button"
          onClick={() => selectRecent(7 * 24 * 60 * 60 * 1000)}
        >
          7 days
        </button>
        <button
          type="button"
          onClick={() => selectRecent(30 * 24 * 60 * 60 * 1000)}
        >
          30 days
        </button>
        <button type="button" onClick={() => onChange({})}>
          All time
        </button>
      </div>
      <div className="activity-range-inputs">
        <label>
          <span>From</span>
          <input
            id="activity-history-from"
            type="datetime-local"
            className="input"
            value={toLocalDateTimeValue(from)}
            aria-invalid={Boolean(error)}
            onChange={(event) =>
              onChange({
                from: fromLocalDateTimeValue(event.target.value),
                to,
              })
            }
          />
        </label>
        <label>
          <span>To</span>
          <input
            id="activity-history-to"
            type="datetime-local"
            className="input"
            value={toLocalDateTimeValue(to)}
            aria-invalid={Boolean(error)}
            onChange={(event) =>
              onChange({
                from,
                to: fromLocalDateTimeValue(event.target.value, "end"),
              })
            }
          />
        </label>
      </div>
      {error && (
        <p id="activity-date-range-error" className="error-text" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function formatScaledActivityValue(
  value: number | undefined,
  multiplier: number
): string {
  if (value === undefined) return "";
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    !Number.isSafeInteger(multiplier) ||
    multiplier <= 0
  ) {
    return "";
  }

  const divisor = BigInt(multiplier);
  const numerator = BigInt(value);
  const whole = numerator / divisor;
  let remainder = numerator % divisor;
  if (remainder === 0n) return String(whole);

  let commonDivisorLeft = numerator;
  let commonDivisorRight = divisor;
  while (commonDivisorRight !== 0n) {
    const next = commonDivisorLeft % commonDivisorRight;
    commonDivisorLeft = commonDivisorRight;
    commonDivisorRight = next;
  }
  let reducedDenominator = divisor / commonDivisorLeft;
  while (reducedDenominator % 2n === 0n) reducedDenominator /= 2n;
  while (reducedDenominator % 5n === 0n) reducedDenominator /= 5n;

  if (reducedDenominator === 1n) {
    let fraction = "";
    for (let digit = 0; remainder !== 0n && digit < 64; digit += 1) {
      remainder *= 10n;
      fraction += String(remainder / divisor);
      remainder %= divisor;
    }
    if (remainder === 0n) return `${whole}.${fraction}`;
  }

  return (value / multiplier)
    .toFixed(12)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

export function parseScaledActivityValue(
  raw: string,
  multiplier: number
): number | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  if (
    value.length > 64 ||
    !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ||
    !Number.isSafeInteger(multiplier) ||
    multiplier <= 0
  ) {
    return undefined;
  }

  const [mantissa = "", exponentText] = value.toLocaleLowerCase().split("e");
  const exponent = Number(exponentText ?? "0");
  if (!Number.isSafeInteger(exponent)) return undefined;
  const [whole = "0", fraction = ""] = mantissa.split(".");
  const digits = `${whole || "0"}${fraction}`.replace(/^0+(?=\d)/, "");
  let scaledNumerator = BigInt(digits) * BigInt(multiplier);
  if (scaledNumerator === 0n) return 0;
  const decimalPlaces = fraction.length - exponent;

  if (decimalPlaces < 0) {
    // Any non-zero value with this many added zeroes is already beyond the
    // exact integer range the URL and API contract can represent.
    if (
      -decimalPlaces >
        String(Number.MAX_SAFE_INTEGER).length
    ) {
      return undefined;
    }
    scaledNumerator *= 10n ** BigInt(-decimalPlaces);
  }

  if (decimalPlaces <= 0) {
    return scaledNumerator <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(scaledNumerator)
      : undefined;
  }

  // Avoid constructing an enormous power for notation such as `1e-999999`.
  // At this distance below one base unit the exact rounded result is zero.
  const maximumRelevantPlaces =
    digits.length + String(multiplier).length + 1;
  if (decimalPlaces > maximumRelevantPlaces) return 0;
  const denominator = 10n ** BigInt(decimalPlaces);
  const quotient = scaledNumerator / denominator;
  const remainder = scaledNumerator % denominator;
  // Base units are integral (milliseconds and bytes). Round non-integral
  // decimal input to the nearest base unit, with exact halves rounded up, so
  // a valid-looking value can never remain visible while being silently
  // ignored.
  const result =
    quotient + (remainder * 2n >= denominator ? 1n : 0n);
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : undefined;
}

export function normaliseScaledActivityValueOnBlur(
  raw: string,
  currentValue: number | undefined,
  multiplier: number
): string {
  if (!raw.trim()) return "";
  const parsed = parseScaledActivityValue(raw, multiplier);
  return formatScaledActivityValue(
    parsed === undefined ? currentValue : parsed,
    multiplier
  );
}

function NumericRangeFilter({
  id,
  label,
  min,
  max,
  units,
  initialUnit,
  baseUnitLabel,
  error,
  onValidityChange,
  onChange,
}: {
  id: string;
  label: string;
  min: number | undefined;
  max: number | undefined;
  units: ScaledUnit[];
  initialUnit: string;
  baseUnitLabel: string;
  error?: string;
  onValidityChange: (invalid: boolean) => void;
  onChange: (range: { min?: number; max?: number }) => void;
}) {
  const [unitValue, setUnitValue] = useState(initialUnit);
  const unit = units.find((candidate) => candidate.value === unitValue) ??
    units[0] ?? { value: "units", label: "units", multiplier: 1 };
  const [focusedInput, setFocusedInput] = useState<"min" | "max" | null>(null);
  const [rawMin, setRawMin] = useState(() =>
    formatScaledActivityValue(min, unit.multiplier)
  );
  const [rawMax, setRawMax] = useState(() =>
    formatScaledActivityValue(max, unit.multiplier)
  );

  useEffect(() => {
    if (focusedInput !== "min") {
      setRawMin(formatScaledActivityValue(min, unit.multiplier));
    }
    if (focusedInput !== "max") {
      setRawMax(formatScaledActivityValue(max, unit.multiplier));
    }
  }, [focusedInput, max, min, unit.multiplier]);

  const rawMinInvalid =
    Boolean(rawMin.trim()) &&
    parseScaledActivityValue(rawMin, unit.multiplier) === undefined;
  const rawMaxInvalid =
    Boolean(rawMax.trim()) &&
    parseScaledActivityValue(rawMax, unit.multiplier) === undefined;
  const rawInputInvalid = rawMinInvalid || rawMaxInvalid;

  useEffect(() => {
    onValidityChange(rawInputInvalid);
  }, [onValidityChange, rawInputInvalid]);

  function changeRawValue(
    field: "min" | "max",
    raw: string
  ) {
    if (field === "min") setRawMin(raw);
    else setRawMax(raw);

    if (!raw.trim()) {
      onChange({
        min: field === "min" ? undefined : min,
        max: field === "max" ? undefined : max,
      });
      return;
    }
    const parsed = parseScaledActivityValue(raw, unit.multiplier);
    if (parsed === undefined) return;
    onChange({
      min: field === "min" ? parsed : min,
      max: field === "max" ? parsed : max,
    });
  }

  function finishEditing(field: "min" | "max") {
    setFocusedInput(null);
    const raw = field === "min" ? rawMin : rawMax;
    const normalised = normaliseScaledActivityValueOnBlur(
      raw,
      field === "min" ? min : max,
      unit.multiplier
    );
    if (field === "min") setRawMin(normalised);
    else setRawMax(normalised);
  }

  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const describedBy = `${helpId}${error || rawInputInvalid ? ` ${errorId}` : ""}`;
  const maximumValue = formatScaledActivityValue(
    Number.MAX_SAFE_INTEGER,
    unit.multiplier
  );
  const inputError =
    error ??
    (rawInputInvalid
      ? `Enter a non-negative value no larger than ${maximumValue} ${unit.label}.`
      : undefined);
  return (
    <fieldset
      className={`activity-range-filter${inputError ? " is-error" : ""}`}
      aria-describedby={describedBy}
    >
      <legend>{label}</legend>
      <div className="activity-range-inputs activity-numeric-range-inputs">
        <label>
          <span>Minimum</span>
          <input
            id={`${id}-min`}
            type="number"
            className="input"
            min="0"
            max={maximumValue}
            step="any"
            inputMode="decimal"
            value={rawMin}
            aria-invalid={Boolean(error) || rawMinInvalid}
            aria-describedby={describedBy}
            placeholder="Any"
            onFocus={() => setFocusedInput("min")}
            onBlur={() => finishEditing("min")}
            onChange={(event) => changeRawValue("min", event.target.value)}
          />
        </label>
        <label>
          <span>Maximum</span>
          <input
            id={`${id}-max`}
            type="number"
            className="input"
            min="0"
            max={maximumValue}
            step="any"
            inputMode="decimal"
            value={rawMax}
            aria-invalid={Boolean(error) || rawMaxInvalid}
            aria-describedby={describedBy}
            placeholder="Any"
            onFocus={() => setFocusedInput("max")}
            onBlur={() => finishEditing("max")}
            onChange={(event) => changeRawValue("max", event.target.value)}
          />
        </label>
        <label className="activity-range-unit">
          <span>Unit</span>
          <select
            className="input"
            value={unit.value}
            onChange={(event) => setUnitValue(event.target.value)}
          >
            {units.map((candidate) => (
              <option key={candidate.value} value={candidate.value}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <small id={helpId} className="activity-range-help muted">
        Fractional values round to the nearest {baseUnitLabel}.
      </small>
      {inputError && (
        <p id={errorId} className="error-text" role="alert">
          {inputError}
        </p>
      )}
    </fieldset>
  );
}

export function ActivityFiltersPanel({
  filters,
  errors,
  options,
  loading,
  dirty,
  appliedFilterCount,
  onChange,
  onApply,
  onReset,
  loadTitleOptions,
}: {
  filters: ActivityFilters;
  errors: ActivityFilterErrors;
  options: ActivityFilterOptions;
  loading: boolean;
  dirty: boolean;
  appliedFilterCount: number;
  onChange: (filters: ActivityFilters) => void;
  onApply: () => void;
  onReset: () => void;
  loadTitleOptions: (
    query: string
  ) => Promise<SearchableMultiSelectOption[]>;
}) {
  const [invalidRawRanges, setInvalidRawRanges] = useState({
    duration: false,
    bytes: false,
  });
  const setDurationValidity = useCallback((invalid: boolean) => {
    setInvalidRawRanges((current) =>
      current.duration === invalid ? current : { ...current, duration: invalid }
    );
  }, []);
  const setBytesValidity = useCallback((invalid: boolean) => {
    setInvalidRawRanges((current) =>
      current.bytes === invalid ? current : { ...current, bytes: invalid }
    );
  }, []);
  const draftFilterCount = activeActivityFilterCount(filters);
  const invalid =
    hasActivityFilterErrors(errors) ||
    invalidRawRanges.duration ||
    invalidRawRanges.bytes;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (invalid) return;
    onApply();
  }

  return (
    <form className="activity-filter-panel card" onSubmit={submit}>
      <div className="activity-filter-heading">
        <div>
          <h2>Activity filters</h2>
          <p className="muted">
            Choose several values within a filter to match any of them.
          </p>
        </div>
        <span className="badge badge-neutral badge-pill">
          {appliedFilterCount} applied
        </span>
      </div>

      <div className="activity-filter-grid">
        <SearchableMultiSelect
          id="activity-history-users"
          label="Users"
          options={options.users}
          values={filters.userIds}
          placeholder="Any user"
          searchPlaceholder="Search users..."
          onChange={(userIds) => onChange({ ...filters, userIds })}
        />
        <SearchableMultiSelect
          id="activity-history-methods"
          label="Methods"
          options={[...PLAY_METHOD_FILTER_OPTIONS]}
          values={filters.playMethods}
          placeholder="Any method"
          searchPlaceholder="Search methods..."
          onChange={(values) =>
            onChange({
              ...filters,
              playMethods: values as ActivityFilters["playMethods"],
            })
          }
        />
        <SearchableMultiSelect
          id="activity-history-titles"
          label="Titles"
          options={filters.titleTerms.map((value) => ({
            value,
            label: value,
          }))}
          values={filters.titleTerms}
          placeholder="Any title"
          searchPlaceholder="Search or enter a title..."
          allowCustomValue
          loadOptions={loadTitleOptions}
          onChange={(titleTerms) => onChange({ ...filters, titleTerms })}
        />
        <SearchableMultiSelect
          id="activity-history-libraries"
          label="Libraries"
          options={options.libraries}
          values={filters.libraryIds}
          placeholder="Any library"
          searchPlaceholder="Search libraries..."
          onChange={(libraryIds) => onChange({ ...filters, libraryIds })}
        />
        <SearchableMultiSelect
          id="activity-history-peer-nodes"
          label="Connected server"
          options={options.peerNodes}
          values={filters.peerNodeIds}
          placeholder="Any server"
          searchPlaceholder="Search servers..."
          onChange={(peerNodeIds) => onChange({ ...filters, peerNodeIds })}
        />
        <SearchableMultiSelect
          id="activity-history-stop-reasons"
          label="Stop reasons"
          options={[...STOP_REASON_FILTER_OPTIONS]}
          values={filters.stopReasons}
          placeholder="Any stop reason"
          searchPlaceholder="Search stop reasons..."
          onChange={(values) =>
            onChange({
              ...filters,
              stopReasons: values as ActivityFilters["stopReasons"],
            })
          }
        />
      </div>

      <div className="activity-filter-ranges">
        <DateTimeRangeFilter
          from={filters.from}
          to={filters.to}
          error={errors.dateRange}
          onChange={(range) => onChange({ ...filters, ...range })}
        />
        <NumericRangeFilter
          id="activity-history-duration"
          label="Session length"
          min={filters.minDurationMs}
          max={filters.maxDurationMs}
          units={DURATION_UNITS}
          initialUnit="minutes"
          baseUnitLabel="millisecond"
          error={errors.durationRange}
          onValidityChange={setDurationValidity}
          onChange={(range) => {
            onChange({
              ...filters,
              minDurationMs: range.min,
              maxDurationMs: range.max,
            });
          }}
        />
        <NumericRangeFilter
          id="activity-history-bytes"
          label="Bytes streamed"
          min={filters.minBytesStreamed}
          max={filters.maxBytesStreamed}
          units={BYTE_UNITS}
          initialUnit="GB"
          baseUnitLabel="byte"
          error={errors.bytesRange}
          onValidityChange={setBytesValidity}
          onChange={(range) =>
            onChange({
              ...filters,
              minBytesStreamed: range.min,
              maxBytesStreamed: range.max,
            })
          }
        />
      </div>

      <div className="activity-filter-actions">
        {dirty && (
          <span className="activity-filter-dirty" role="status">
            Filters have unapplied changes.
          </span>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          disabled={
            appliedFilterCount === 0 && draftFilterCount === 0 && !dirty
          }
          onClick={onReset}
        >
          Reset all
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading || invalid}
        >
          {loading ? "Applying..." : "Apply filters"}
        </button>
      </div>
    </form>
  );
}
