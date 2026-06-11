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
    expect(procurementSourceLabel("WORK_ORDER_PLANNING", "WO-26-0032")).toBe("WO-26-0032");
    expect(procurementSourceLabel("STOCK_REPLENISHMENT")).toBe("Min Stock Replenishment");
  });

  it("lineCoveragePercent prefers GRN percent when present", () => {
    expect(lineCoveragePercent({ requiredQty: 100, grnReceivedPercent: 62.5 })).toBe(62.5);
    expect(
      lineCoveragePercent({
        requiredQty: 100,
        shortageAfterReservationQty: 40,
        coveredByIncomingQty: 20,
      }),
    ).toBe(80);
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
