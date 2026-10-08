import { describe, expect, it } from "vitest";
import { periodPickerMove } from "./periodPickerNav";

describe("periodPickerMove", () => {
  const lengths = [12, 9];

  it("moves within a list and holds at both ends", () => {
    expect(periodPickerMove("ArrowDown", 0, 3, lengths)).toEqual({ list: 0, index: 4 });
    expect(periodPickerMove("ArrowUp", 0, 3, lengths)).toEqual({ list: 0, index: 2 });
    expect(periodPickerMove("ArrowDown", 0, 11, lengths)).toEqual({ list: 0, index: 11 });
    expect(periodPickerMove("ArrowUp", 1, 0, lengths)).toEqual({ list: 1, index: 0 });
  });

  it("switches between the month and year lists, clamping the index", () => {
    expect(periodPickerMove("ArrowRight", 0, 3, lengths)).toEqual({ list: 1, index: 3 });
    expect(periodPickerMove("ArrowRight", 0, 11, lengths)).toEqual({ list: 1, index: 8 });
    expect(periodPickerMove("ArrowLeft", 1, 4, lengths)).toEqual({ list: 0, index: 4 });
  });

  it("holds when there is no list in that direction", () => {
    expect(periodPickerMove("ArrowLeft", 0, 3, lengths)).toEqual({ list: 0, index: 3 });
    expect(periodPickerMove("ArrowRight", 1, 3, lengths)).toEqual({ list: 1, index: 3 });
  });

  it("ignores other keys", () => {
    expect(periodPickerMove("Enter", 0, 3, lengths)).toBeNull();
  });
});
