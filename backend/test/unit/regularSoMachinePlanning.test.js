/**
 * Focused tests: REGULAR_SO machine planning stages + role gates.
 * NO_QTY behaviour must remain untouched by these helpers.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  MACHINE_PLANNING_PENDING,
  MACHINE_PLANNING_IN_PROGRESS,
  MACHINE_PLANNING_COMPLETE,
  assessRegularSoMachinePlanning,
  filterSalesOrderIdsWithCompletedMachinePlanning,
} = require("../../src/services/regularSoMachinePlanningService");
const {
  WO_MACHINE_RUN_WRITE_ROLES,
  REGULAR_SO_WO_CREATE_ROLES,
  WO_WRITE_ROLES,
} = require("../../src/constants/erpRoles");
const {
  resolveWoPrepareOperationalForSalesOrder,
} = require("../../src/services/woPrepareOperationalQueue");

describe("REGULAR_SO machine planning roles", () => {
  it("Production may write machine runs but cannot create REGULAR WO", () => {
    assert.ok(WO_MACHINE_RUN_WRITE_ROLES.includes("PRODUCTION"));
    assert.ok(WO_MACHINE_RUN_WRITE_ROLES.includes("ADMIN"));
    assert.ok(!WO_MACHINE_RUN_WRITE_ROLES.includes("STORE"));
    assert.ok(REGULAR_SO_WO_CREATE_ROLES.includes("STORE"));
    assert.ok(REGULAR_SO_WO_CREATE_ROLES.includes("ADMIN"));
    assert.ok(!REGULAR_SO_WO_CREATE_ROLES.includes("PRODUCTION"));
    // PRODUCTION remains on WO_WRITE for NO_QTY / list access historically
    assert.ok(WO_WRITE_ROLES.includes("PRODUCTION"));
  });
});

describe("assessRegularSoMachinePlanning (derived stages)", () => {
  it("approved SO with no runs → MACHINE_PLANNING_PENDING", async () => {
    const db = {
      regularSoPlanningSnapshot: {
        findUnique: async () => null,
      },
      salesOrder: {
        findUnique: async () => ({
          id: 10,
          orderType: "NORMAL",
          docNo: "SO-10",
          requiredDeliveryDate: null,
          deliveryDate: null,
          lines: [
            {
              id: 1,
              itemId: 100,
              qty: 50,
              customerPoQty: 50,
              item: { itemType: "FG", itemName: "Widget" },
            },
          ],
        }),
      },
      bom: { findFirst: async () => null },
    };
    // buildRegularSoPlanningSnapshotView uses prisma utils — stub via module path is heavy;
    // call assess with a thin mock by monkey-patching the dependency.
    const svc = require("../../src/services/regularSoMachinePlanningService");
    const snapshotSvc = require("../../src/services/regularSoPlanningSnapshotService");
    const original = snapshotSvc.buildRegularSoPlanningSnapshotView;
    snapshotSvc.buildRegularSoPlanningSnapshotView = async () => ({
      salesOrderId: 10,
      orderType: "NORMAL",
      productionRuns: [],
      plannedPurgeCount: 0,
      productionRunCount: 0,
      lines: [
        {
          fgItemId: 100,
          fgName: "Widget",
          plannedProductionQty: 50,
          rmPlanningQty: 50,
          toProduce: 50,
        },
      ],
      salesOrder: { requiredDeliveryDate: null, deliveryDate: null },
    });
    try {
      const a = await assessRegularSoMachinePlanning(10, db);
      assert.equal(a.key, MACHINE_PLANNING_PENDING);
      assert.equal(a.machinePlanningComplete, false);
      assert.match(a.issues[0] || "", /Machine allocation pending/i);
    } finally {
      snapshotSvc.buildRegularSoPlanningSnapshotView = original;
    }
  });

  it("incomplete/stale runs → MACHINE_PLANNING_IN_PROGRESS", async () => {
    const snapshotSvc = require("../../src/services/regularSoPlanningSnapshotService");
    const woRuns = require("../../src/services/woProductionRunAllocationService");
    const originalView = snapshotSvc.buildRegularSoPlanningSnapshotView;
    const originalValidate = woRuns.validateAndEnrichProductionRuns;
    snapshotSvc.buildRegularSoPlanningSnapshotView = async () => ({
      salesOrderId: 11,
      orderType: "NORMAL",
      productionRuns: [
        {
          fgItemId: 100,
          machineId: 1,
          plannedQty: 10,
          runSequence: 1,
        },
      ],
      plannedPurgeCount: 0,
      productionRunCount: 1,
      lines: [{ fgItemId: 100, fgName: "Widget", plannedProductionQty: 50, rmPlanningQty: 50 }],
      salesOrder: {},
    });
    woRuns.validateAndEnrichProductionRuns = async () => {
      const err = new Error("Allocated quantity (10) must equal planned WO quantity (50)");
      err.statusCode = 400;
      err.code = "PRODUCTION_RUN_QTY_MISMATCH";
      throw err;
    };
    try {
      const a = await assessRegularSoMachinePlanning(11, {});
      assert.equal(a.key, MACHINE_PLANNING_IN_PROGRESS);
      assert.equal(a.machinePlanningComplete, false);
    } finally {
      snapshotSvc.buildRegularSoPlanningSnapshotView = originalView;
      woRuns.validateAndEnrichProductionRuns = originalValidate;
    }
  });

  it("valid runs without Complete click → AWAITING_COMPLETION (not Ready for WO)", async () => {
    const snapshotSvc = require("../../src/services/regularSoPlanningSnapshotService");
    const woRuns = require("../../src/services/woProductionRunAllocationService");
    const originalView = snapshotSvc.buildRegularSoPlanningSnapshotView;
    const originalValidate = woRuns.validateAndEnrichProductionRuns;
    snapshotSvc.buildRegularSoPlanningSnapshotView = async () => ({
      salesOrderId: 12,
      orderType: "NORMAL",
      machinePlanningCompleted: false,
      productionRuns: [
        { fgItemId: 100, machineId: 1, plannedQty: 50, runSequence: 1, purgingRequired: true },
      ],
      lines: [{ fgItemId: 100, fgName: "Widget", plannedProductionQty: 50 }],
      salesOrder: {},
    });
    woRuns.validateAndEnrichProductionRuns = async () => ({
      enriched: [{ fgItemId: 100, machineId: 1, plannedQty: 50, runSequence: 1, purgingRequired: true }],
      productionRunCount: 1,
      plannedPurgeCount: 1,
      purgeCountByFgItemId: new Map([[100, 1]]),
    });
    try {
      const a = await assessRegularSoMachinePlanning(12, {});
      assert.equal(a.key, "MACHINE_PLANNING_AWAITING_COMPLETION");
      assert.equal(a.machinePlanningComplete, false);
    } finally {
      snapshotSvc.buildRegularSoPlanningSnapshotView = originalView;
      woRuns.validateAndEnrichProductionRuns = originalValidate;
    }
  });

  it("valid runs + Complete handoff → MACHINE_PLANNING_COMPLETE (not READY_FOR_WO yet)", async () => {
    const snapshotSvc = require("../../src/services/regularSoPlanningSnapshotService");
    const woRuns = require("../../src/services/woProductionRunAllocationService");
    const originalView = snapshotSvc.buildRegularSoPlanningSnapshotView;
    const originalValidate = woRuns.validateAndEnrichProductionRuns;
    snapshotSvc.buildRegularSoPlanningSnapshotView = async () => ({
      salesOrderId: 12,
      orderType: "NORMAL",
      machinePlanningCompleted: true,
      productionRuns: [
        { fgItemId: 100, machineId: 1, plannedQty: 50, runSequence: 1, purgingRequired: true },
      ],
      lines: [{ fgItemId: 100, fgName: "Widget", plannedProductionQty: 50 }],
      salesOrder: {},
    });
    woRuns.validateAndEnrichProductionRuns = async () => ({
      enriched: [{ fgItemId: 100, machineId: 1, plannedQty: 50, runSequence: 1, purgingRequired: true }],
      productionRunCount: 1,
      plannedPurgeCount: 1,
      purgeCountByFgItemId: new Map([[100, 1]]),
    });
    try {
      const a = await assessRegularSoMachinePlanning(12, {});
      assert.equal(a.key, MACHINE_PLANNING_COMPLETE);
      assert.equal(a.machinePlanningComplete, true);
    } finally {
      snapshotSvc.buildRegularSoPlanningSnapshotView = originalView;
      woRuns.validateAndEnrichProductionRuns = originalValidate;
    }
  });
});

describe("filterSalesOrderIdsWithCompletedMachinePlanning", () => {
  it("passes NO_QTY through; filters REGULAR without complete planning", async () => {
    const snapshotSvc = require("../../src/services/regularSoPlanningSnapshotService");
    const originalView = snapshotSvc.buildRegularSoPlanningSnapshotView;
    snapshotSvc.buildRegularSoPlanningSnapshotView = async (id) => ({
      salesOrderId: id,
      orderType: "NORMAL",
      productionRuns: [],
      lines: [{ fgItemId: 1, plannedProductionQty: 10 }],
      salesOrder: {},
    });
    const db = {
      salesOrder: {
        findMany: async () => [
          { id: 1, orderType: "NORMAL" },
          { id: 2, orderType: "NO_QTY" },
        ],
      },
      bom: { findFirst: async () => null },
    };
    try {
      const ids = await filterSalesOrderIdsWithCompletedMachinePlanning(db, [1, 2]);
      assert.deepEqual(ids, [2]);
    } finally {
      snapshotSvc.buildRegularSoPlanningSnapshotView = originalView;
    }
  });
});

describe("resolveWoPrepareOperationalForSalesOrder machine gate", () => {
  it("does not return READY_FOR_WO when machine planning is pending", async () => {
    const snapshotSvc = require("../../src/services/regularSoPlanningSnapshotService");
    const originalView = snapshotSvc.buildRegularSoPlanningSnapshotView;
    snapshotSvc.buildRegularSoPlanningSnapshotView = async () => ({
      salesOrderId: 99,
      orderType: "NORMAL",
      productionRuns: [],
      lines: [{ fgItemId: 1, fgName: "A", plannedProductionQty: 5, rmPlanningQty: 5 }],
      salesOrder: {},
    });
    try {
      const op = await resolveWoPrepareOperationalForSalesOrder(
        {
          id: 99,
          orderType: "NORMAL",
          processStage: { key: "WO_PENDING" },
          lines: [{ item: { itemType: "FG", itemName: "A" } }],
        },
        { bom: { findFirst: async () => null } },
      );
      assert.equal(op.key, MACHINE_PLANNING_PENDING);
      assert.equal(op.nextActionKey, "PLAN_MACHINE_RUNS");
      assert.equal(op.canCreateWorkOrder, false);
      assert.notEqual(op.key, "READY_FOR_WO");
    } finally {
      snapshotSvc.buildRegularSoPlanningSnapshotView = originalView;
    }
  });
});

describe("Store handoff after completed machine planning", () => {
  const snapshotSvc = require("../../src/services/regularSoPlanningSnapshotService");
  const woRuns = require("../../src/services/woProductionRunAllocationService");
  const materialPlanning = require("../../src/services/materialPlanningService");
  const rmCheck = require("../../src/services/rmCheckService");

  function stubMachineComplete() {
    const originalView = snapshotSvc.buildRegularSoPlanningSnapshotView;
    const originalValidate = woRuns.validateAndEnrichProductionRuns;
    snapshotSvc.buildRegularSoPlanningSnapshotView = async () => ({
      salesOrderId: 50,
      orderType: "NORMAL",
      machinePlanningCompleted: true,
      productionRuns: [
        { fgItemId: 100, machineId: 1, plannedQty: 50, runSequence: 1, purgingRequired: true },
      ],
      lines: [{ fgItemId: 100, fgName: "Widget", plannedProductionQty: 50, rmPlanningQty: 50 }],
      salesOrder: {},
    });
    woRuns.validateAndEnrichProductionRuns = async () => ({
      enriched: [{ fgItemId: 100, machineId: 1, plannedQty: 50, runSequence: 1, purgingRequired: true }],
      productionRunCount: 1,
      plannedPurgeCount: 1,
      purgeCountByFgItemId: new Map([[100, 1]]),
    });
    return () => {
      snapshotSvc.buildRegularSoPlanningSnapshotView = originalView;
      woRuns.validateAndEnrichProductionRuns = originalValidate;
    };
  }

  it("valid machine planning + RM shortage appears for Store (not Production planning)", async () => {
    const restoreMachine = stubMachineComplete();
    const originalFg = rmCheck.computeFgGapLinesForSalesOrder;
    const originalReady = materialPlanning.evaluateWoPrepareReadiness;
    rmCheck.computeFgGapLinesForSalesOrder = async () => ({
      fgLines: [{ lineId: 1, fgItemId: 100, fgName: "Widget", toProduce: 50 }],
    });
    materialPlanning.evaluateWoPrepareReadiness = async () => ({
      canCreateWorkOrder: false,
      woBlockReason: "RM shortage",
      totalShortageLines: 1,
      materialReadiness: { shortageRmCount: 1 },
      pendingMaterialRequirements: [],
      fgSummary: [{ fgQty: 50, fgName: "Widget" }],
      rmSummary: [
        {
          rmItemId: 9,
          itemName: "Resin",
          unit: "Kg",
          requiredQty: 100,
          availableQty: 40,
          shortageQty: 60,
        },
      ],
    });
    try {
      const op = await resolveWoPrepareOperationalForSalesOrder(
        {
          id: 50,
          orderType: "NORMAL",
          processStage: { key: "WO_PENDING" },
          lines: [{ item: { itemType: "FG", itemName: "Widget" } }],
        },
        { bom: { findFirst: async () => null } },
      );
      assert.equal(op.machinePlanningComplete, true);
      assert.equal(op.key, "RM_SHORTAGE");
      assert.equal(op.nextActionKey, "RAISE_MR");
      assert.equal(op.canCreateWorkOrder, false);
      assert.equal(op.rmRequiredQtyTotal, 100);
      assert.equal(op.rmAvailableQtyTotal, 40);
      assert.equal(op.rmShortageQtyTotal, 60);
      assert.equal(op.rmShortageLines.length, 1);
      // RM shortage must not reopen machine planning
      assert.notEqual(op.key, MACHINE_PLANNING_PENDING);
      assert.notEqual(op.key, MACHINE_PLANNING_IN_PROGRESS);
      assert.notEqual(op.nextActionKey, "PLAN_MACHINE_RUNS");
    } finally {
      restoreMachine();
      rmCheck.computeFgGapLinesForSalesOrder = originalFg;
      materialPlanning.evaluateWoPrepareReadiness = originalReady;
    }
  });

  it("Store sees shortage but cannot create WO; stock readiness → READY_FOR_WO", async () => {
    const restoreMachine = stubMachineComplete();
    const originalFg = rmCheck.computeFgGapLinesForSalesOrder;
    const originalReady = materialPlanning.evaluateWoPrepareReadiness;
    rmCheck.computeFgGapLinesForSalesOrder = async () => ({
      fgLines: [{ lineId: 1, fgItemId: 100, fgName: "Widget", toProduce: 50 }],
    });

    materialPlanning.evaluateWoPrepareReadiness = async () => ({
      canCreateWorkOrder: false,
      woBlockReason: "RM shortage",
      totalShortageLines: 1,
      materialReadiness: { shortageRmCount: 1 },
      pendingMaterialRequirements: [],
      fgSummary: [{ fgQty: 50, fgName: "Widget" }],
      rmSummary: [{ rmItemId: 9, itemName: "Resin", requiredQty: 10, availableQty: 0, shortageQty: 10 }],
    });
    try {
      const short = await resolveWoPrepareOperationalForSalesOrder(
        { id: 50, orderType: "NORMAL", processStage: { key: "WO_PENDING" }, lines: [{ item: { itemType: "FG" } }] },
        { bom: { findFirst: async () => null } },
      );
      assert.equal(short.key, "RM_SHORTAGE");
      assert.equal(short.canCreateWorkOrder, false);
      assert.equal(short.machinePlanningComplete, true);

      materialPlanning.evaluateWoPrepareReadiness = async () => ({
        canCreateWorkOrder: true,
        woBlockReason: null,
        totalShortageLines: 0,
        materialReadiness: { shortageRmCount: 0 },
        pendingMaterialRequirements: [],
        fgSummary: [{ fgQty: 50, fgName: "Widget" }],
        rmSummary: [{ rmItemId: 9, itemName: "Resin", requiredQty: 10, availableQty: 10, shortageQty: 0 }],
      });
      const ready = await resolveWoPrepareOperationalForSalesOrder(
        { id: 50, orderType: "NORMAL", processStage: { key: "WO_PENDING" }, lines: [{ item: { itemType: "FG" } }] },
        { bom: { findFirst: async () => null } },
      );
      assert.equal(ready.key, "READY_FOR_WO");
      assert.equal(ready.nextActionKey, "CREATE_WO");
      assert.equal(ready.canCreateWorkOrder, true);
      assert.equal(ready.machinePlanningComplete, true);
    } finally {
      restoreMachine();
      rmCheck.computeFgGapLinesForSalesOrder = originalFg;
      materialPlanning.evaluateWoPrepareReadiness = originalReady;
    }
  });

  it("RM shortage does not invalidate completed machine planning assessment", async () => {
    const restoreMachine = stubMachineComplete();
    try {
      const a = await assessRegularSoMachinePlanning(50, { bom: { findFirst: async () => null } });
      assert.equal(a.key, MACHINE_PLANNING_COMPLETE);
      assert.equal(a.machinePlanningComplete, true);
    } finally {
      restoreMachine();
    }
  });

  it("Store creates WO only when ready (role + gate)", () => {
    assert.ok(REGULAR_SO_WO_CREATE_ROLES.includes("STORE"));
    assert.ok(!REGULAR_SO_WO_CREATE_ROLES.includes("PRODUCTION"));
  });
});

describe("getRegularSoMachinePlanningQueue RM preview before machine planning complete", () => {
  const snapshotSvc = require("../../src/services/regularSoPlanningSnapshotService");
  const materialPlanning = require("../../src/services/materialPlanningService");
  const rmCheck = require("../../src/services/rmCheckService");
  const {
    getRegularSoMachinePlanningQueue,
  } = require("../../src/services/regularSoMachinePlanningService");

  it("pending planning + sufficient RM shows RM Available and never Ready for WO", async () => {
    const originalView = snapshotSvc.buildRegularSoPlanningSnapshotView;
    const originalFg = rmCheck.computeFgGapLinesForSalesOrder;
    const originalReady = materialPlanning.evaluateWoPrepareReadiness;

    snapshotSvc.buildRegularSoPlanningSnapshotView = async () => ({
      salesOrderId: 77,
      orderType: "NORMAL",
      productionRuns: [],
      lines: [{ fgItemId: 1, fgName: "FG-A", plannedProductionQty: 10, rmPlanningQty: 10 }],
      salesOrder: {},
    });
    rmCheck.computeFgGapLinesForSalesOrder = async () => ({
      fgLines: [{ lineId: 1, fgItemId: 1, fgName: "FG-A", toProduce: 10 }],
    });
    materialPlanning.evaluateWoPrepareReadiness = async () => ({
      canCreateWorkOrder: true, // stock alone must not mean Ready for WO
      woBlockReason: null,
      totalShortageLines: 0,
      materialReadiness: { shortageRmCount: 0 },
      pendingMaterialRequirements: [],
      rmSummary: [
        {
          rmItemId: 2,
          itemName: "RM-A",
          unit: "Kg",
          requiredQty: 5,
          availableQty: 20,
          shortageQty: 0,
        },
      ],
    });

    const db = {
      salesOrder: {
        findMany: async () => [
          {
            id: 77,
            docNo: "SO-77",
            orderType: "NORMAL",
            internalStatus: "APPROVED",
            po: null,
            lines: [{ item: { itemType: "FG", itemName: "FG-A" } }],
          },
        ],
      },
      bom: { findFirst: async () => null },
    };

    try {
      const queue = await getRegularSoMachinePlanningQueue(db, { limit: 10 });
      assert.equal(queue.needsPlanning.length, 1);
      const row = queue.needsPlanning[0];
      assert.equal(row.machinePlanningComplete, false);
      assert.equal(row.rmReadinessSummary.canCreateWorkOrder, false);
      assert.equal(row.rmReadinessSummary.storeOperationalKey, "RM_AVAILABLE");
      assert.equal(row.rmReadinessSummary.storeOperationalLabel, "RM Available");
      assert.notEqual(row.storeOperationalKey, "READY_FOR_WO");
      assert.equal(queue.handedToStore.length, 0);
    } finally {
      snapshotSvc.buildRegularSoPlanningSnapshotView = originalView;
      rmCheck.computeFgGapLinesForSalesOrder = originalFg;
      materialPlanning.evaluateWoPrepareReadiness = originalReady;
    }
  });

  it("Ready for WO requires completed machine planning in queue handoff", async () => {
    const originalView = snapshotSvc.buildRegularSoPlanningSnapshotView;
    const originalValidate = require("../../src/services/woProductionRunAllocationService")
      .validateAndEnrichProductionRuns;
    const originalFg = rmCheck.computeFgGapLinesForSalesOrder;
    const originalReady = materialPlanning.evaluateWoPrepareReadiness;
    const woRuns = require("../../src/services/woProductionRunAllocationService");

    snapshotSvc.buildRegularSoPlanningSnapshotView = async () => ({
      salesOrderId: 88,
      orderType: "NORMAL",
      machinePlanningCompleted: true,
      productionRuns: [
        { fgItemId: 1, machineId: 1, plannedQty: 10, runSequence: 1, purgingRequired: false },
      ],
      lines: [{ fgItemId: 1, fgName: "FG-A", plannedProductionQty: 10, rmPlanningQty: 10 }],
      salesOrder: {},
    });
    woRuns.validateAndEnrichProductionRuns = async () => ({
      enriched: [{ fgItemId: 1, machineId: 1, plannedQty: 10, runSequence: 1, purgingRequired: false }],
      productionRunCount: 1,
      plannedPurgeCount: 0,
      purgeCountByFgItemId: new Map(),
    });
    rmCheck.computeFgGapLinesForSalesOrder = async () => ({
      fgLines: [{ lineId: 1, fgItemId: 1, fgName: "FG-A", toProduce: 10 }],
    });
    materialPlanning.evaluateWoPrepareReadiness = async () => ({
      canCreateWorkOrder: true,
      woBlockReason: null,
      totalShortageLines: 0,
      materialReadiness: { shortageRmCount: 0 },
      pendingMaterialRequirements: [],
      fgSummary: [{ fgQty: 10, fgName: "FG-A" }],
      rmSummary: [
        {
          rmItemId: 2,
          itemName: "RM-A",
          requiredQty: 5,
          availableQty: 20,
          shortageQty: 0,
        },
      ],
    });

    const db = {
      salesOrder: {
        findMany: async () => [
          {
            id: 88,
            docNo: "SO-88",
            orderType: "NORMAL",
            internalStatus: "APPROVED",
            po: null,
            lines: [{ item: { itemType: "FG", itemName: "FG-A" } }],
          },
        ],
      },
      bom: { findFirst: async () => ({ id: 1, revision: "A" }) },
    };

    try {
      const queue = await getRegularSoMachinePlanningQueue(db, { limit: 10 });
      assert.equal(queue.handedToStore.length, 1);
      const row = queue.handedToStore[0];
      assert.equal(row.machinePlanningComplete, true);
      assert.equal(row.rmReadinessSummary.canCreateWorkOrder, true);
      assert.equal(row.storeOperationalKey, "READY_FOR_WO");
    } finally {
      snapshotSvc.buildRegularSoPlanningSnapshotView = originalView;
      woRuns.validateAndEnrichProductionRuns = originalValidate;
      rmCheck.computeFgGapLinesForSalesOrder = originalFg;
      materialPlanning.evaluateWoPrepareReadiness = originalReady;
    }
  });
});

describe("reopenRegularSoMachinePlanning", () => {
  it("clears handoff when Production reopens with reason", async () => {
    const snapshotSvc = require("../../src/services/regularSoPlanningSnapshotService");
    const updated = await snapshotSvc.reopenRegularSoMachinePlanning(
      {
        salesOrderId: 55,
        reason: "Need to change machine allocation",
        createdByUserId: 9,
        actorRole: "PRODUCTION",
        user: { userId: 9, role: "PRODUCTION", name: "Prod" },
      },
      {
        workOrder: { findFirst: async () => null },
        regularSoPlanningSnapshot: {
          findUnique: async () => ({
            salesOrderId: 55,
            machinePlanningCompleted: true,
            machinePlanningCompletedAt: new Date("2026-08-20T10:00:00Z"),
            machinePlanningCompletedByUserId: 3,
          }),
          update: async ({ data }) => {
            assert.equal(data.machinePlanningCompleted, false);
            assert.equal(data.machinePlanningCompletedAt, null);
            return {
              salesOrderId: 55,
              ...data,
              salesOrder: { id: 55, docNo: "SO-55" },
              productionRuns: [],
              lines: [],
            };
          },
        },
      },
    );
    assert.equal(updated.machinePlanningCompleted, false);
  });

  it("blocks reopen when a Work Order already exists", async () => {
    const snapshotSvc = require("../../src/services/regularSoPlanningSnapshotService");
    await assert.rejects(
      () =>
        snapshotSvc.reopenRegularSoMachinePlanning(
          {
            salesOrderId: 56,
            reason: "Too late",
            actorRole: "ADMIN",
          },
          {
            workOrder: {
              findFirst: async () => ({ id: 900, docNo: "WO-900" }),
            },
            regularSoPlanningSnapshot: {
              findUnique: async () => ({ machinePlanningCompleted: true }),
            },
          },
        ),
      (err) => err && err.code === "MACHINE_PLANNING_WO_EXISTS",
    );
  });

  it("rejects STORE role", async () => {
    const snapshotSvc = require("../../src/services/regularSoPlanningSnapshotService");
    await assert.rejects(
      () =>
        snapshotSvc.reopenRegularSoMachinePlanning(
          { salesOrderId: 57, reason: "Nope", actorRole: "STORE" },
          {
            workOrder: { findFirst: async () => null },
            regularSoPlanningSnapshot: {
              findUnique: async () => ({ machinePlanningCompleted: true }),
            },
          },
        ),
      (err) => err && err.statusCode === 403,
    );
  });
});
