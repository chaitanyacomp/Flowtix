import { describe, expect, it } from "vitest";
import { formatInr } from "../../src/lib/formatInr";

describe("formatInr", () => {
  it("renders INR values with ₹, never ? or replacement characters", () => {
    expect(formatInr(8.25)).toBe("₹8.25");
    expect(formatInr(6.75)).toBe("₹6.75");
    expect(formatInr(4.85)).toBe("₹4.85");
    for (const sample of [8.25, 6.75, 4.85, 0, 1000.5]) {
      const s = formatInr(sample);
      expect(s).toContain("₹");
      expect(s).not.toContain("?");
      expect(s).not.toContain("\uFFFD");
    }
  });
});
