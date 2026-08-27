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
      findMany: async ({ where } = {}) => {
        let rows = state.lines.slice();
        if (where?.workOrderId != null && typeof where.workOrderId !== "object") {
          rows = rows.filter((l) => l.workOrderId === where.workOrderId);
        }
        if (where?.workOrderId?.not != null) {
          rows = rows.filter((l) => l.workOrderId !== where.workOrderId.not);
        }
        if (where?.fgItemId != null) rows = rows.filter((l) => l.fgItemId === where.fgItemId);
        return rows.map((l) => ({
          id: l.id,
          qty: l.qty,
          plannedQty: l.plannedQty ?? l.qty,
          workOrderId: l.workOrderId,
          fgItemId: l.fgItemId,
        }));
      },
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
      count: async () => {
        state.rmCalls = (state.rmCalls || 0) + 1;
        return state.draftPmrCount ?? 0;
      },
      findMany: async () => {
        state.rmCalls = (state.rmCalls || 0) + 1;
        return state.pmrs ?? [];
      },
    },
    materialIssueNote: { findMany: async () => state.materialIssueNotes ?? [] },
    productionEntry: {
      aggregate: async () => ({ _sum: { producedQty: state.producedSum ?? 0 } }),
      findMany: async () => [],
    },
    workOrderProductionRunAllocation: {
      findUnique: async ({ where }) => (state.allocations || []).find((a) => a.id === where.id) ?? null,
      findMany: async ({ where } = {}) => {
        let rows = state.allocations || [];
        if (where?.workOrderId != null) rows = rows.filter((a) => a.workOrderId === where.workOrderId);
        if (where?.isActive != null) rows = rows.filter((a) => a.isActive === where.isActive);
        if (where?.id?.in) rows = rows.filter((a) => where.id.in.includes(a.id));
        return rows;
      },
    },
    machineShiftSession: {
      findFirst: async ({ where } = {}) => {
        let rows = state.sessions || [];
        if (where?.machineId != null) rows = rows.filter((s) => s.machineId === where.machineId);
        if (where?.status != null) rows = rows.filter((s) => s.status === where.status);
        if (where?.previousSessionId != null) {
          rows = rows.filter((s) => s.previousSessionId === where.previousSessionId);
        }
        return rows[0] || null;
      },
      findUnique: async ({ where }) => (state.sessions || []).find((s) => s.id === where.id) ?? null,
      updateMany: async () => ({ count: 0 }),
    },
    machineShiftSessionRunSegment: {
      findFirst: async ({ where } = {}) => {
        let rows = state.runSegments || [];
        if (where?.machineId != null) rows = rows.filter((r) => r.machineId === where.machineId);
        if (where?.sessionId != null) rows = rows.filter((r) => r.sessionId === where.sessionId);
        if (where?.status != null) rows = rows.filter((r) => r.status === where.status);
        if (where?.workOrderId != null) rows = rows.filter((r) => r.workOrderId === where.workOrderId);
        if (where?.runAllocationId != null) {
          if (where.runAllocationId.in) {
            rows = rows.filter((r) => where.runAllocationId.in.includes(r.runAllocationId));
          } else {
            rows = rows.filter((r) => r.runAllocationId === where.runAllocationId);
          }
        }
        return rows[0] || null;
      },
      findMany: async ({ where } = {}) => {
        let rows = state.runSegments || [];
        if (where?.machineId != null) rows = rows.filter((r) => r.machineId === where.machineId);
        if (where?.sessionId != null) rows = rows.filter((r) => r.sessionId === where.sessionId);
        if (where?.status != null) rows = rows.filter((r) => r.status === where.status);
        if (where?.workOrderId != null) rows = rows.filter((r) => r.workOrderId === where.workOrderId);
        if (where?.runAllocationId != null) {
          if (where.runAllocationId.in) {
            rows = rows.filter((r) => where.runAllocationId.in.includes(r.runAllocationId));
          } else {
            rows = rows.filter((r) => r.runAllocationId === where.runAllocationId);
          }
        }
        return rows;
      },
    },
    workOrderProductionRunStartConfirmation: {
      findMany: async () => [],
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
      findUnique: async ({ where, select }) => {
        const so = state.salesOrders.find((s) => s.id === where.id) ?? null;
        if (!so) return null;
        if (select?.lines) return { ...so, lines: so.lines ?? [] };
        return so;
      },
    },
    bom: { findFirst: async () => state.bom ?? null },
    item: { findMany: async () => [] },
    stockTransaction: { findMany: async () => [] },
    materialReturnNote: { findMany: async () => [] },
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

  it("applies the live-window gate before RM/material calculations", async () => {
    const state = {
      lines: [{ id: 10, workOrderId: 5, fgItemId: 1, qty: "100" }],
      workOrders: [{ id: 5, salesOrderId: 2, status: "IN_PROGRESS", sourceType: "CUSTOMER_REQUIREMENT" }],
      salesOrders: [{ id: 2, orderType: "NORMAL", internalStatus: "IN_PROCESS" }],
      draftPmrCount: 1,
      allocations: [{ id: 200, workOrderId: 5, machineId: 1, isActive: true }],
      sessions: [{ id: 7, machineId: 1, status: "HANDOVER_PENDING", shiftSessionNo: "SS-26-0009", previousSessionId: null }],
      runSegments: [{ id: 9, sessionId: 7, machineId: 1, status: "ACTIVE", workOrderId: 5, runAllocationId: 200 }],
      rmCalls: 0,
    };
    const db = createGateMockDb(state);
    await assert.rejects(
      () =>
        assertProductionEntryAllowed(db, {
          workOrderLineId: 10,
          producedQty: 1,
          runAllocationId: 200,
        }),
      (err) => err.code === "SHIFT_LIVE_WINDOW_ENDED",
    );
    assert.equal(state.rmCalls, 0);
  });

  it("omitted runAllocationId still applies the live-window gate before RM", async () => {
    const state = {
      lines: [{ id: 10, workOrderId: 5, fgItemId: 1, qty: "100" }],
      workOrders: [{ id: 5, salesOrderId: 2, status: "IN_PROGRESS", sourceType: "CUSTOMER_REQUIREMENT" }],
      salesOrders: [{ id: 2, orderType: "NORMAL", internalStatus: "IN_PROCESS" }],
      draftPmrCount: 1,
      allocations: [{ id: 200, workOrderId: 5, machineId: 1, isActive: true, workOrderLineId: 10, fgItemId: 1 }],
      sessions: [
        {
          id: 7,
          machineId: 1,
          status: "HANDOVER_PENDING",
          shiftSessionNo: "SS-26-0009",
          previousSessionId: null,
        },
      ],
      runSegments: [{ id: 9, sessionId: 7, machineId: 1, status: "ACTIVE", workOrderId: 5, runAllocationId: 200 }],
      rmCalls: 0,
    };
    const db = createGateMockDb(state);
    await assert.rejects(
      () =>
        assertProductionEntryAllowed(db, {
          workOrderLineId: 10,
          producedQty: 1,
        }),
      (err) => err.code === "SHIFT_LIVE_WINDOW_ENDED",
    );
    assert.equal(state.rmCalls, 0);
  });

  it("genuine no-shift legacy PE still reaches RM/material gates", async () => {
    const state = {
      lines: [{ id: 10, workOrderId: 5, fgItemId: 1, qty: "100" }],
      workOrders: [{ id: 5, salesOrderId: 2, status: "IN_PROGRESS", sourceType: "CUSTOMER_REQUIREMENT" }],
      salesOrders: [{ id: 2, orderType: "NORMAL", internalStatus: "IN_PROCESS" }],
      draftPmrCount: 1,
      allocations: [],
      sessions: [],
      runSegments: [],
      rmCalls: 0,
    };
    const db = createGateMockDb(state);
    await assert.rejects(
      () => assertProductionEntryAllowed(db, { workOrderLineId: 10, producedQty: 1 }),
      (err) =>
        err.code === "PRODUCTION_RM_NO_PMR" ||
        err.code === "BOM_MISSING" ||
        String(err.code || "").startsWith("PRODUCTION_RM"),
    );
    assert.ok(state.rmCalls > 0);
  });
});
