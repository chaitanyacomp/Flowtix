import { describe, expect, it } from "vitest";
import {
  isAlreadyProcessedPendingReturnError,
  isPendingDrivenRmReturnPage,
} from "../../src/lib/rmReturnPendingUx";

describe("rmReturnPendingUx", () => {
  it("detects pending-driven page from pending-actions", () => {
    expect(isPendingDrivenRmReturnPage({ from: "pending-actions" })).toBe(true);
  });

  it("detects pending-driven page from pendingId", () => {
    expect(isPendingDrivenRmReturnPage({ pendingId: 42 })).toBe(true);
  });

  it("manual RM return page when no pending context", () => {
    expect(isPendingDrivenRmReturnPage({ from: "dashboard", pendingId: null })).toBe(false);
  });

  it("recognizes already-processed receive errors", () => {
    expect(isAlreadyProcessedPendingReturnError(new Error("RM Return Pending row is already processed."))).toBe(
      true,
    );
    expect(isAlreadyProcessedPendingReturnError({ status: 409, message: "Conflict" })).toBe(true);
    expect(isAlreadyProcessedPendingReturnError(new Error("Network error"))).toBe(false);
  });
});
