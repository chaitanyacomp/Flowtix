const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveProductionEntryGateContext,
  assertProductionEntryAllowed,
} = require("../../src/services/productionEntryGateService");
const { assertProductionPmrGate } = require("../../src/services/productionRmReadinessService");

function createGateMockDb(state) {
  return {
    workOrderLine: {
      findUnique: async ({ where, include }) => {
        const wol = state.lines.find((l) => l.id === where.id);
        if (!wol) return null;
        const wo = state.workOrders.find((w) => w.id === wol.workOrderId);
        if (!include?.workOrder) return wol;
        const so = wo?.salesOrderId
          ? state.salesOrders.find((s) => s.id === wo.salesOrderId) ?? null
          : null;
        return {
          ...wol,
          fgItem: wol.fgItem ?? { id: wol.fgItemId, itemName: "FG" },
          workOrder: wo ? { ...wo, salesOrder: so } : null,
        };
      },
      findMany: async ({ where }) =>
        state.lines.filter((l) => l.workOrderId === where.workOrderId).map((l) => ({
          id: l.id,
          qty: l.qty,
          plannedQty: l.plannedQty ?? l.qty,
        })),
    },
    requirementSheet: {
      findFirst: async ({ where }) =>
        state.requirementSheets.find(
          (rs) =>
            rs.salesOrderId === where.salesOrderId &&
            rs.cycleId === where.cycleId &&
            rs.status === where.status,
        ) ?? null,
      findUnique: async ({ where }) => state.requirementSheets.find((rs) => rs.id === where.id) ?? null,
    },
    productionMaterialRequest: {
      count: async () => state.draftPmrCount ?? 0,
      findMany: async () => state.pmrs ?? [],
    },
    materialIssueNote: { findMany: async () => state.materialIssueNotes ?? [] },
    productionEntry: {
      aggregate: async () => ({ _sum: { producedQty: state.producedSum ?? 0 } }),
    },
    workOrder: {
      findUnique: async ({ where, select }) => {
        const wo = state.workOrders.find((w) => w.id === where.id);
        if (!wo) return null;
        if (select?.productionExecution) {
          return {
            ...wo,
            salesOrder: wo.salesOrderId
              ? state.salesOrders.find((s) => s.id === wo.salesOrderId)
              : undefined,
            productionExecution: wo.productionExecution ?? null,
          };
        }
        return wo;
      },
    },
    salesOrder: {
      findUnique: async ({ where }) => state.salesOrders.find((s) => s.id === where.id) ?? null,
    },
    bom: { findFirst: async () => state.bom ?? null },
    item: { findMany: async () => [] },
    stockTransaction: { findMany: async () => [] },
    monthlyProductionPlan: {
      findFirst: async () => (state.releasedPlan ? { id: 1, periodKey: "2026-05" } : null),
    },
  };
}

describe("productionEntryGateService", () => {
  it("resolveProductionEntryGateContext rejects customer-return replacement SO", async () => {
    const db = createGateMockDb({
      lines: [{ id: 10, workOrderId: 5, fgItemId: 1, qty: "100" }],
      workOrders: [{ id: 5, salesOrderId: 2, status: "PENDING", sourceType: "CUSTOMER_REQUIREMENT" }],
      salesOrders: [{ id: 2, orderType: "NORMAL", internalStatus: "IN_PROCESS", customerReturnId: 99 }],
    });
    await assert.rejects(
      () => resolveProductionEntryGateContext(db, 10),
      (err) => err.code === "NO_PRODUCTION_ON_CUSTOMER_RETURN_REPLACEMENT_SO",
    );
  });

  it("assertProductionEntryAllowed blocks REGULAR SO that is COMPLETED", async () => {
    const db = createGateMockDb({
      lines: [{ id: 10, workOrderId: 5, fgItemId: 1, qty: "100" }],
      workOrders: [{ id: 5, salesOrderId: 2, status: "IN_PROGRESS", sourceType: "CUSTOMER_REQUIREMENT" }],
      salesOrders: [{ id: 2, orderType: "NORMAL", internalStatus: "COMPLETED" }],
      draftPmrCount: 0,
      pmrs: [{ status: "FULLY_ISSUED", lines: [{ itemId: 1, requiredQty: "10", issuedQty: "10" }], materialIssueNotes: [{ id: 1 }] }],
      materialIssueNotes: [{ workOrderId: 5, productionMaterialRequestId: 1, toLocationId: 3 }],
      bom: { id: 1, lines: [{ rmItemId: 1, baseQtyPerFg: "1" }] },
      releasedPlan: true,
    });
    await assert.rejects(
      () => assertProductionEntryAllowed(db, { workOrderLineId: 10, producedQty: 1 }),
      (err) => err.code === "SO_PRODUCTION_CLOSED",
    );
  });

  it("assertProductionEntryAllowed blocks NO_QTY WO on HOLD", async () => {
    const db = createGateMockDb({
      lines: [{ id: 10, workOrderId: 5, fgItemId: 1, qty: "100" }],
      workOrders: [
        {
          id: 5,
          salesOrderId: 2,
          cycleId: 3,
          status: "HOLD",
          holdReason: "RM_SHORTAGE",
          sourceType: "CUSTOMER_REQUIREMENT",
          productionExecution: { executionStatus: "RUNNING" },
        },
      ],
      salesOrders: [{ id: 2, orderType: "NO_QTY", internalStatus: "IN_PROCESS" }],
      requirementSheets: [{ id: 7, salesOrderId: 2, cycleId: 3, status: "LOCKED", periodKey: "2026-05" }],
      releasedPlan: true,
    });
    await assert.rejects(
      () => assertProductionEntryAllowed(db, { workOrderLineId: 10, producedQty: 1 }),
      (err) => err.code === "WO_PRODUCTION_BLOCKED",
    );
  });

  it("assertProductionPmrGate blocks when PMR is missing", () => {
    assert.throws(
      () => assertProductionPmrGate({ gate: "NO_PMR", bomMissing: false, missingChildBoms: [] }),
      (err) => err.code === "PRODUCTION_RM_NO_PMR",
    );
  });
});
