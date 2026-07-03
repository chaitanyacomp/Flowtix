import { describe, expect, it } from "vitest";

import { parsePositiveIntParam } from "../../src/lib/rmReturnsPageLoad";
import { isPendingDrivenRmReturnPage } from "../../src/lib/rmReturnPendingUx";

describe("rmReturnsPageLoad", () => {
  it("parsePositiveIntParam accepts positive integers", () => {
    expect(parsePositiveIntParam("42")).toBe(42);
    expect(parsePositiveIntParam("  7 ")).toBe(7);
  });

  it("parsePositiveIntParam rejects empty, invalid, zero, negative, and decimal values", () => {
    expect(parsePositiveIntParam(null)).toBeNull();
    expect(parsePositiveIntParam("")).toBeNull();
    expect(parsePositiveIntParam("   ")).toBeNull();
    expect(parsePositiveIntParam("abc")).toBeNull();
    expect(parsePositiveIntParam("0")).toBeNull();
    expect(parsePositiveIntParam("-3")).toBeNull();
    expect(parsePositiveIntParam("3.5")).toBeNull();
  });

  it("pending-actions route without workOrderId is pending-driven list mode", () => {
    expect(isPendingDrivenRmReturnPage({ from: "pending-actions", pendingId: null })).toBe(true);
  });
});
