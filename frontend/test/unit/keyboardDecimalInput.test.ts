import { describe, expect, it } from "vitest";
import {
  isAllowedDecimalEdit,
  normalizeDecimalOnBlur,
  parseNonNegativeDecimal,
  sanitizeDecimalInput,
  blockDecimalSpinnerKeys,
  blockDecimalWheel,
} from "../../src/lib/keyboardDecimalInput";

describe("keyboardDecimalInput", () => {
  it("allows blank, trailing-dot and leading-dot intermediate states", () => {
    expect(isAllowedDecimalEdit("")).toBe(true);
    expect(isAllowedDecimalEdit("0")).toBe(true);
    expect(isAllowedDecimalEdit("2.")).toBe(true);
    expect(isAllowedDecimalEdit(".5")).toBe(true);
    expect(sanitizeDecimalInput(".5")).toBe(".5");
  });

  it("rejects letters, negatives and invalid formats", () => {
    expect(sanitizeDecimalInput("12a")).toBeNull();
    expect(sanitizeDecimalInput("-1")).toBeNull();
    expect(sanitizeDecimalInput("1.2.3")).toBeNull();
    expect(parseNonNegativeDecimal("-3")).toBeNull();
  });

  it("supports decimal keyboard entry for quantities and rates", () => {
    expect(sanitizeDecimalInput("12.75")).toBe("12.75");
    expect(sanitizeDecimalInput("0.001")).toBe("0.001");
    expect(parseNonNegativeDecimal("12.75")).toBe(12.75);
    expect(parseNonNegativeDecimal("0")).toBe(0);
  });

  it("normalizes safely on blur", () => {
    expect(normalizeDecimalOnBlur("")).toBe("0");
    expect(normalizeDecimalOnBlur(".")).toBe("0");
    expect(normalizeDecimalOnBlur(".5")).toBe("0.5");
    expect(normalizeDecimalOnBlur("2.5000")).toBe("2.5");
  });

  it("blocks ArrowUp/ArrowDown so values cannot spin", () => {
    let prevented = 0;
    const preventDefault = () => {
      prevented += 1;
    };
    blockDecimalSpinnerKeys({ key: "ArrowUp", preventDefault });
    blockDecimalSpinnerKeys({ key: "ArrowDown", preventDefault });
    blockDecimalSpinnerKeys({ key: "a", preventDefault });
    expect(prevented).toBe(2);
  });

  it("blocks wheel events so values cannot spin", () => {
    let prevented = false;
    blockDecimalWheel({
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
  });
});
