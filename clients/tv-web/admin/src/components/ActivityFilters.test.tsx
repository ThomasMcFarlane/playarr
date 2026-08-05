import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ActivityFiltersPanel,
  formatScaledActivityValue,
  normaliseScaledActivityValueOnBlur,
  parseScaledActivityValue,
} from "./ActivityFilters";
import { emptyActivityFilters } from "../lib/activityFilters";

describe("scaled Activity values", () => {
  it("round-trips exact base-unit values without display rounding", () => {
    const value = 123_456_789;
    const multiplier = 1024 ** 3;
    const displayed = formatScaledActivityValue(value, multiplier);

    expect(displayed).toBe("0.114978094585239887237548828125");
    expect(parseScaledActivityValue(displayed, multiplier)).toBe(value);
  });

  it("rounds editable decimal forms to the nearest base unit", () => {
    expect(parseScaledActivityValue("0.", 1000)).toBe(0);
    expect(parseScaledActivityValue(".5", 1000)).toBe(500);
    expect(parseScaledActivityValue("1e3", 1000)).toBe(1_000_000);
    expect(parseScaledActivityValue("1.5e-3", 1000)).toBe(2);
    expect(parseScaledActivityValue("1e-999999", 1000)).toBe(0);
    expect(parseScaledActivityValue("0.1", 1024 ** 2)).toBe(104_858);
    expect(parseScaledActivityValue("0.0000004", 1024 ** 2)).toBe(0);
    expect(parseScaledActivityValue("0.0000005", 1024 ** 2)).toBe(1);
    expect(
      parseScaledActivityValue(String(Number.MAX_SAFE_INTEGER), 1000)
    ).toBeUndefined();
    expect(parseScaledActivityValue("-1", 1000)).toBeUndefined();
  });

  it("bounds repeating minute fractions and restores their exact base value on blur", () => {
    const oneMillisecond = formatScaledActivityValue(1, 60_000);
    const oneSecond = formatScaledActivityValue(1_000, 60_000);

    expect(oneMillisecond).toBe("0.000016666667");
    expect(oneSecond).toBe("0.016666666667");
    expect(oneMillisecond).not.toMatch(/e|infinity|nan/i);
    expect(oneSecond).not.toMatch(/e|infinity|nan/i);
    expect(parseScaledActivityValue(oneMillisecond, 60_000)).toBe(1);
    expect(parseScaledActivityValue(oneSecond, 60_000)).toBe(1_000);
    expect(
      normaliseScaledActivityValueOnBlur(oneMillisecond, 1, 60_000)
    ).toBe(oneMillisecond);
    expect(
      normaliseScaledActivityValueOnBlur(oneSecond, 1_000, 60_000)
    ).toBe(oneSecond);
  });
});

describe("ActivityFiltersPanel", () => {
  it("describes the shared filters and reports the applied count", () => {
    const markup = renderToStaticMarkup(
      <ActivityFiltersPanel
        filters={{
          ...emptyActivityFilters(),
          playMethods: ["transcode"],
        }}
        errors={{}}
        options={{ users: [], libraries: [], peerNodes: [] }}
        loading={false}
        dirty
        appliedFilterCount={0}
        onChange={() => undefined}
        onApply={() => undefined}
        onReset={() => undefined}
        loadTitleOptions={async () => []}
      />
    );

    expect(markup).toContain("Activity filters");
    expect(markup).toContain("0 applied");
    expect(markup).toContain("Connected server");
    expect(markup).toContain(
      "Fractional values round to the nearest millisecond."
    );
    expect(markup).toContain("Fractional values round to the nearest byte.");
    expect(markup).toContain('aria-describedby="activity-history-duration-help"');
    expect(markup).toContain('max="150119987579.016510009766"');
    expect(markup).toContain("Filters have unapplied changes.");
  });
});
