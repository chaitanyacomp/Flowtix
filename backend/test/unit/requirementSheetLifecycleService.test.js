const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  assertNoLockedOrCancelledSheetForCyclePeriod,
  evaluateRequirementSheetCancellation,
  cancelLockedRequirementSheet,
  RequirementSheetLifecycleError,
  cycleLockedCreateMessage,
} = require("../../src/services/requirementSheetLifecycleService");

const sheet = { id: 1, status: "LOCKED", salesOrderId: 5, cycleId: 10, salesOrder: { orderType: "NO_QTY" } };

function cancellationDb(overrides = {}) {
  const db = {
    requirementSheet: { findUnique: async () => sheet, update: async ({ data }) => ({ ...sheet, ...data, salesOrder: { id: 5, docNo: "SO-5" }, cycle: { id: 10, cycleNo: 1 } }) },
    workOrder: { findMany: async () => [] },
    materialIssueNote: { findMany: async () => [] },
    materialReturnNote: { findMany: async () => [] },
    productionEntry: { findMany: async () => [] },
    qcEntry: { findMany: async () => [] },
    dispatch: { findMany: async () => [] },
    salesBill: { findMany: async () => [] },
    monthlyPlanRequirementCoverage: { findMany: async () => [] },
    recoveryAllocation: { findMany: async () => [] },
    noQtyRsItemRecoveryDecision: { findMany: async () => [] },
    carryForwardPending: { findMany: async () => [] },
    materialRequirement: { findMany: async () => [] },
    grn: { findMany: async () => [] },
    stockTransaction: { count: async () => 0 },
  };
  for (const [model, methods] of Object.entries(overrides)) db[model] = { ...(db[model] || {}), ...methods };
  return db;
}

describe("Requirement Sheet create guard", () => {
  it("blocks a second locked RS", async () => {
    const db = cancellationDb({
      salesOrderCycle: { findUnique: async () => ({ cycleNo: 1 }) },
      requirementSheet: { findFirst: async () => ({ id: 100, docNo: "RS-100" }) },
    });
    await assert.rejects(
      () => assertNoLockedOrCancelledSheetForCyclePeriod(db, { salesOrderId: 5, cycleId: 10, periodKey: "2026-06" }),
      (e) => e instanceof RequirementSheetLifecycleError && e.code === "CYCLE_ALREADY_LOCKED",
    );
  });

  it("treats cancelled RS as history so a fresh RS can be created", async () => {
    const db = cancellationDb({
      salesOrderCycle: { findUnique: async () => ({ cycleNo: 1 }) },
      requirementSheet: { findFirst: async () => null },
    });
    await assertNoLockedOrCancelledSheetForCyclePeriod(db, { salesOrderId: 5, cycleId: 10, periodKey: "2026-06" });
  });

  it("keeps the cycle number in the locked message", () => assert.match(cycleLockedCreateMessage(1), /Cycle 1 is already locked/));
});

describe("Admin Requirement Sheet Cancel/Reopen downstream policy", () => {
  it("A. locked RS with no downstream succeeds and leaves SO eligible", async () => {
    const db = cancellationDb();
    const evaluation = await evaluateRequirementSheetCancellation(db, 1);
    assert.equal(evaluation.allowed, true);
    const result = await cancelLockedRequirementSheet(db, { sheetId: 1, actorUserId: 9, reason: "Replan" });
    assert.equal(result.sheet.status, "CANCELLED");
    assert.equal(result.sheet.cancelledByUserId, 9);
  });

  it("B. any linked WO blocks, regardless of WO status", async () => {
    const result = await evaluateRequirementSheetCancellation(cancellationDb({ workOrder: { findMany: async () => [{ id: 50, docNo: "WO-50" }] } }), 1);
    assert.equal(result.code, "DOWNSTREAM_EXISTS");
    assert.match(result.message, /Work Orders \(1\)/);
  });

  it("C. Material Issue is listed as a blocker", async () => {
    const db = cancellationDb({
      workOrder: { findMany: async () => [{ id: 50 }] },
      materialIssueNote: { findMany: async () => [{ id: 60, docNo: "MIN-60" }] },
    });
    const result = await evaluateRequirementSheetCancellation(db, 1);
    assert.match(result.message, /Material Issues \(1\)/);
    assert.ok(result.details.blockers.some((b) => b.code === "MATERIAL_ISSUE_EXISTS"));
  });

  it("D/E. Production and QC are both reported, not short-circuited", async () => {
    const db = cancellationDb({
      workOrder: { findMany: async () => [{ id: 50 }] },
      productionEntry: { findMany: async () => [{ id: 70, docNo: "PE-70" }] },
      qcEntry: { findMany: async () => [{ id: 80, docNo: "QC-80" }] },
    });
    const result = await evaluateRequirementSheetCancellation(db, 1);
    assert.match(result.message, /Production Entries \(1\)/);
    assert.match(result.message, /QC Entries \(1\)/);
  });

  it("F. Dispatch blocks", async () => {
    const result = await evaluateRequirementSheetCancellation(cancellationDb({ dispatch: { findMany: async () => [{ id: 90, docNo: "D-90" }] } }), 1);
    assert.match(result.message, /Dispatches \(1\)/);
  });

  it("G. RS-derived procurement documents block and use supplierPoNumber", async () => {
    const db = cancellationDb({
      monthlyPlanRequirementCoverage: { findMany: async () => [{ id: 2, planId: 3, plan: { id: 3, docNo: "MPP-3" } }] },
      materialRequirement: { findMany: async () => [{
        id: 4, docNo: "MR-4", lines: [{
          purchaseRequestSourceLinks: [{ purchaseRequestLine: { purchaseRequest: { id: 5, docNo: "PR-5" } } }],
          procurementLinks: [{ rmPoLine: { rmPo: { id: 6, supplierPoNumber: "SUP-PO-6" } } }],
        }],
      }] },
    });
    const result = await evaluateRequirementSheetCancellation(db, 1);
    assert.match(result.message, /Purchase Orders \(1\)/);
    assert.deepEqual(result.details.blockers.find((b) => b.code === "PURCHASE_ORDER_EXISTS").references, ["SUP-PO-6"]);
  });

  it("reports stock transactions and all blockers in one business result", async () => {
    const db = cancellationDb({
      workOrder: { findMany: async () => [{ id: 50 }] },
      productionEntry: { findMany: async () => [{ id: 70 }] },
      stockTransaction: { count: async () => 3 },
    });
    const result = await evaluateRequirementSheetCancellation(db, 1);
    assert.match(result.message, /Work Orders \(1\).*Production Entries \(1\).*Stock Transactions \(3\)/);
  });

  it("H. Prisma/schema validation errors fail closed as a business result", async () => {
    const error = Object.assign(new Error("Unknown field 'docNo'"), { code: "P2009" });
    const result = await evaluateRequirementSheetCancellation(cancellationDb({ monthlyPlanRequirementCoverage: { findMany: async () => { throw error; } } }), 1);
    assert.equal(result.allowed, false);
    assert.equal(result.code, "VALIDATION_FAILED");
    assert.match(result.message, /No changes were made/);
  });
});
