import { describe, expect, it } from "vitest";
import { DETAILS_STORE_MAX, DETAILS_STORE_TRIM_TO, IndexedDbDetailsStore, planTrim } from "./detailsStore";

describe("planTrim (versioned LRU)", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ k: `k${i}`, used: i }));

  it("leaves a store within the cap alone", () => {
    expect(planTrim(rows(DETAILS_STORE_MAX), DETAILS_STORE_MAX, DETAILS_STORE_TRIM_TO)).toEqual([]);
  });

  it("drops the least recently used rows down to the trim target", () => {
    const drop = planTrim(rows(DETAILS_STORE_MAX + 1), DETAILS_STORE_MAX, DETAILS_STORE_TRIM_TO);
    expect(drop).toHaveLength(DETAILS_STORE_MAX + 1 - DETAILS_STORE_TRIM_TO);
    expect(drop[0]).toBe("k0");
    expect(drop).not.toContain(`k${DETAILS_STORE_MAX}`);
  });

  it("follows use order, not insertion order", () => {
    const list = [
      { k: "old-but-used", used: 100 },
      { k: "new-unused", used: 1 },
      { k: "middle", used: 50 },
    ];
    expect(planTrim(list, 2, 2)).toEqual(["new-unused"]);
  });
});

describe("IndexedDbDetailsStore without IndexedDB", () => {
  it("resolves to nothing stored and never throws", async () => {
    const store = new IndexedDbDetailsStore();
    await expect(store.get("s", "a")).resolves.toBeUndefined();
    await expect(store.put("s", "a", {} as never, ["catalog"], 1)).resolves.toBeUndefined();
    await expect(store.invalidate("s", undefined)).resolves.toBeUndefined();
    await expect(store.purgeExcept(undefined)).resolves.toBeUndefined();
  });
});
