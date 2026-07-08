const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  assertProductionEntryApprovable,
  PE_DRAFT,
  PE_APPROVED,
} = require("../../src/services/productionEntryApprovalGateService");

function createApprovalMockDb(state) {
  return {
    productionEntry: {
      findUnique: async ({ where, include }) => {
        const prod = state.entries.find((e) => e.id === where.id);
        if (!prod) return null;
        if (!include?.workOrderLine) return prod;
        const wol = state.lines.find((l) => l.id === prod.workOrderLineId);
        const wo = state.workOrders.find((w) => w.id === wol?.workOrderId);
        const so = wo?.salesOrderId
          ? state.salesOrders.find((s) => s.id === wo.salesOrderId) ?? null
          : null;
        return {
          ...prod,
          workOrderLine: wol
            ? {
                ...wol,
                fgItem: wol.fgItem ?? { id: wol.fgItemId, itemName: "FG" },
                workOrder: wo ? { ...wo, salesOrder: so } : null,
              }
            : null,
        };
      },
      update: async ({ where, data }) => {
        const idx = state.entries.findIndex((e) => e.id === where.id);
        state.entries[idx] = { ...state.entries[idx], ...data };
        return state.entries[idx];
      },
    },
    productionEntryRmConsumption: {
      count: async ({ where }) =>
        (state.rmConsumptionSnapshots ?? []).filter((r) => r.productionEntryId === where.productionEntryId).length,
    },
    stockTransaction: {
      count: async ({ where }) =>
        (state.stockIssues ?? []).filter(
          (r) => r.refId === where.refId && r.transactionType === where.transactionType,
        ).length,
    },
    qcEntry: { count: async () => state.qcCount ?? 0 },
  };
}

describe("productionEntryApprovalGateService", () => {
  it("assertProductionEntryApprovable rejects already approved entry", async () => {
    const db = createApprovalMockDb({
      entries: [{ id: 1, workOrderLineId: 10, workflowStatus: PE_APPROVED, producedQty: 5 }],
      lines: [{ id: 10, workOrderId: 5, fgItemId: 1 }],
      workOrders: [{ id: 5, salesOrderId: 2 }],
      salesOrders: [{ id: 2, orderType: "NORMAL" }],
    });
    await assert.rejects(
      () => assertProductionEntryApprovable(db, 1),
      (err) => err.code === "PRODUCTION_ENTRY_ALREADY_APPROVED" && err.statusCode === 409,
    );
  });

  it("assertProductionEntryApprovable rejects entry with QC history", async () => {
    const db = createApprovalMockDb({
      entries: [{ id: 1, workOrderLineId: 10, workflowStatus: PE_DRAFT, producedQty: 5 }],
      lines: [{ id: 10, workOrderId: 5, fgItemId: 1 }],
      workOrders: [{ id: 5, salesOrderId: 2 }],
      salesOrders: [{ id: 2, orderType: "NORMAL" }],
      qcCount: 1,
    });
    await assert.rejects(
      () => assertProductionEntryApprovable(db, 1),
      (err) => err.statusCode === 400,
    );
  });
});
