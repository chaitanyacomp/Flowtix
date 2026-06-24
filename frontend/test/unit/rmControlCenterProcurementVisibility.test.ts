import { describe, expect, it } from "vitest";
import {
  deriveProcurementChip,
  deriveProcurementWarnings,
  lineCoveragePercent,
  procurementSourceLabel,
  procurementTimelineStepIndex,
  storeMayCreatePurchaseRequest,
} from "../../src/lib/rmControlCenterProcurementVisibility";
import { buildPurchaseRequestPayloadFromWoMr } from "../../src/lib/purchaseRequestFromMr";

describe("rmControlCenterProcurementVisibility", () => {
  it("deriveProcurementChip maps supply lifecycle to operator labels", () => {
    expect(
      deriveProcurementChip({
        anyShortage: true,
        hasMr: true,
        mrStatus: "APPROVED",
        prLineCount: 0,
        poLineCount: 0,
        pendingGrnQty: 0,
        receivedGrnQty: 0,
      }).label,
    ).toBe("Awaiting PR");

    expect(
      deriveProcurementChip({
        anyShortage: true,
        hasMr: true,
        mrStatus: "SENT_TO_PURCHASE",
        prLineCount: 2,
        poLineCount: 0,
        pendingGrnQty: 0,
        receivedGrnQty: 0,
      }).label,
    ).toBe("Awaiting PO");

    expect(
      deriveProcurementChip({
        anyShortage: true,
        hasMr: true,
        mrStatus: "PROCUREMENT_IN_PROGRESS",
        prLineCount: 1,
        poLineCount: 1,
        pendingGrnQty: 50,
        receivedGrnQty: 0,
      }).label,
    ).toBe("GRN Pending");

    expect(
      deriveProcurementChip({
        anyShortage: false,
        hasMr: true,
        mrStatus: "FULLY_PROCURED",
        prLineCount: 1,
        poLineCount: 1,
        pendingGrnQty: 0,
        receivedGrnQty: 100,
        procurementCompleted: true,
      }).label,
    ).toBe("Fully Received");
  });

  it("procurementSourceLabel maps source types for trace display", () => {
    expect(procurementSourceLabel("MONTHLY_PLAN", "December Plan 1")).toBe("December Plan 1");
    expect(procurementSourceLabel("WORK_ORDER_PLANNING", "WO-26-0032")).toBe("Legacy / Historical Demand");
    expect(procurementSourceLabel("STOCK_REPLENISHMENT")).toBe("Stock Replenishment");
    expect(procurementSourceLabel("SALES_ORDER", "SO-26-0001")).toBe("SO-26-0001");
  });

  it("lineCoveragePercent uses available stock over required (Store issue coverage)", () => {
    expect(lineCoveragePercent({ requiredQty: 42, freeStockQty: 21 })).toBe(50);
    expect(lineCoveragePercent({ requiredQty: 63, freeStockQty: 21 })).toBe(33);
    expect(lineCoveragePercent({ requiredQty: 10, freeStockQty: 0 })).toBe(0);
    expect(lineCoveragePercent({ requiredQty: 10, freeStockQty: 15 })).toBe(100);
    expect(lineCoveragePercent({ requiredQty: 0, freeStockQty: 0 })).toBe(100);
  });

  it("lineCoveragePercent ignores GRN percent for Store RM Control Center view", () => {
    expect(lineCoveragePercent({ requiredQty: 63, freeStockQty: 21 })).toBe(33);
  });

  it("procurementTimelineStepIndex advances with PR/PO/GRN", () => {
    expect(
      procurementTimelineStepIndex({
        hasMr: true,
        prLineCount: 0,
        poLineCount: 0,
        pendingGrnQty: 0,
        receivedGrnQty: 0,
      }),
    ).toBe(0);
    expect(
      procurementTimelineStepIndex({
        hasMr: true,
        prLineCount: 1,
        poLineCount: 1,
        pendingGrnQty: 10,
        receivedGrnQty: 0,
      }),
    ).toBe(3);
  });

  it("storeMayCreatePurchaseRequest is limited to Awaiting PR + Store role", () => {
    const chip = deriveProcurementChip({
      anyShortage: true,
      hasMr: true,
      mrStatus: "APPROVED",
      prLineCount: 0,
      poLineCount: 0,
      pendingGrnQty: 0,
      receivedGrnQty: 0,
    });
    expect(storeMayCreatePurchaseRequest(chip, true)).toBe(true);
    expect(storeMayCreatePurchaseRequest(chip, false)).toBe(false);
  });

  it("storeMayCreatePurchaseRequest hides after FULLY_PROCURED MPRS procurement", () => {
    const chip = deriveProcurementChip({
      anyShortage: true,
      hasMr: true,
      mrStatus: "FULLY_PROCURED",
      prLineCount: 1,
      poLineCount: 1,
      pendingGrnQty: 0,
      receivedGrnQty: 55,
      procurementCompleted: true,
      notEscalated: true,
    });
    expect(chip.label).toBe("Fully Received");
    expect(
      storeMayCreatePurchaseRequest(chip, true, {
        procurementCompleted: true,
        mrStatus: "FULLY_PROCURED",
        receivedGrnQty: 55,
      }),
    ).toBe(false);
  });

  it("deriveProcurementChip does not fall back to Awaiting PR when notEscalated but procurement completed", () => {
    const chip = deriveProcurementChip({
      anyShortage: true,
      hasMr: false,
      mrStatus: "FULLY_PROCURED",
      prLineCount: 1,
      poLineCount: 1,
      pendingGrnQty: 0,
      receivedGrnQty: 55,
      procurementCompleted: true,
      notEscalated: true,
    });
    expect(chip.key).not.toBe("AWAITING_PR");
    expect(chip.label).toBe("Fully Received");
  });

  it("deriveProcurementWarnings surfaces awaiting PO and GRN notes", () => {
    const chip = deriveProcurementChip({
      anyShortage: true,
      hasMr: true,
      mrStatus: "SENT_TO_PURCHASE",
      prLineCount: 1,
      poLineCount: 0,
      pendingGrnQty: 0,
      receivedGrnQty: 0,
    });
    const warnings = deriveProcurementWarnings({
      chip,
      pendingGrnQty: 0,
      incomingLineCount: 0,
    });
    expect(warnings.some((w) => w.code === "AWAITING_PO")).toBe(true);
  });
});

describe("buildPurchaseRequestPayloadFromWoMr", () => {
  it("builds PR body from WO MR lines with remaining shortage", () => {
    const payload = buildPurchaseRequestPayloadFromWoMr({
      id: 10,
      docNo: "MR-26-0010",
      lines: [
        {
          id: 100,
          rmItemId: 5,
          rmItemName: "Cap RM",
          unit: "KG",
          requiredQty: 500,
          shortageQty: 500,
          procuredQty: 100,
        },
      ],
    });
    expect(payload).toBeTruthy();
    expect(payload!.lines).toHaveLength(1);
    expect(payload!.lines[0].netRequiredQty).toBe(400);
    expect(payload!.lines[0].allocations).toEqual([{ materialRequirementLineId: 100, qty: 400 }]);
  });
});
