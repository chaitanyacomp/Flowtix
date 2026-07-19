import { describe, expect, it } from "vitest";

import {
  buildWastageClassificationMismatchMessage,
  buildWastageOverClassifiedMessage,
  buildWastageRemainingToClassifyMessage,
  computeWastageClassificationBalance,
  isWastageClassificationComplete,
  productionReportLeaveWarningMessage,
  remainingWastageAfterRow,
  shouldBlockLeaveProductionReport,
  sumWastageDetailDraftQty,
  suggestNextWastageTypeId,
  suggestWastageQtyForTypeSelection,
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

  it("suggests remaining wastage qty when operator selects a type", () => {
    const rows = [{ key: "a", wastageTypeId: 0, qty: "", remarks: "" }];
    expect(
      suggestWastageQtyForTypeSelection(0.315, rows, "a", "", "Kg"),
    ).toBe("0.315");
  });

  it("does not overwrite manual wastage qty on type selection", () => {
    const rows = [{ key: "a", wastageTypeId: 1, qty: "0.1", remarks: "" }];
    expect(suggestWastageQtyForTypeSelection(0.315, rows, "a", "0.1", "Kg")).toBeNull();
  });

  it("fills only unclassified balance across multiple wastage rows", () => {
    const rows = [
      { key: "a", wastageTypeId: 1, qty: "0.185", remarks: "" },
      { key: "b", wastageTypeId: 0, qty: "", remarks: "" },
    ];
    expect(suggestWastageQtyForTypeSelection(0.315, rows, "b", "", "Kg")).toBe("0.13");
  });

  it("auto-fills remaining qty for the next row when total wastage is partially classified", () => {
    const rows = [{ key: "a", wastageTypeId: 1, qty: "4", remarks: "" }];
    expect(suggestWastageQtyForTypeSelection(6, rows, "b", "", "Kg")).toBe("2");
  });

  it("defaults next wastage row to the next unused type instead of repeating Purging", () => {
    const types = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(suggestNextWastageTypeId(types, [])).toBe(1);
    expect(suggestNextWastageTypeId(types, [{ key: "a", wastageTypeId: 1, qty: "2", remarks: "" }])).toBe(2);
    expect(
      suggestNextWastageTypeId(types, [
        { key: "a", wastageTypeId: 1, qty: "2", remarks: "" },
        { key: "b", wastageTypeId: 2, qty: "1", remarks: "" },
      ]),
    ).toBe(3);
    expect(
      suggestNextWastageTypeId(types, [
        { key: "a", wastageTypeId: 1, qty: "1", remarks: "" },
        { key: "b", wastageTypeId: 2, qty: "1", remarks: "" },
        { key: "c", wastageTypeId: 3, qty: "1", remarks: "" },
      ]),
    ).toBe(0);
  });

  it("formats mismatch message with totals", () => {
    expect(buildWastageClassificationMismatchMessage(2.85, 2.3, "Kg")).toContain("Classify remaining 0.55 Kg");
    expect(sumWastageDetailDraftQty([{ key: "a", wastageTypeId: 1, qty: "1.2", remarks: "" }])).toBe(1.2);
  });

  it("blocks leave when wastage classification is incomplete even if draft is not locally dirty", () => {
    const incompleteRows = [{ key: "a", wastageTypeId: 1, qty: "1", remarks: "" }];
    expect(
      shouldBlockLeaveProductionReport({
        confirmed: false,
        localDirty: false,
        totalWastageQty: 2.85,
        wastageRows: incompleteRows,
      }),
    ).toBe(true);
    expect(
      shouldBlockLeaveProductionReport({
        confirmed: false,
        localDirty: true,
        totalWastageQty: 0,
        wastageRows: [],
      }),
    ).toBe(true);
    expect(
      shouldBlockLeaveProductionReport({
        confirmed: false,
        localDirty: false,
        totalWastageQty: 2,
        wastageRows: [
          { key: "a", wastageTypeId: 1, qty: "1", remarks: "" },
          { key: "b", wastageTypeId: 2, qty: "1", remarks: "" },
        ],
      }),
    ).toBe(false);
    expect(
      shouldBlockLeaveProductionReport({
        confirmed: true,
        localDirty: true,
        totalWastageQty: 2.85,
        wastageRows: incompleteRows,
      }),
    ).toBe(false);
    expect(
      productionReportLeaveWarningMessage({
        localDirty: false,
        totalWastageQty: 2.85,
        wastageRows: incompleteRows,
      }),
    ).toMatch(/WO will not be closed/i);
  });
});
