const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  regularWoLifecycleActions,
  reopenRegularWorkOrder,
} = require("../../src/services/workOrderLifecycleService");

function makeDb(opts = {}) {
  const writes = { workOrder: [], execution: [], lines: [], audits: [] };
  const closedAt = new Date("2026-07-20T10:00:00Z");
  const wo = {
    id: 10,
    docNo: "WO-26-0001",
    status: opts.status ?? "CLOSED_WITH_SHORTFALL",
    requirementSheetId: opts.noQty ? 5 : null,
    cycleId: opts.noQty ? 3 : null,
    salesOrderId: 1,
    shortfallQty: "13545",
    closureReason: "Customer stopped",
    closedAt,
    closedByUserId: 8,
    salesOrder: { id: 1, docNo: "SO-26-0001", orderType: opts.noQty ? "NO_QTY" : "NORMAL" },
    lines: [{ id: 100, fgItemId: 7, fgItem: { id: 7, itemName: "FG" } }],
  };
  const db = {
    workOrder: {
      findUnique: async ({ select }) => select
        ? {
            status: wo.status,
            shortfallQty: wo.shortfallQty,
            closureReason: wo.closureReason,
            closedAt: wo.closedAt,
            closedByUserId: wo.closedByUserId,
          }
        : wo,
      update: async ({ data }) => {
        writes.workOrder.push(data);
        return { ...wo, ...data };
      },
    },
    workOrderLine: {
      updateMany: async ({ data }) => {
        writes.lines.push(data);
        return { count: 1 };
      },
    },
    workOrderProductionExecution: {
      upsert: async (args) => {
        writes.execution.push(args);
        return args.update;
      },
    },
    productionEntry: {
      count: async ({ where }) => where?.date?.gt ? (opts.laterProduction ?? 0) : 1,
    },
    qcEntry: {
      count: async ({ where }) => where?.date?.gt ? (opts.laterQc ?? 0) : 1,
    },
    productionMaterialRequest: { count: async () => 1 },
    materialIssueNote: {
      count: async ({ where }) => where?.createdAt?.gt ? (opts.laterIssue ?? 0) : 1,
    },
    materialAllocation: { count: async () => 1 },
    productionWorkOrderReport: { count: async () => opts.reportCount ?? 1 },
    dispatch: {
      findMany: async () => opts.dispatch
        ? [{ id: 90, docNo: "DT-1", workflowStatus: opts.dispatchStatus ?? "LOCKED" }]
        : [],
    },
    salesBill: {
      count: async ({ where }) => {
        const exported = JSON.stringify(where).includes("isExported");
        return exported ? (opts.tally ?? 0) : (opts.salesBill ?? 0);
      },
    },
    auditLog: {
      create: async ({ data }) => {
        writes.audits.push(data);
        return { id: 1 };
      },
    },
  };
  return { db, writes, wo };
}

describe("Admin-only accidental Regular WO shortage reopen", () => {
  it("forbids non-Admin and rejects a missing reason", async () => {
    const { db } = makeDb();
    const actions = await regularWoLifecycleActions(db, 10, "PRODUCTION");
    assert.equal(actions.reopen.enabled, false);
    assert.ok(actions.reopen.blockers.includes("User lacks permission"));
    await assert.rejects(
      () => reopenRegularWorkOrder(db, 10, { reason: " ", actorUserId: 9, actorRole: "ADMIN" }),
      (err) => err.code === "REGULAR_WO_REOPEN_REASON_REQUIRED",
    );
  });

  it("reopens safely without rewriting production, report, stock, or returned RM", async () => {
    const { db, writes } = makeDb();
    const updated = await reopenRegularWorkOrder(db, 10, {
      reason: "Operator selected permanent close accidentally",
      actorUserId: 9,
      actorRole: "ADMIN",
    });
    assert.equal(updated.status, "IN_PROGRESS");
    assert.equal(writes.workOrder[0].materialReleasedToProductionAt, null);
    assert.equal(writes.execution[0].update.executionStatus, "RUNNING");
    assert.match(writes.execution[0].update.blockRemarks, /Store must reissue/);
    assert.equal(writes.audits.length, 1);
    assert.equal(writes.audits[0].payload.productionReportPreserved, true);
    assert.equal(writes.audits[0].payload.approvedProductionPreserved, true);
    assert.equal(writes.audits[0].payload.stockReposted, false);
    assert.equal(db.productionEntry.deleteMany, undefined);
    assert.equal(db.productionWorkOrderReport.deleteMany, undefined);
  });

  for (const [label, option, expected] of [
    ["dispatch", { dispatch: true }, "dispatch exists against produced stock"],
    ["sales bill", { salesBill: 1 }, "sales bill exists"],
    ["Tally export", { tally: 1 }, "Tally export exists"],
    ["later stock-affecting execution", { laterIssue: 1 }, "later production, QC, or RM issue"],
  ]) {
    it(`blocks reopen when ${label} exists`, async () => {
      const { db } = makeDb(option);
      await assert.rejects(
        () => reopenRegularWorkOrder(db, 10, { reason: "Accident", actorUserId: 9, actorRole: "ADMIN" }),
        (err) => err.code === "REGULAR_WO_REOPEN_BLOCKED" && err.message.includes(expected),
      );
    });
  }

  it("rejects NO_QTY and repeated reopen", async () => {
    await assert.rejects(
      () => reopenRegularWorkOrder(makeDb({ noQty: true }).db, 10, {
        reason: "Accident",
        actorUserId: 9,
        actorRole: "ADMIN",
      }),
      (err) => err.code === "WO_LIFECYCLE_REGULAR_ONLY",
    );
    await assert.rejects(
      () => reopenRegularWorkOrder(makeDb({ status: "IN_PROGRESS" }).db, 10, {
        reason: "Again",
        actorUserId: 9,
        actorRole: "ADMIN",
      }),
      (err) => err.code === "REGULAR_WO_REOPEN_BLOCKED" && /not permanently closed/.test(err.message),
    );
  });
});
