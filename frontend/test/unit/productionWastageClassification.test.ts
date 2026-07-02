import { describe, expect, it } from "vitest";

import {
  buildWastageClassificationMismatchMessage,
  buildWastageOverClassifiedMessage,
  buildWastageRemainingToClassifyMessage,
  computeWastageClassificationBalance,
  isWastageClassificationComplete,
  remainingWastageAfterRow,
  sumWastageDetailDraftQty,
  validateWastageClassification,
} from "../../src/lib/productionWastageClassification";

describe("productionWastageClassification", () => {
  it("requires detailed qty to match total wastage", () => {
    expect(
      validateWastageClassification(
        2.85,
        [
          { key: "a", wastageTypeId: 1, qty: "1.2", remarks: "" },
          { key: "b", wastageTypeId: 2, qty: "0.8", remarks: "" },
        ],
        "Kg",
      ),
    ).toContain("Classify remaining 0.85 Kg wastage before confirming.");
    expect(
      validateWastageClassification(
        2.85,
        [
          { key: "a", wastageTypeId: 1, qty: "1.2", remarks: "" },
          { key: "b", wastageTypeId: 2, qty: "0.8", remarks: "" },
          { key: "c", wastageTypeId: 3, qty: "0.85", remarks: "" },
        ],
        "Kg",
      ),
    ).toBeNull();
  });

  it("tracks live balance totals", () => {
    const balance = computeWastageClassificationBalance(1.185, [
      { key: "a", wastageTypeId: 1, qty: "0.185", remarks: "" },
    ]);
    expect(balance.classifiedQty).toBe(0.185);
    expect(balance.remainingQty).toBe(1);
    expect(balance.status).toBe("remaining");
    expect(buildWastageRemainingToClassifyMessage(balance.remainingQty, "Kg")).toBe(
      "Classify remaining 1 Kg wastage before confirming.",
    );
  });

  it("detects over-classified wastage", () => {
    const balance = computeWastageClassificationBalance(1, [
      { key: "a", wastageTypeId: 1, qty: "1.2", remarks: "" },
    ]);
    expect(balance.status).toBe("over");
    expect(buildWastageOverClassifiedMessage(balance.classifiedQty - balance.totalWastageQty, "Kg")).toContain(
      "exceeds total",
    );
  });

  it("marks classification complete only when remaining is zero", () => {
    const rows = [
      { key: "a", wastageTypeId: 1, qty: "0.185", remarks: "" },
      { key: "b", wastageTypeId: 2, qty: "1", remarks: "" },
    ];
    const balance = computeWastageClassificationBalance(1.185, rows);
    expect(balance.status).toBe("complete");
    expect(isWastageClassificationComplete(balance, rows)).toBe(true);
  });

  it("computes remaining after each row", () => {
    const rows = [
      { key: "a", wastageTypeId: 1, qty: "0.185", remarks: "" },
      { key: "b", wastageTypeId: 2, qty: "0.5", remarks: "" },
    ];
    expect(remainingWastageAfterRow(1.185, rows, 0)).toBe(1);
    expect(remainingWastageAfterRow(1.185, rows, 1)).toBe(0.5);
  });

  it("formats mismatch message with totals", () => {
    expect(buildWastageClassificationMismatchMessage(2.85, 2.3, "Kg")).toContain("Classify remaining 0.55 Kg");
    expect(sumWastageDetailDraftQty([{ key: "a", wastageTypeId: 1, qty: "1.2", remarks: "" }])).toBe(1.2);
  });
});
