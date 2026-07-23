import { describe, expect, it } from "vitest";
import {
  flattenOrderablePurchaseRequestLines,
  formatPurchaseRequestPoError,
  purchaseRequestPoExcessToStock,
  buildRmPoCreatePayloadLines,
  previewConsolidatedRmPoLines,
  requirementSourceBadgeLabel,
} from "../../src/lib/purchaseRequestPoSync";

const baseLine = {
  purchaseRequestId: 1,
  unit: "KG",
  requiredQty: 100,
  availableQty: 0,
  netRequiredQty: 100,
  orderedQty: 0,
  pendingQty: 100,
  excessOrderedQty: 0,
  canOrder: true,
};

describe("flattenOrderablePurchaseRequestLines", () => {
  it("only includes lines with canOrder true", () => {
    const rows = flattenOrderablePurchaseRequestLines([
      {
        id: 1,
        docNo: "PR-26-0001",
        status: "PARTIALLY_ORDERED",
        statusLabel: "Partially ordered",
        remarks: null,
        lines: [
          {
            id: 10,
            purchaseRequestId: 1,
            rmItemId: 1,
            itemName: "RM A",
            unit: "KG",
            requiredQty: 100,
            availableQty: 0,
            netRequiredQty: 100,
            orderedQty: 100,
            pendingQty: 0,
            excessOrderedQty: 0,
            canOrder: false,
            orderBlockReason: "PO already created for this line",
          },
          {
            id: 11,
            purchaseRequestId: 1,
            rmItemId: 2,
            itemName: "RM B",
            unit: "KG",
            requiredQty: 50,
            availableQty: 0,
            netRequiredQty: 50,
            orderedQty: 0,
            pendingQty: 50,
            excessOrderedQty: 0,
            canOrder: true,
            demandPool: "MPRS",
          },
        ],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(11);
  });

  it("uses API demandPool for source badge (not remarks only)", () => {
    const rows = flattenOrderablePurchaseRequestLines([
      {
        id: 2,
        docNo: "PR-26-0002",
        status: "PENDING_PURCHASE",
        statusLabel: "Pending purchase",
        remarks: null,
        lines: [
          {
            ...baseLine,
            id: 20,
            rmItemId: 70,
            itemName: "HDPE",
            demandPool: "STOCK_REPLENISHMENT",
            demandPoolLabel: "Stock Replenishment",
            referenceLabel: "Stock Replenishment",
          },
        ],
      },
    ]);
    expect(requirementSourceBadgeLabel(rows[0]!)).toBe("Replenishment");
  });
});

describe("purchaseRequestPoExcessToStock", () => {
  it("computes pack-size excess for 185.61 required and 200 ordered", () => {
    const excess = purchaseRequestPoExcessToStock({ netRequiredQty: 185.61, orderedQty: 0 }, 200);
    expect(excess).toBeCloseTo(14.39, 2);
  });
});

describe("buildRmPoCreatePayloadLines / previewConsolidatedRmPoLines", () => {
  const lines = [
    {
      ...baseLine,
      id: 1,
      rmItemId: 70,
      itemName: "HDPE",
      requestDocNo: "PR-26-0001",
      requestStatus: "PENDING_PURCHASE",
      requestStatusLabel: "Pending",
      demandPool: "MPRS",
      pendingQty: 114,
      netRequiredQty: 114,
    },
    {
      ...baseLine,
      id: 2,
      rmItemId: 70,
      itemName: "HDPE",
      requestDocNo: "PR-26-0002",
      requestStatus: "PENDING_PURCHASE",
      requestStatusLabel: "Pending",
      demandPool: "STOCK_REPLENISHMENT",
      pendingQty: 500,
      netRequiredQty: 500,
    },
  ];

  it("excludes qty 0 (deselected) lines from payload", () => {
    const payload = buildRmPoCreatePayloadLines(lines, { 1: "114", 2: "0" }, { 1: "10", 2: "10" });
    expect(payload).toHaveLength(1);
    expect(payload[0]?.purchaseRequestLineId).toBe(1);
  });

  it("previews consolidated HDPE 614 from two PRs", () => {
    const preview = previewConsolidatedRmPoLines(lines, { 1: "114", 2: "500" }, { 1: "10", 2: "10" });
    expect(preview.allocationsSelected).toBe(2);
    expect(preview.consolidated).toHaveLength(1);
    expect(preview.consolidated[0]?.orderQty).toBe(614);
    expect(preview.consolidated[0]?.requiredQty).toBe(614);
    expect(preview.consolidated[0]?.excessToStockQty).toBe(0);
    expect(preview.confirmationLines[0]).toContain("Extra to RM Stock: 0");
  });

  it("previews Regular SO excess confirmation for 140 demand / 160 PO", () => {
    const soLines = [
      {
        ...baseLine,
        id: 3,
        rmItemId: 7,
        itemName: "PP",
        unit: "Kg",
        requestDocNo: "PR-26-0001",
        requestStatus: "PENDING_PURCHASE",
        requestStatusLabel: "Pending",
        demandPool: "REGULAR_SO",
        pendingQty: 140,
        netRequiredQty: 140,
        referenceLabel: "SO-26-0001",
      },
    ];
    const preview = previewConsolidatedRmPoLines(soLines, { 3: "160" }, { 3: "100" });
    expect(preview.consolidated[0]?.requiredQty).toBe(140);
    expect(preview.consolidated[0]?.orderQty).toBe(160);
    expect(preview.consolidated[0]?.excessToStockQty).toBe(20);
    expect(preview.confirmationLines[0]).toBe("Required: 140 Kg | PO Qty: 160 Kg | Extra to RM Stock: 20 Kg");
  });
});

describe("formatPurchaseRequestPoError", () => {
  it("maps PR_ALREADY_ORDERED code to actionable copy", () => {
    const msg = formatPurchaseRequestPoError({
      message: "PO already created for purchase request PR-26-0001.",
      code: "PR_ALREADY_ORDERED",
    });
    expect(msg).toContain("PO already created");
  });

  it("surfaces RM_PO_RATE_MISMATCH message", () => {
    const msg = formatPurchaseRequestPoError({
      message: "Cannot consolidate HDPE — different rates",
      code: "RM_PO_RATE_MISMATCH",
    });
    expect(msg).toContain("HDPE");
  });
});
