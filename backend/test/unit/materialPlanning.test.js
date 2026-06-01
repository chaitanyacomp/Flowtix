const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  round3,
  effectivePerFgUnit,
  MAX_EXPLOSION_DEPTH,
} = require("../../src/services/bomExplosionService");
const { rmRequiredForFgCount, lossMultiplier } = require("../../src/services/bomWeightPlanning");

describe("bomExplosionService helpers", () => {
  it("round3 rounds to 3 decimals", () => {
    assert.equal(round3(1.23456), 1.235);
  });

  it("effectivePerFgUnit uses header loss multiplier", () => {
    const bom = { outputQty: 1, processLossPercent: 10, qcLossPercent: 5 };
    const line = { baseQty: 2 };
    const eff = effectivePerFgUnit(bom, line);
    const expected = rmRequiredForFgCount(2, 1, 1, 10, 5);
    assert.ok(Math.abs(eff - expected) < 1e-6);
    assert.ok(Math.abs(lossMultiplier(10, 5) - 1.15) < 1e-6);
  });

  it("MAX_EXPLOSION_DEPTH is 3", () => {
    assert.equal(MAX_EXPLOSION_DEPTH, 3);
  });
});

describe("resolveWoPrepareBlockReason", () => {
  const { resolveWoPrepareBlockReason } = require("../../src/services/materialPlanningService");

  it("blocks when approved BOM missing", () => {
    const reason = resolveWoPrepareBlockReason({
      hasMissingBom: true,
      hasMissingChildBom: false,
      totalShortageLines: 0,
      rmSummary: [{ rmItemId: 1 }],
      fgSummary: [],
    });
    assert.match(reason, /Approved BOM not found/);
  });

  it("blocks when SFG child BOM missing", () => {
    const reason = resolveWoPrepareBlockReason({
      hasMissingBom: false,
      hasMissingChildBom: true,
      totalShortageLines: 0,
      rmSummary: [{ rmItemId: 1 }],
      fgSummary: [{ missingChildBomNames: ["Cap"] }],
    });
    assert.match(reason, /Child BOM missing/);
  });

  it("blocks when pending MR and stock still short", () => {
    const reason = resolveWoPrepareBlockReason(
      { hasMissingBom: false, hasMissingChildBom: false, totalShortageLines: 2, rmSummary: [{}, {}], fgSummary: [] },
      { pendingMaterialRequirements: [{ id: 1, docNo: "MR-26-0001" }] },
    );
    assert.match(reason, /Material requirement is pending/);
  });

  it("blocks with purchase wording when RM shortage and no pending MR", () => {
    const reason = resolveWoPrepareBlockReason({
      hasMissingBom: false,
      hasMissingChildBom: false,
      totalShortageLines: 2,
      rmSummary: [{}, {}],
      fgSummary: [],
    });
    assert.match(reason, /Raise material requirement for Purchase/);
  });

  it("allows when no blockers", () => {
    const reason = resolveWoPrepareBlockReason({
      hasMissingBom: false,
      hasMissingChildBom: false,
      totalShortageLines: 0,
      rmSummary: [{ rmItemId: 1 }],
      fgSummary: [],
    });
    assert.equal(reason, null);
  });
});

describe("material planning RM status", () => {
  const { rmLineStatus, buildRmSummaryLineFromAvailability } = require("../../src/services/materialPlanningService");

  it("AVAILABLE when stock covers requirement", () => {
    assert.equal(rmLineStatus(100, 150), "AVAILABLE");
  });

  it("PARTIAL when some stock but shortage remains", () => {
    assert.equal(rmLineStatus(100, 40), "PARTIAL");
  });

  it("SHORTAGE when no stock", () => {
    assert.equal(rmLineStatus(100, 0), "SHORTAGE");
  });

  it("WO prepare readiness uses free stock after PMR reservation", () => {
    const line = buildRmSummaryLineFromAvailability({
      rmItemId: 10,
      requiredQty: 80,
      item: { itemName: "HDPE", unit: "KG" },
      availability: {
        physicalUsableStockQty: 100,
        legacyReservedQty: 70,
        freeStockQty: 30,
        incomingQty: 0,
        issuedToProductionQty: 0,
        shortageNowQty: 0,
        shortageAfterReservationQty: 50,
        coveredByIncomingQty: 0,
        netShortageAfterIncomingQty: 50,
        warnings: [],
      },
    });

    assert.equal(line.availableQty, 30);
    assert.equal(line.freeStockQty, 30);
    assert.equal(line.shortageQty, 50);
    assert.equal(line.status, "PARTIAL");
  });

  it("WO prepare readiness keeps incoming separate from available stock", () => {
    const line = buildRmSummaryLineFromAvailability({
      rmItemId: 11,
      requiredQty: 100,
      item: { itemName: "Powder", unit: "KG" },
      availability: {
        physicalUsableStockQty: 0,
        legacyReservedQty: 0,
        freeStockQty: 0,
        incomingQty: 100,
        issuedToProductionQty: 0,
        shortageNowQty: 100,
        shortageAfterReservationQty: 100,
        coveredByIncomingQty: 100,
        netShortageAfterIncomingQty: 0,
        warnings: [{ code: "SHORTAGE_COVERED_BY_INCOMING", message: "Covered by incoming." }],
      },
    });

    assert.equal(line.availableQty, 0);
    assert.equal(line.incomingQty, 100);
    assert.equal(line.shortageQty, 100);
    assert.equal(line.status, "SHORTAGE");
    assert.equal(line.netShortageAfterIncomingQty, 0);
  });
});

describe("material planning FG demand from SO planning view", () => {
  const { fgLinesFromSalesOrder } = require("../../src/services/materialPlanningService");

  it("returns a positive FG demand line when plannedProductionQty=0 but rmPlanningQty>0", () => {
    const planningView = {
      lines: [
        { lineId: 810, fgItemId: 1080, fgName: "Nozzle", plannedProductionQty: 0, rmPlanningQty: 10000, toProduce: 10000 },
      ],
    };
    const fgInput = fgLinesFromSalesOrder({ lines: [] }, planningView);
    // fgCount in the preview = fgInput.filter(fgQty > 0).length, so a positive row keeps the preview non-empty.
    assert.equal(fgInput.length, 1);
    assert.equal(fgInput.filter((r) => r.fgQty > 0).length, 1);
    assert.equal(fgInput[0].fgItemId, 1080);
    assert.equal(fgInput[0].fgQty, 10000);
  });

  it("falls back to raw SO FG line qty when planning view has no lines", () => {
    const so = {
      lines: [
        { id: 1, itemId: 1080, qty: 250, item: { itemType: "FG", itemName: "Nozzle", unit: "Nos" } },
        { id: 2, itemId: 50, qty: 9, item: { itemType: "RM", itemName: "Powder", unit: "KG" } },
      ],
    };
    const fgInput = fgLinesFromSalesOrder(so, null);
    assert.equal(fgInput.length, 1);
    assert.equal(fgInput[0].fgItemId, 1080);
    assert.equal(fgInput[0].fgQty, 250);
  });
});

describe("material planning operational state", () => {
  const { materialPlanningOperationalState } = require("../../src/services/materialPlanningService");
  const readiness = {
    hasMissingBom: false,
    hasMissingChildBom: false,
    allRmAvailable: false,
    rmSummary: [
      { shortageQty: 100 },
      { shortageQty: 50 },
    ],
  };

  it("active shortage with no MR shows purchase required", () => {
    const state = materialPlanningOperationalState({
      sourceType: "SALES_ORDER",
      context: { internalStatus: "IN_PROCESS" },
      readiness,
      activeMaterialRequirement: null,
      cancelledMaterialRequirement: null,
      procurementCompleted: false,
    });

    assert.equal(state.key, "PURCHASE_REQUIRED");
    assert.equal(state.purchaseRequiredCount, 2);
    assert.equal(state.pendingProcurementQty, 150);
  });

  it("active MR keeps procurement pending", () => {
    const state = materialPlanningOperationalState({
      sourceType: "SALES_ORDER",
      context: { internalStatus: "IN_PROCESS" },
      readiness,
      activeMaterialRequirement: { id: 1 },
      cancelledMaterialRequirement: null,
      procurementCompleted: false,
    });

    assert.equal(state.key, "PROCUREMENT_PENDING");
    assert.equal(state.currentStage, "Procurement in progress");
  });

  it("closed unresolved MR stays in procurement pending with reopen guidance", () => {
    const state = materialPlanningOperationalState({
      sourceType: "SALES_ORDER",
      context: { internalStatus: "IN_PROCESS" },
      readiness,
      activeMaterialRequirement: { id: 1, status: "CLOSED" },
      cancelledMaterialRequirement: null,
      procurementCompleted: false,
    });

    assert.equal(state.key, "PROCUREMENT_PENDING");
    assert.equal(state.banner, "RM Requisition closed but shortage unresolved");
    assert.equal(state.actionLabel, "Open RM Control Center");
  });

  it("active MR takes precedence over historical completion", () => {
    const state = materialPlanningOperationalState({
      sourceType: "SALES_ORDER",
      context: { internalStatus: "IN_PROCESS" },
      readiness,
      activeMaterialRequirement: { id: 1 },
      cancelledMaterialRequirement: null,
      procurementCompleted: true,
    });

    assert.equal(state.key, "PROCUREMENT_PENDING");
    assert.equal(state.readyForProduction, false);
    assert.equal(state.procurementCompleted, false);
  });

  it("completed procurement tracks status only — does not claim store issue without live stock", () => {
    const state = materialPlanningOperationalState({
      sourceType: "SALES_ORDER",
      context: { internalStatus: "IN_PROCESS" },
      readiness,
      activeMaterialRequirement: null,
      cancelledMaterialRequirement: null,
      procurementCompleted: true,
    });

    assert.equal(state.key, "PROCUREMENT_COMPLETED");
    assert.equal(state.purchaseRequiredCount, 2);
    assert.equal(state.readyForProduction, false);
    assert.match(state.banner, /RM Control Center/i);
    assert.doesNotMatch(state.banner ?? "", /RM available in Store/i);
  });

  it("completed procurement with live shortage stays in planning tracking", () => {
    const shortReadiness = {
      ...readiness,
      rmSummary: readiness.rmSummary.map((r) => ({ ...r, shortageQty: 5, status: "SHORTAGE" })),
      allRmAvailable: false,
      totalShortageLines: 2,
    };
    const state = materialPlanningOperationalState({
      sourceType: "SALES_ORDER",
      context: { internalStatus: "IN_PROCESS" },
      readiness: shortReadiness,
      activeMaterialRequirement: null,
      cancelledMaterialRequirement: null,
      procurementCompleted: true,
    });

    assert.equal(state.key, "PROCUREMENT_COMPLETED");
    assert.equal(state.purchaseRequiredCount, 2);
    assert.match(state.currentStage, /live store shortage/i);
  });

  it("cancelled duplicate with completed procurement uses planning tracking only", () => {
    const state = materialPlanningOperationalState({
      sourceType: "SALES_ORDER",
      context: { internalStatus: "IN_PROCESS" },
      readiness,
      activeMaterialRequirement: null,
      cancelledMaterialRequirement: { id: 2 },
      procurementCompleted: true,
    });

    assert.equal(state.key, "PROCUREMENT_COMPLETED");
    assert.doesNotMatch(state.banner ?? "", /RM available in Store/i);
  });

  it("completed SO closes RM planning regardless of raw shortage snapshot", () => {
    const state = materialPlanningOperationalState({
      sourceType: "SALES_ORDER",
      context: { internalStatus: "COMPLETED" },
      readiness,
      activeMaterialRequirement: null,
      cancelledMaterialRequirement: { id: 2 },
      procurementCompleted: true,
    });

    assert.equal(state.key, "SO_COMPLETED");
    assert.equal(state.currentStage, "Sales Order completed — RM planning closed");
    assert.equal(state.purchaseRequiredCount, 0);
    assert.equal(state.pendingProcurementQty, 0);
  });
});
