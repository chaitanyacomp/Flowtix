import { describe, expect, it } from "vitest";
import {
  isAllowedDecimalEdit,
  normalizeDecimalOnBlur,
  parseNonNegativeDecimal,
  sanitizeDecimalInput,
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

  it("normalizes safely on blur", () => {
    expect(normalizeDecimalOnBlur("")).toBe("0");
    expect(normalizeDecimalOnBlur(".")).toBe("0");
    expect(normalizeDecimalOnBlur(".5")).toBe("0.5");
    expect(normalizeDecimalOnBlur("2.5000")).toBe("2.5");
  });
});
