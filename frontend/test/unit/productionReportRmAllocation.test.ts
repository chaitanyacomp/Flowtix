import { describe, expect, it } from "vitest";

import {
  computeRmLineRequiredAllocation,
  computeRmLineWastageAllocation,
  fmtRmQty,
} from "../../src/lib/productionReportRmAllocation";
import {
  computeWastageClassificationBalance,
  fmtWastageQty,
  isWastageClassificationComplete,
} from "../../src/lib/productionWastageClassification";

describe("productionReportRmAllocation", () => {
  it("keeps authoritative 3-decimal Kg precision (UAT 82 / 81.23 / 0.77)", () => {
    const required = computeRmLineRequiredAllocation({
      issuedQty: 82,
      consumedQty: 81.23,
      returnedQty: 0,
    });
    expect(required).toBe(0.77);
    expect(fmtRmQty(required)).toBe("0.77");
    expect(fmtWastageQty(required, "Kg")).toBe("0.77");

    const alloc = computeRmLineWastageAllocation({
      issuedQty: 82,
      consumedQty: 81.23,
      returnedQty: 0,
      runnerWasteQty: 0,
    });
    expect(alloc.manualWasteQty).toBe(0.77);
    expect(alloc.unexplainedBalance).toBe(0);

    const balance = computeWastageClassificationBalance(alloc.manualWasteQty, [
      { key: "a", wastageTypeId: 1, qty: "0.77", remarks: "Purging" },
    ]);
    expect(balance.totalWastageQty).toBe(0.77);
    expect(balance.classifiedQty).toBe(0.77);
    expect(balance.remainingQty).toBe(0);
    expect(balance.status).toBe("complete");
    expect(isWastageClassificationComplete(balance, [
      { key: "a", wastageTypeId: 1, qty: "0.77", remarks: "Purging" },
    ])).toBe(true);
  });

  it("does not round Kg wastage display to whole numbers when unit is omitted", () => {
    expect(fmtWastageQty(0.77)).toBe("0.77");
    expect(fmtWastageQty(0.77, "")).toBe("0.77");
  });

  it("subtracts runner from default manual wastage", () => {
    const alloc = computeRmLineWastageAllocation({
      issuedQty: 10,
      consumedQty: 8,
      returnedQty: 0,
      runnerWasteQty: 0.5,
    });
    expect(alloc.requiredAllocation).toBe(2);
    expect(alloc.manualWasteQty).toBe(1.5);
    expect(alloc.unexplainedBalance).toBe(0);
  });

  it("recomputes unexplained when manual wastage is under-allocated", () => {
    const alloc = computeRmLineWastageAllocation({
      issuedQty: 82,
      consumedQty: 81.23,
      returnedQty: 0,
      runnerWasteQty: 0,
      manualWasteQty: 0.5,
    });
    expect(alloc.unexplainedBalance).toBe(0.27);
  });
});
