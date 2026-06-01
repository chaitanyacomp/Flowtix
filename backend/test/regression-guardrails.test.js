/**
 * Targeted regression guardrails for business-critical ERP flows (node --test).
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/createApp");
const { signAccessToken } = require("../src/utils/jwt");
const {
  getDraftSoItemQtyFloorViolations,
  formatDraftSoFloorViolationMessage,
} = require("../src/services/draftSalesOrderQtyFloors");
const { STOCK_EPS } = require("../src/services/transactionalIntegrityGuards");
const {
  netDispatchedByItemId,
  allocateDispatchAcrossSalesOrderLines,
  remainingDispatchCapacityForSoItem,
  getAttributedDispatchQtyForSalesOrderLine,
} = require("../src/services/salesOrderDispatchAllocation");
const {
  computeSalesOrderDispatchLineStats,
  getSalesOrderDispatchCompletionPercent,
  computeWorkOrderTrackingSummaryFromRows,
  assertWorkOrderTrackingSummaryMatches,
  normalizeWorkOrderTrackingApiPayloadForVerification,
  METRIC_CONTEXT,
} = require("../src/services/reportMetrics");
const {
  assertWorkOrderLinesAgainstSalesOrder,
  getSalesOrderFgWorkOrderBalances,
} = require("../src/services/workOrderSoValidation");
const {
  QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT,
  DASHBOARD_ACTIVE_WORK_ORDER_STATUSES,
  DASHBOARD_RUNNING_WORK_ORDER_STATUSES,
  DASHBOARD_TERMINAL_WORK_ORDER_STATUSES,
  dashboardActiveWorkOrderWhere,
  dashboardRunningWorkOrderWhere,
  isDashboardHoldWorkOrderStatus,
  isDashboardTerminalWorkOrderStatus,
  resolveNoQtyDashboardCycleHistoryStatus,
} = require("../src/services/dashboardQueueSnapshots");
const {
  buildDispatchExceptions,
  buildProductionExceptions,
  buildQcExceptions,
  buildRmExceptions,
  buildPurchaseExceptions,
  buildExceptionSummary,
  OPERATIONS_EXCEPTION_CONFIG,
  ROW_NUM_EPS,
} = require("../src/services/operationsExceptionClassification");
const { computeNoQtyOperatorCarryForwardQty } = require("../src/routes/requirementSheets");

function bearerForRole(role) {
  return `Bearer ${signAccessToken({ userId: role === "ADMIN" ? 1 : 2, email: `${role.toLowerCase()}@test.com`, role, name: role })}`;
}

describe("release-readiness route guardrails", () => {
  it("blocks non-admin users from reversing approved production batches before any DB work", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/production/production-entries/1/reverse")
      .set("Authorization", bearerForRole("PRODUCTION"))
      .send({ reason: "release guardrail" });

    assert.equal(res.status, 403);
    assert.equal(res.body?.error?.message, "Only Admin can reverse approved production batches.");
  });

  it("does not expose the temporary runtime debug endpoint", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/api/debug/runtime-info")
      .set("Authorization", bearerForRole("ADMIN"));

    assert.equal(res.status, 404);
  });

  it("GET /api/reports/production-rm-variance is registered (Phase 3F)", async () => {
    const app = createApp();
    const missingRoute = await request(app)
      .get("/api/reports/production-rm-variance-typo")
      .set("Authorization", bearerForRole("PRODUCTION"));
    assert.equal(missingRoute.status, 404);

    const res = await request(app)
      .get("/api/reports/production-rm-variance")
      .set("Authorization", bearerForRole("PRODUCTION"));

    assert.match(String(res.headers["content-type"] ?? ""), /application\/json/);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body?.rows));
    assert.ok(res.body?.kpis);
  });

  it("GET /api/production/production-entries/:id/rm-consumption-preview is registered (Phase 3E)", async () => {
    const app = createApp();
    const missingRoute = await request(app)
      .get("/api/production/production-entries/1/rm-consumption-preview-typo")
      .set("Authorization", bearerForRole("PRODUCTION"));
    assert.equal(missingRoute.status, 404);

    const res = await request(app)
      .get("/api/production/production-entries/1/rm-consumption-preview")
      .set("Authorization", bearerForRole("PRODUCTION"));

    assert.match(String(res.headers["content-type"] ?? ""), /application\/json/);
    assert.ok(
      res.status === 200 || res.status === 404 || res.status === 409,
      `expected JSON response, got ${res.status}`,
    );
  });

  it("GET /api/production-material-returns/returnable is registered (Phase 3D)", async () => {
    const app = createApp();
    const missingRoute = await request(app)
      .get("/api/production-material-returns-typo/returnable")
      .set("Authorization", bearerForRole("PRODUCTION"));
    assert.equal(missingRoute.status, 404);

    const res = await request(app)
      .get("/api/production-material-returns/returnable")
      .set("Authorization", bearerForRole("PRODUCTION"));

    assert.match(String(res.headers["content-type"] ?? ""), /application\/json/);
    assert.equal(res.status, 400);
    assert.match(String(res.body?.error?.message ?? res.body?.message ?? ""), /workOrderId/i);
  });

  it("GET /api/production/work-order-lines/:workOrderLineId/rm-readiness is registered (Phase 3C)", async () => {
    const app = createApp();
    const missingRoute = await request(app)
      .get("/api/production/work-order-lines/1/rm-readiness-typo")
      .set("Authorization", bearerForRole("PRODUCTION"));
    assert.equal(missingRoute.status, 404);
    assert.doesNotMatch(String(missingRoute.body?.error?.message ?? missingRoute.text ?? ""), /work order line/i);

    const res = await request(app)
      .get("/api/production/work-order-lines/1/rm-readiness")
      .set("Authorization", bearerForRole("PRODUCTION"));

    assert.match(String(res.headers["content-type"] ?? ""), /application\/json/);
    assert.ok(
      res.status === 200 || res.status === 404,
      `expected JSON 200 or work-order-line 404, got ${res.status}`,
    );
    if (res.status === 200) {
      assert.ok(typeof res.body?.gate === "string" || res.body?.skipped === true);
    } else {
      assert.match(String(res.body?.error?.message ?? ""), /work order line/i);
    }
  });
});

describe("NO_QTY operator carry-forward formula", () => {
  it("uses planned qty minus approved produced qty", () => {
    assert.equal(computeNoQtyOperatorCarryForwardQty(4295, 4100), 195);
  });

  it("does not create negative carry-forward when produced exceeds planned", () => {
    assert.equal(computeNoQtyOperatorCarryForwardQty(2000, 2200), 0);
  });
});

describe("NO_QTY dashboard cycle history status", () => {
  it("marks prior cycles COMPLETED when planning pointer is ahead", () => {
    assert.equal(
      resolveNoQtyDashboardCycleHistoryStatus({
        cycleNo: 3,
        cycleRowStatus: "ACTIVE",
        isCurrentCycle: false,
        planningPointerAhead: true,
        planningPointerCycleNo: 4,
        documentCycleNo: 3,
        hasLockedRs: true,
        hasDraftRs: false,
        hasProduction: true,
      }),
      "COMPLETED",
    );
  });

  it("marks current empty planning cycle PLANNING PENDING", () => {
    assert.equal(
      resolveNoQtyDashboardCycleHistoryStatus({
        cycleNo: 4,
        cycleRowStatus: "ACTIVE",
        isCurrentCycle: true,
        planningPointerAhead: true,
        planningPointerCycleNo: 4,
        documentCycleNo: 3,
        hasLockedRs: false,
        hasDraftRs: false,
        hasProduction: false,
      }),
      "PLANNING PENDING",
    );
  });

  it("marks locked current cycle IN PROCESS not ACTIVE", () => {
    assert.equal(
      resolveNoQtyDashboardCycleHistoryStatus({
        cycleNo: 3,
        cycleRowStatus: "ACTIVE",
        isCurrentCycle: true,
        planningPointerAhead: false,
        planningPointerCycleNo: null,
        documentCycleNo: 3,
        hasLockedRs: true,
        hasDraftRs: false,
        hasProduction: true,
      }),
      "IN PROCESS",
    );
  });
});

describe("Regular SO work-order planning quantity cap", () => {
  function buildRegularSoPlanningDb(existingWoLines) {
    const fg = { id: 10, itemName: "Regular FG", itemType: "FG" };
    const so = {
      id: 1,
      orderType: "NORMAL",
      internalStatus: "APPROVED",
      customerReturnId: null,
      currentCycleId: null,
      lines: [{ id: 101, itemId: fg.id, qty: "10000", item: fg }],
      dispatch: [],
    };
    const workOrders = [
      { id: 201, salesOrderId: so.id, status: "PENDING" },
      { id: 202, salesOrderId: so.id, status: "PENDING" },
    ];
    const statusMatches = (status, cond) => {
      if (!cond) return true;
      if (cond.in) return cond.in.includes(status);
      if (cond.not) return status !== cond.not;
      return true;
    };
    const linesForWhere = (where = {}) => {
      const woCond = where.workOrder || {};
      return existingWoLines
        .map((l) => ({ ...l, workOrder: workOrders.find((w) => w.id === l.workOrderId) }))
        .filter((l) => {
          const wo = l.workOrder;
          if (!wo) return false;
          if (woCond.salesOrderId != null) {
            if (typeof woCond.salesOrderId === "object" && woCond.salesOrderId.in) {
              if (!woCond.salesOrderId.in.includes(wo.salesOrderId)) return false;
            } else if (wo.salesOrderId !== woCond.salesOrderId) {
              return false;
            }
          }
          if (!statusMatches(wo.status, woCond.status)) return false;
          if (woCond.id?.not != null && wo.id === woCond.id.not) return false;
          return true;
        });
    };
    return {
      salesOrder: {
        findUnique: async () => so,
      },
      item: {
        findMany: async () => [fg],
      },
      workOrderLine: {
        findMany: async ({ where } = {}) => linesForWhere(where),
      },
      productionEntry: {
        findMany: async () => [],
        groupBy: async () => [],
      },
      qcEntry: {
        groupBy: async () => [],
        aggregate: async () => ({ _sum: { acceptedQty: 0 } }),
      },
      stockAdjustmentQcEntry: {
        aggregate: async () => ({ _sum: { acceptedQty: 0 } }),
      },
      stockTransaction: {
        aggregate: async () => ({ _sum: { qtyIn: 0, qtyOut: 0 } }),
      },
      location: {
        findFirst: async () => ({ id: 1 }),
      },
    };
  }

  it("allows split WOs until total WO line qty reaches SO item qty, then blocks more", async () => {
    const existingWoLines = [{ id: 301, workOrderId: 201, fgItemId: 10, qty: "5000", plannedQty: "5000" }];
    const db = buildRegularSoPlanningDb(existingWoLines);

    const afterFirst = await getSalesOrderFgWorkOrderBalances(db, { salesOrderId: 1 });
    assert.equal(afterFirst.items[0].soOrderedQty, 10000);
    assert.equal(afterFirst.items[0].plannedOnOtherWorkOrdersQty, 5000);
    assert.equal(afterFirst.items[0].balanceQty, 5000);

    await assertWorkOrderLinesAgainstSalesOrder(db, {
      salesOrderId: 1,
      lineRequests: [{ fgItemId: 10, qty: 5000 }],
      excludeWorkOrderId: null,
    });

    existingWoLines.push({ id: 302, workOrderId: 202, fgItemId: 10, qty: "5000", plannedQty: "5000" });

    await assert.rejects(
      () =>
        assertWorkOrderLinesAgainstSalesOrder(db, {
          salesOrderId: 1,
          lineRequests: [{ fgItemId: 10, qty: 1 }],
          excludeWorkOrderId: null,
        }),
      /Maximum allowed now: 0/,
    );
  });
});

describe("draft SO qty floor (summed per item, not per-line dispatched)", () => {
  const itemA = 9001;

  it("duplicate FG lines: floor is item-level net dispatch; 10+90 passes when net dispatched is 50 (not per-line 50)", () => {
    const lines = [
      { id: 1, itemId: itemA, qty: 100 },
      { id: 2, itemId: itemA, qty: 100 },
    ];
    const proposed = new Map([
      [1, 10],
      [2, 90],
    ]);
    const net = new Map([[itemA, 50]]);
    const v = getDraftSoItemQtyFloorViolations({
      lines,
      proposedQtyByLineId: proposed,
      itemIdsToValidate: new Set([itemA]),
      netDispatchedByItemId: net,
      woPlannedByItemId: new Map([[itemA, 0]]),
      producedByItemId: new Map([[itemA, 0]]),
      eps: STOCK_EPS,
    });
    assert.equal(v.length, 0);
  });

  it("same scenario fails when summed proposed is below floor (would wrongly pass if each line only checked its own share)", () => {
    const lines = [
      { id: 1, itemId: itemA, qty: 100 },
      { id: 2, itemId: itemA, qty: 100 },
    ];
    const proposed = new Map([
      [1, 10],
      [2, 30],
    ]);
    const net = new Map([[itemA, 50]]);
    const v = getDraftSoItemQtyFloorViolations({
      lines,
      proposedQtyByLineId: proposed,
      itemIdsToValidate: new Set([itemA]),
      netDispatchedByItemId: net,
      woPlannedByItemId: new Map([[itemA, 0]]),
      producedByItemId: new Map([[itemA, 0]]),
      eps: STOCK_EPS,
    });
    assert.equal(v.length, 1);
    assert.equal(v[0].totalProposed, 40);
    assert.equal(v[0].floor, 50);
  });

  it("PATCH-style partial payload: only one line in itemIdsToValidate; other line keeps DB qty in sum", () => {
    const lines = [
      { id: 10, itemId: itemA, qty: 100 },
      { id: 20, itemId: itemA, qty: 100 },
    ];
    const proposed = new Map([
      [10, 10],
      [20, 100],
    ]);
    const net = new Map([[itemA, 50]]);
    const v = getDraftSoItemQtyFloorViolations({
      lines,
      proposedQtyByLineId: proposed,
      itemIdsToValidate: new Set([itemA]),
      netDispatchedByItemId: net,
      woPlannedByItemId: new Map([[itemA, 0]]),
      producedByItemId: new Map([[itemA, 0]]),
      eps: STOCK_EPS,
    });
    assert.equal(v.length, 0);
  });

  it("only touched lines in itemIdsToValidate: other item on SO is ignored even if payload map has updates", () => {
    const itemB = 9002;
    const lines = [
      { id: 1, itemId: itemA, qty: 50 },
      { id: 2, itemId: itemB, qty: 200 },
    ];
    const proposed = new Map([
      [1, 5],
      [2, 1],
    ]);
    const v = getDraftSoItemQtyFloorViolations({
      lines,
      proposedQtyByLineId: proposed,
      itemIdsToValidate: new Set([itemA]),
      netDispatchedByItemId: new Map([
        [itemA, 40],
        [itemB, 0],
      ]),
      woPlannedByItemId: new Map([
        [itemA, 0],
        [itemB, 0],
      ]),
      producedByItemId: new Map([
        [itemA, 0],
        [itemB, 0],
      ]),
      eps: STOCK_EPS,
    });
    assert.equal(v.length, 1);
    assert.equal(v[0].itemId, itemA);
  });

  it("floor uses max(dispatched, wo planned, produced)", () => {
    const lines = [{ id: 1, itemId: itemA, qty: 30 }];
    const proposed = new Map([[1, 25]]);
    const v = getDraftSoItemQtyFloorViolations({
      lines,
      proposedQtyByLineId: proposed,
      itemIdsToValidate: new Set([itemA]),
      netDispatchedByItemId: new Map([[itemA, 5]]),
      woPlannedByItemId: new Map([[itemA, 28]]),
      producedByItemId: new Map([[itemA, 0]]),
      eps: STOCK_EPS,
    });
    assert.equal(v.length, 1);
    assert.equal(v[0].floor, 28);
    const msg = formatDraftSoFloorViolationMessage(v[0]);
    assert.match(msg, /Minimum total for this item: 28/);
  });
});

describe("work-order-tracking summary consistency", () => {
  it("openWoLines matches non-COMPLETED row count; pending sums match row fields", () => {
    const rows = [
      {
        status: "COMPLETED",
        salesOrderId: 1,
        itemId: 10,
        orderedQty: 100,
        acceptedQty: 100,
        dispatchedQty: 100,
        productionPendingQty: 0,
        qcPendingQty: 0,
        dispatchPendingQty: 0,
      },
      {
        status: "IN_PRODUCTION",
        salesOrderId: 1,
        itemId: 11,
        orderedQty: 100,
        acceptedQty: 12,
        dispatchedQty: 10,
        productionPendingQty: 4,
        qcPendingQty: 0,
        dispatchPendingQty: 2,
      },
      {
        status: "PENDING_QC",
        salesOrderId: 1,
        itemId: 12,
        orderedQty: 50,
        acceptedQty: 20,
        dispatchedQty: 20,
        productionPendingQty: 0,
        qcPendingQty: 5,
        dispatchPendingQty: 0,
      },
    ];
    const summary = computeWorkOrderTrackingSummaryFromRows(rows);
    assert.equal(summary.openWoLines, 2);
    assert.equal(summary.pendingProductionQtySum, 4);
    assert.equal(summary.pendingQcQtySum, 5);
    assert.equal(summary.pendingDispatchQtySum, 2);
    const check = assertWorkOrderTrackingSummaryMatches(rows, summary);
    assert.equal(check.ok, true);
  });

  it("legacy array vs object payload yield same visible summary (contract with frontend normalizeWoTrackingApiResponse)", () => {
    const rows = [
      {
        status: "IN_PROCESS",
        salesOrderId: 2,
        itemId: 20,
        orderedQty: 100,
        acceptedQty: 13,
        dispatchedQty: 10,
        productionPendingQty: 1,
        qcPendingQty: 2,
        dispatchPendingQty: 3,
      },
      {
        status: "COMPLETED",
        salesOrderId: 2,
        itemId: 21,
        orderedQty: 50,
        acceptedQty: 50,
        dispatchedQty: 50,
        productionPendingQty: 0,
        qcPendingQty: 0,
        dispatchPendingQty: 0,
      },
    ];
    const computed = computeWorkOrderTrackingSummaryFromRows(rows);
    const fromArray = normalizeWorkOrderTrackingApiPayloadForVerification(rows);
    const fromObject = normalizeWorkOrderTrackingApiPayloadForVerification({ rows, summary: computed });
    const fromObjectNullSummary = normalizeWorkOrderTrackingApiPayloadForVerification({ rows, summary: null });
    assert.deepEqual(fromArray.summary, computed);
    assert.deepEqual(fromObject.summary, computed);
    assert.deepEqual(fromObjectNullSummary.summary, computed);
  });
});

describe("dashboard queue metric context map", () => {
  it("QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT aligns with METRIC_CONTEXT (single source for queue rows)", () => {
    assert.equal(QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT.dispatchBacklog, METRIC_CONTEXT.SO_FIFO);
    assert.equal(QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT.productionQueue, METRIC_CONTEXT.WO_LINE);
    assert.equal(QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT.qcQueue, METRIC_CONTEXT.QC_BATCH);
    assert.equal(QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT.rmRisk, METRIC_CONTEXT.RM_PLANNING);
    assert.equal(QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT.purchaseSummary, METRIC_CONTEXT.RM_PO_LINE);
  });

  it("work-order status filters handle HOLD and CLOSED_WITH_SHORTFALL explicitly", () => {
    assert.deepEqual(DASHBOARD_ACTIVE_WORK_ORDER_STATUSES, ["PENDING", "IN_PROGRESS", "HOLD"]);
    assert.deepEqual(DASHBOARD_RUNNING_WORK_ORDER_STATUSES, ["PENDING", "IN_PROGRESS"]);
    assert.ok(DASHBOARD_TERMINAL_WORK_ORDER_STATUSES.includes("CLOSED_WITH_SHORTFALL"));
    assert.deepEqual(dashboardActiveWorkOrderWhere(), {
      status: { in: ["PENDING", "IN_PROGRESS", "HOLD"] },
    });
    assert.deepEqual(dashboardRunningWorkOrderWhere(), {
      status: { in: ["PENDING", "IN_PROGRESS"] },
    });
    assert.equal(isDashboardHoldWorkOrderStatus("HOLD"), true);
    assert.equal(isDashboardTerminalWorkOrderStatus("CLOSED_WITH_SHORTFALL"), true);
  });
});

describe("operations-exception builders vs dashboard queue shapes", () => {
  const fixedT = new Date("2024-06-15T12:00:00.000Z").getTime();

  it("dispatch exceptions preserve quantityMetricContext and set exceptionClassificationContext (server-side severity inputs)", () => {
    const row = {
      salesOrderId: 1,
      salesOrderNo: "SO-1",
      customerName: "Acme",
      itemId: 1,
      itemName: "FG",
      orderedQty: 100,
      dispatchedQty: 20,
      pendingQty: 80,
      salesOrderDate: new Date("2024-05-01T12:00:00.000Z").toISOString(),
      status: "APPROVED",
      quantityMetricContext: QUEUE_SNAPSHOT_ROW_METRIC_CONTEXT.dispatchBacklog,
    };
    const out = buildDispatchExceptions([row], fixedT);
    assert.equal(out.length, 1);
    assert.equal(out[0].quantityMetricContext, METRIC_CONTEXT.SO_FIFO);
    assert.equal(out[0].exceptionClassificationContext, METRIC_CONTEXT.SO_FIFO);
    assert.ok(["WARNING", "CRITICAL"].includes(out[0].severity));
  });

  it("summary counts match exception array lengths and qc pending filter (no extra client formulas)", () => {
    const dRows = [
      {
        salesOrderId: 1,
        salesOrderNo: "SO-1",
        customerName: "A",
        itemId: 1,
        itemName: "X",
        orderedQty: 100,
        dispatchedQty: 0,
        pendingQty: 100,
        salesOrderDate: new Date("2024-01-01T00:00:00.000Z").toISOString(),
        status: "APPROVED",
        quantityMetricContext: METRIC_CONTEXT.SO_FIFO,
      },
    ];
    const pRows = [
      {
        workOrderId: 1,
        workOrderNo: "WO-1",
        salesOrderId: 1,
        salesOrderNo: "SO-1",
        itemId: 1,
        itemName: "X",
        requiredQty: 100,
        producedQty: 0,
        balanceQty: 100,
        status: "IN_PROCESS",
        workOrderDate: new Date("2024-01-01T00:00:00.000Z").toISOString(),
        quantityMetricContext: METRIC_CONTEXT.WO_LINE,
      },
    ];
    const qcRows = [
      {
        qcRef: "PE-1",
        workOrderId: 1,
        workOrderNo: "WO-1",
        salesOrderNo: "SO-1",
        itemId: 1,
        itemName: "X",
        producedQty: 10,
        acceptedQty: 0,
        rejectedQty: 0,
        pendingQcQty: 10,
        status: "PENDING_QC",
        qcDate: new Date().toISOString(),
        quantityMetricContext: METRIC_CONTEXT.QC_BATCH,
      },
      {
        qcRef: "PE-2",
        workOrderId: 1,
        workOrderNo: "WO-1",
        salesOrderNo: "SO-1",
        itemId: 1,
        itemName: "X",
        producedQty: 10,
        acceptedQty: 10,
        rejectedQty: 0,
        pendingQcQty: 0,
        status: "PARTIAL_QC",
        qcDate: new Date().toISOString(),
        quantityMetricContext: METRIC_CONTEXT.QC_BATCH,
      },
    ];
    const rmRows = [
      { itemId: 1, shortageQty: 5, status: "CRITICAL", quantityMetricContext: METRIC_CONTEXT.RM_PLANNING },
      { itemId: 2, shortageQty: 0, status: "LOW_BUFFER", quantityMetricContext: METRIC_CONTEXT.RM_PLANNING },
    ];
    const purchaseRows = [
      {
        purchaseOrderId: 1,
        purchaseOrderNo: "PO-1",
        supplierName: "S",
        itemId: 1,
        itemName: "RM",
        orderedQty: 100,
        receivedQty: 0,
        pendingQty: 100,
        status: "PENDING",
        purchaseDate: new Date("2024-01-01T00:00:00.000Z").toISOString(),
        quantityMetricContext: METRIC_CONTEXT.RM_PO_LINE,
      },
    ];
    const dEx = buildDispatchExceptions(dRows, fixedT);
    const pEx = buildProductionExceptions(pRows, fixedT);
    const qEx = buildQcExceptions(qcRows);
    const rEx = buildRmExceptions(rmRows);
    const purEx = buildPurchaseExceptions(purchaseRows, fixedT);
    const summary = buildExceptionSummary({
      dispatch: dEx,
      production: pEx,
      qc: qEx,
      rm: rEx,
      purchase: purEx,
    });
    assert.equal(summary.dispatchExceptionCount, dEx.length);
    assert.equal(summary.productionExceptionCount, pEx.length);
    assert.equal(summary.purchaseSummaryLineCount, purEx.length);
    assert.equal(summary.qcExceptionRowsWithPendingQc, qEx.filter((r) => r.pendingQcQty > ROW_NUM_EPS).length);
    assert.equal(summary.criticalRmItemCount, rEx.filter((r) => r.severity === "CRITICAL").length);
    assert.equal(pEx[0].exceptionClassificationContext, METRIC_CONTEXT.WO_LINE);
    assert.equal(qEx[0].exceptionClassificationContext, METRIC_CONTEXT.QC_BATCH);
    assert.equal(purEx[0].exceptionClassificationContext, METRIC_CONTEXT.RM_PO_LINE);
  });

  it("production exception severity stable for representative aged high-balance row", () => {
    const row = {
      workOrderId: 1,
      workOrderNo: "WO-1",
      salesOrderId: 1,
      salesOrderNo: "SO-1",
      itemId: 1,
      itemName: "X",
      requiredQty: 100,
      producedQty: 10,
      balanceQty: 90,
      status: "IN_PROCESS",
      workOrderDate: new Date("2024-01-01T00:00:00.000Z").toISOString(),
      quantityMetricContext: METRIC_CONTEXT.WO_LINE,
    };
    const t = new Date("2024-07-01T00:00:00.000Z").getTime();
    const out = buildProductionExceptions([row], t);
    assert.equal(out.length, 1);
    assert.equal(out[0].severity, "CRITICAL");
    assert.ok(out[0].exceptionBalanceShare >= OPERATIONS_EXCEPTION_CONFIG.production.balanceRatioCritical);
  });
});

describe("dispatch ledger reversals (net + FIFO attribution)", () => {
  it("mixed positive and negative rows yield correct net and non-negative per-line attribution", () => {
    const dispatch = [
      { itemId: 1, dispatchedQty: 100 },
      { itemId: 1, dispatchedQty: 30 },
      { itemId: 1, dispatchedQty: -40 },
    ];
    const net = netDispatchedByItemId(dispatch).get(1);
    assert.equal(net, 90);
    const lines = [
      { id: 1, itemId: 1, qty: 50 },
      { id: 2, itemId: 1, qty: 50 },
    ];
    const alloc = allocateDispatchAcrossSalesOrderLines(lines, dispatch);
    assert.ok((alloc.get(1) ?? 0) >= 0);
    assert.ok((alloc.get(2) ?? 0) >= 0);
    assert.equal((alloc.get(1) ?? 0) + (alloc.get(2) ?? 0), 90);
    assert.equal(alloc.get(1), 50);
    assert.equal(alloc.get(2), 40);
  });

  it("per-line attributed dispatch for duplicate item: net applies FIFO so second line can be zero", () => {
    const lines = [
      { id: 101, itemId: 3, qty: 60 },
      { id: 102, itemId: 3, qty: 40 },
    ];
    const dispatch = [{ itemId: 3, dispatchedQty: 25 }];
    assert.equal(getAttributedDispatchQtyForSalesOrderLine(lines, dispatch, 101), 25);
    assert.equal(getAttributedDispatchQtyForSalesOrderLine(lines, dispatch, 102), 0);
  });

  it("remaining capacity and line stats stay coherent after reversal (backlog/completion)", () => {
    const lines = [
      { id: 1, itemId: 7, qty: 40 },
      { id: 2, itemId: 7, qty: 40 },
    ];
    const dispatch = [
      { itemId: 7, dispatchedQty: 50 },
      { itemId: 7, dispatchedQty: -15 },
    ];
    assert.equal(netDispatchedByItemId(dispatch).get(7), 35);
    const cap = remainingDispatchCapacityForSoItem(lines, dispatch, 7);
    assert.equal(cap, 45);
    const { dispatchLineStats, dispatchSummary } = computeSalesOrderDispatchLineStats(lines, dispatch);
    assert.equal(dispatchSummary.totalDispatched, 35);
    const sumPending = dispatchLineStats.reduce((s, l) => s + l.pending, 0);
    assert.equal(sumPending + dispatchSummary.totalDispatched, dispatchSummary.totalOrdered);
    const pct = getSalesOrderDispatchCompletionPercent(dispatchLineStats);
    assert.ok(pct > 0 && pct <= 100);
  });

  it("negative net dispatch does not produce negative attributed qty on lines", () => {
    const lines = [{ id: 1, itemId: 3, qty: 10 }];
    const dispatch = [{ itemId: 3, dispatchedQty: 5 }, { itemId: 3, dispatchedQty: -20 }];
    assert.equal(netDispatchedByItemId(dispatch).get(3), -15);
    const alloc = allocateDispatchAcrossSalesOrderLines(lines, dispatch);
    assert.equal(alloc.get(1), 0);
    const { dispatchLineStats } = computeSalesOrderDispatchLineStats(lines, dispatch);
    assert.equal(dispatchLineStats[0].dispatched, 0);
    assert.equal(dispatchLineStats[0].pending, 10);
  });
});
