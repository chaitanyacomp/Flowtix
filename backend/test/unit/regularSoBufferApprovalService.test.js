const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertRegularSoBufferPercentForPersist,
} = require("../../src/services/regularSoPlanningSnapshotService");
const {
  fingerprintsMatch,
  computePlannedProductionQtyTotal,
  submitRegularSoBufferApprovalRequest,
  approveRegularSoBufferApprovalRequest,
  rejectRegularSoBufferApprovalRequest,
  hasMatchingApprovedRegularSoBufferRequest,
  assertRegularSoBufferApprovalForWoCreate,
} = require("../../src/services/regularSoBufferApprovalService");

test("REGULAR buffer persist: Store >5% blocked without matching approved request", () => {
  const gate = assertRegularSoBufferPercentForPersist(7, {
    role: "STORE",
    bufferReason: "Need more scrap cover",
    hasMatchingApprovedRequest: false,
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.code, "BUFFER_PERCENT_ADMIN_REQUIRED");
});

test("REGULAR buffer persist: Store >5% allowed with matching approved request + reason", () => {
  const gate = assertRegularSoBufferPercentForPersist(7, {
    role: "STORE",
    bufferReason: "Need more scrap cover",
    hasMatchingApprovedRequest: true,
  });
  assert.equal(gate.ok, true);
  assert.equal(gate.bufferPercent, 7);
});

test("REGULAR buffer persist: 0–5% Store direct; >10% blocked", () => {
  assert.equal(assertRegularSoBufferPercentForPersist(5, { role: "STORE" }).ok, true);
  const blocked = assertRegularSoBufferPercentForPersist(10.01, {
    role: "ADMIN",
    bufferReason: "x",
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "BUFFER_PERCENT_BLOCKED");
});

test("fingerprintsMatch requires buffer %, planned qty, and reason", () => {
  const row = { bufferPercent: 7.5, plannedProductionQty: 1075, storeReason: "Scrap risk" };
  assert.equal(
    fingerprintsMatch(row, { bufferPercent: 7.5, plannedProductionQty: 1075, storeReason: "Scrap risk" }),
    true,
  );
  assert.equal(
    fingerprintsMatch(row, { bufferPercent: 8, plannedProductionQty: 1075, storeReason: "Scrap risk" }),
    false,
  );
  assert.equal(
    fingerprintsMatch(row, { bufferPercent: 7.5, plannedProductionQty: 1100, storeReason: "Scrap risk" }),
    false,
  );
  assert.equal(
    fingerprintsMatch(row, { bufferPercent: 7.5, plannedProductionQty: 1075, storeReason: "Changed" }),
    false,
  );
});

test("computePlannedProductionQtyTotal sums FG planned qty", () => {
  const total = computePlannedProductionQtyTotal(
    [
      { customerPoQty: 1000, qty: 1000 },
      { customerPoQty: 500, qty: 500 },
    ],
    7.5,
  );
  // 1000*1.075=1075, 500*1.075=537.5 → floor 537 → 1612
  assert.equal(total, 1612);
});

function mockTx(overrides = {}) {
  const state = {
    created: null,
    updated: null,
    superseded: false,
    ...overrides,
  };
  const tx = {
    salesOrder: {
      findUnique: async () =>
        state.so ?? {
          id: 10,
          docNo: "SO-1",
          orderType: "NORMAL",
          lines: [
            {
              id: 1,
              itemId: 66,
              qty: 1000,
              customerPoQty: 1000,
              item: { id: 66, itemName: "Nozzle", itemType: "FG", unit: "Nos" },
            },
          ],
        },
    },
    regularSoBufferApprovalRequest: {
      findFirst: async () => state.existingPending ?? null,
      findMany: async () => state.approvedRows ?? [],
      findUnique: async () => state.pendingRow ?? null,
      updateMany: async () => {
        state.superseded = true;
        return { count: 1 };
      },
      create: async ({ data, include }) => {
        state.created = {
          id: 55,
          ...data,
          salesOrder: { id: 10, docNo: "SO-1", orderType: "NORMAL" },
          fgItem: { id: 66, itemName: "Nozzle", unit: "Nos" },
          requestedBy: { id: 2, name: "Store User", role: "STORE" },
          reviewedBy: null,
        };
        return state.created;
      },
      update: async ({ data }) => {
        state.updated = {
          ...(state.pendingRow || {}),
          ...data,
          salesOrder: { id: 10, docNo: "SO-1", orderType: "NORMAL" },
          fgItem: { id: 66, itemName: "Nozzle", unit: "Nos" },
          requestedBy: { id: 2, name: "Store User", role: "STORE" },
          reviewedBy: { id: 9, name: "Admin", role: "ADMIN" },
        };
        return state.updated;
      },
    },
    $transaction: async (fn) => fn(tx),
  };
  return { tx, state };
}

test("submit rejects NO_QTY sales orders (flow isolation)", async () => {
  const { tx } = mockTx({
    so: {
      id: 10,
      docNo: "SO-NQ",
      orderType: "NO_QTY",
      lines: [
        {
          id: 1,
          itemId: 66,
          qty: 1000,
          customerPoQty: 1000,
          item: { id: 66, itemName: "Nozzle", itemType: "FG", unit: "Nos" },
        },
      ],
    },
  });
  await assert.rejects(
    () =>
      submitRegularSoBufferApprovalRequest(
        { salesOrderId: 10, bufferPercent: 7, storeReason: "x" },
        { role: "STORE", userId: 2 },
        tx,
      ),
    (err) => err.code === "NO_QTY_BUFFER_APPROVAL_FORBIDDEN",
  );
});

test("submit returns identical PENDING request (no duplicate)", async () => {
  const existing = {
    id: 41,
    salesOrderId: 10,
    bufferPercent: 7,
    plannedProductionQty: 1070,
    storeReason: "Scrap risk",
    status: "PENDING_APPROVAL",
    requestNo: "RSB-1",
    fgItemId: 66,
    requestedByUserId: 2,
    requestedAt: new Date(),
    salesOrder: { id: 10, docNo: "SO-1", orderType: "NORMAL" },
    fgItem: { id: 66, itemName: "Nozzle", unit: "Nos" },
    requestedBy: { id: 2, name: "Store", role: "STORE" },
  };
  // planned for 1000 @ 7% = 1070
  const { tx, state } = mockTx({ existingPending: existing });
  // Stub audit
  const auditLog = require("../../src/services/auditLog");
  const orig = auditLog.write;
  auditLog.write = async () => {};
  try {
    const result = await submitRegularSoBufferApprovalRequest(
      { salesOrderId: 10, bufferPercent: 7, storeReason: "Scrap risk" },
      { role: "STORE", userId: 2 },
      tx,
    );
    assert.equal(result.id, 41);
    assert.equal(state.created, null);
  } finally {
    auditLog.write = orig;
  }
});

test("submit creates request and supersedes prior active rows", async () => {
  const { tx, state } = mockTx({ existingPending: null });
  const auditLog = require("../../src/services/auditLog");
  const orig = auditLog.write;
  auditLog.write = async () => {};
  try {
    const result = await submitRegularSoBufferApprovalRequest(
      { salesOrderId: 10, bufferPercent: 7, storeReason: "Scrap risk" },
      { role: "STORE", userId: 2 },
      tx,
    );
    assert.equal(result.status, "PENDING_APPROVAL");
    assert.equal(result.bufferPercent, 7);
    assert.equal(result.plannedProductionQty, 1070);
    assert.equal(state.superseded, true);
    assert.ok(state.created);
  } finally {
    auditLog.write = orig;
  }
});

test("reject requires admin remarks", async () => {
  await assert.rejects(
    () =>
      rejectRegularSoBufferApprovalRequest(
        1,
        { rejectionReason: "  " },
        { role: "ADMIN", userId: 9 },
        mockTx({}).tx,
      ),
    (err) => err.code === "REJECTION_REASON_REQUIRED",
  );
});

test("approve forbidden for Store role", async () => {
  await assert.rejects(
    () => approveRegularSoBufferApprovalRequest(1, {}, { role: "STORE", userId: 2 }, mockTx({}).tx),
    (err) => err.statusCode === 403,
  );
});

test("hasMatchingApprovedRegularSoBufferRequest matches fingerprint", async () => {
  const db = {
    regularSoBufferApprovalRequest: {
      findMany: async () => [
        {
          id: 9,
          bufferPercent: 7,
          plannedProductionQty: 1070,
          storeReason: "Scrap risk",
          status: "APPROVED",
          salesOrder: { id: 10, docNo: "SO-1", orderType: "NORMAL" },
        },
      ],
    },
    salesOrder: {
      findUnique: async () => ({
        id: 10,
        orderType: "NORMAL",
        lines: [
          {
            id: 1,
            itemId: 66,
            qty: 1000,
            customerPoQty: 1000,
            item: { id: 66, itemType: "FG" },
          },
        ],
      }),
    },
  };
  const ok = await hasMatchingApprovedRegularSoBufferRequest(
    10,
    { bufferPercent: 7, bufferReason: "Scrap risk" },
    db,
  );
  assert.equal(ok, true);
  const miss = await hasMatchingApprovedRegularSoBufferRequest(
    10,
    { bufferPercent: 8, bufferReason: "Scrap risk" },
    db,
  );
  assert.equal(miss, false);
});

test("assertRegularSoBufferApprovalForWoCreate allows ≤5%; requires APPROVED match above 5%", async () => {
  const soRow = {
    id: 10,
    docNo: "SO-1",
    orderType: "NORMAL",
    lines: [
      {
        id: 1,
        itemId: 66,
        qty: 1000,
        customerPoQty: 1000,
        item: { id: 66, itemName: "Nozzle", itemType: "FG", unit: "Nos" },
      },
    ],
  };

  const dbOk = {
    salesOrder: { findUnique: async () => soRow },
    regularSoBufferApprovalRequest: {
      findMany: async () => [
        {
          id: 9,
          bufferPercent: 10,
          plannedProductionQty: 1100,
          storeReason: "Scrap risk",
          status: "APPROVED",
          salesOrder: { id: 10, docNo: "SO-1", orderType: "NORMAL" },
        },
      ],
    },
  };

  // Stub planning view via module — monkeypatch build on the snapshot service
  const snapshotService = require("../../src/services/regularSoPlanningSnapshotService");
  const origBuild = snapshotService.buildRegularSoPlanningSnapshotView;
  snapshotService.buildRegularSoPlanningSnapshotView = async () => ({
    bufferPercent: 10,
    lines: [{ fgItemId: 66, plannedProductionQty: 1100 }],
  });

  try {
    const allowed = await assertRegularSoBufferApprovalForWoCreate(10, { actorRole: "STORE" }, dbOk);
    assert.equal(allowed.ok, true);
    assert.equal(allowed.bufferPercent, 10);

    await assert.rejects(
      () =>
        assertRegularSoBufferApprovalForWoCreate(
          10,
          { actorRole: "STORE" },
          {
            ...dbOk,
            regularSoBufferApprovalRequest: { findMany: async () => [] },
          },
        ),
      (err) => err.code === "BUFFER_PERCENT_ADMIN_REQUIRED",
    );

    // Admin bypass
    const adminOk = await assertRegularSoBufferApprovalForWoCreate(
      10,
      { actorRole: "ADMIN" },
      { ...dbOk, regularSoBufferApprovalRequest: { findMany: async () => [] } },
    );
    assert.equal(adminOk.ok, true);
  } finally {
    snapshotService.buildRegularSoPlanningSnapshotView = origBuild;
  }
});
test("reload fingerprint: 10% APPROVED request matches SO-level planned qty", () => {
  const planned = computePlannedProductionQtyTotal(
    [{ customerPoQty: 1000, qty: 1000 }],
    10,
  );
  assert.equal(planned, 1100);
  assert.equal(
    fingerprintsMatch(
      { bufferPercent: 10, plannedProductionQty: 1100, storeReason: "Scrap risk" },
      { bufferPercent: 10, plannedProductionQty: planned, storeReason: "Scrap risk" },
    ),
    true,
  );
  assert.equal(
    fingerprintsMatch(
      { bufferPercent: 10, plannedProductionQty: 1100, storeReason: "Scrap risk" },
      { bufferPercent: 10, plannedProductionQty: planned, storeReason: "" },
    ),
    false,
  );
});

/**
 * Real route shape: root Prisma client has `$transaction`; interactive `tx` does not.
 * Approve previously failed with `db.$transaction is not a function` when upsert nested on `tx`.
 */
function createRouteShapedPrismaClient(pendingRow) {
  const state = {
    pendingRow,
    updated: null,
    snapshotApplied: false,
  };

  const soRow = {
    id: 10,
    docNo: "SO-1",
    orderType: "NORMAL",
    lines: [
      {
        id: 1,
        itemId: 66,
        qty: 1000,
        customerPoQty: 1000,
        item: { id: 66, itemName: "Nozzle", itemType: "FG", unit: "Nos" },
      },
    ],
  };

  /** Interactive transaction client — mirrors Prisma: no `$transaction`. */
  const tx = {
    salesOrder: {
      findUnique: async () => soRow,
    },
    regularSoBufferApprovalRequest: {
      findUnique: async () => state.pendingRow,
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      update: async ({ data }) => {
        state.updated = {
          ...state.pendingRow,
          ...data,
          salesOrder: { id: 10, docNo: "SO-1", orderType: "NORMAL" },
          fgItem: { id: 66, itemName: "Nozzle", unit: "Nos" },
          requestedBy: { id: 2, name: "Store User", role: "STORE" },
          reviewedBy: { id: 9, name: "Admin", role: "ADMIN" },
        };
        state.pendingRow = state.updated;
        return state.updated;
      },
    },
    regularSoPlanningSnapshot: {
      findUnique: async () =>
        state.snapshotApplied
          ? {
              id: 1,
              salesOrderId: 10,
              bufferPercent: pendingRow.bufferPercent,
              lines: [],
              createdBy: null,
              updatedBy: null,
              salesOrder: soRow,
            }
          : null,
      create: async ({ data }) => {
        state.snapshotApplied = true;
        return { id: 1, ...data };
      },
      update: async ({ data }) => {
        state.snapshotApplied = true;
        return { id: 1, salesOrderId: 10, ...data };
      },
    },
    regularSoPlanningSnapshotLine: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 1 }),
    },
    stockTransaction: {
      aggregate: async () => ({ _sum: { qtyIn: 0, qtyOut: 0 } }),
    },
    location: {
      findFirst: async () => ({ id: 1 }),
      findMany: async () => [{ id: 1 }],
    },
  };

  assert.equal(typeof tx.$transaction, "undefined");

  const root = {
    $transaction: async (fn) => fn(tx),
  };

  return { root, tx, state };
}

test("Approve (route-shaped db) applies snapshot atomically without nested $transaction", async () => {
  const pendingRow = {
    id: 77,
    requestNo: "RSB-77",
    salesOrderId: 10,
    fgItemId: 66,
    bufferPercent: 7,
    plannedProductionQty: 1070,
    storeReason: "Scrap risk",
    status: "PENDING_APPROVAL",
    requestedByUserId: 2,
    requestedAt: new Date(),
    salesOrder: { id: 10, docNo: "SO-1", orderType: "NORMAL" },
    fgItem: { id: 66, itemName: "Nozzle", unit: "Nos" },
    requestedBy: { id: 2, name: "Store User", role: "STORE" },
    reviewedBy: null,
  };
  const { root, state } = createRouteShapedPrismaClient(pendingRow);
  const auditLog = require("../../src/services/auditLog");
  const locationService = require("../../src/services/locationService");
  const origAudit = auditLog.write;
  locationService.clearDefaultRmLocationCache?.();
  auditLog.write = async () => {};
  try {
    const result = await approveRegularSoBufferApprovalRequest(
      77,
      { adminRemarks: "OK for scrap risk" },
      { role: "ADMIN", userId: 9 },
      root,
    );
    assert.equal(result.status, "APPROVED");
    assert.equal(result.adminRemarks, "OK for scrap risk");
    assert.equal(result.bufferPercent, 7);
    assert.equal(state.snapshotApplied, true);
  } finally {
    auditLog.write = origAudit;
    locationService.clearDefaultRmLocationCache?.();
  }
});

test("Reject (route-shaped db) updates atomically without throwing", async () => {
  const pendingRow = {
    id: 78,
    requestNo: "RSB-78",
    salesOrderId: 10,
    fgItemId: 66,
    bufferPercent: 7,
    plannedProductionQty: 1070,
    storeReason: "Scrap risk",
    status: "PENDING_APPROVAL",
    requestedByUserId: 2,
    requestedAt: new Date(),
    salesOrder: { id: 10, docNo: "SO-1", orderType: "NORMAL" },
    fgItem: { id: 66, itemName: "Nozzle", unit: "Nos" },
    requestedBy: { id: 2, name: "Store User", role: "STORE" },
    reviewedBy: null,
  };
  const { root } = createRouteShapedPrismaClient(pendingRow);
  const auditLog = require("../../src/services/auditLog");
  const origAudit = auditLog.write;
  auditLog.write = async () => {};
  try {
    const result = await rejectRegularSoBufferApprovalRequest(
      78,
      { adminRemarks: "Buffer not justified" },
      { role: "ADMIN", userId: 9 },
      root,
    );
    assert.equal(result.status, "REJECTED");
    assert.equal(result.adminRemarks, "Buffer not justified");
  } finally {
    auditLog.write = origAudit;
  }
});

test("upsertRegularSoPlanningSnapshot reuses interactive tx (no nested $transaction)", async () => {
  const { upsertRegularSoPlanningSnapshot } = require("../../src/services/regularSoPlanningSnapshotService");
  const locationService = require("../../src/services/locationService");
  locationService.clearDefaultRmLocationCache?.();

  const soRow = {
    id: 10,
    docNo: "SO-1",
    orderType: "NORMAL",
    lines: [
      {
        id: 1,
        itemId: 66,
        qty: 1000,
        customerPoQty: 1000,
        item: { id: 66, itemName: "Nozzle", itemType: "FG", unit: "Nos" },
      },
    ],
  };
  let writeRanOnTx = false;
  let createdSnapshot = null;
  const tx = {
    salesOrder: { findUnique: async () => soRow },
    regularSoBufferApprovalRequest: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
    },
    regularSoPlanningSnapshot: {
      findUnique: async () =>
        createdSnapshot
          ? {
              ...createdSnapshot,
              lines: [],
              createdBy: null,
              updatedBy: null,
              salesOrder: soRow,
            }
          : null,
      create: async ({ data }) => {
        writeRanOnTx = true;
        createdSnapshot = { id: 1, ...data };
        return createdSnapshot;
      },
      update: async ({ data }) => {
        createdSnapshot = { id: 1, salesOrderId: 10, ...data };
        return createdSnapshot;
      },
    },
    regularSoPlanningSnapshotLine: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 1 }),
    },
    stockTransaction: {
      aggregate: async () => ({ _sum: { qtyIn: 0, qtyOut: 0 } }),
    },
    location: {
      findFirst: async () => ({ id: 1 }),
      findMany: async () => [{ id: 1 }],
    },
  };
  // Interactive Prisma tx: `$transaction` is absent (not a function).
  assert.equal(typeof tx.$transaction, "undefined");

  try {
    const snapshot = await upsertRegularSoPlanningSnapshot(
      {
        salesOrderId: 10,
        bufferPercent: 7,
        createdByUserId: 9,
        actorRole: "ADMIN",
        bufferReason: "Scrap risk",
        skipBufferApprovalSupersede: true,
      },
      tx,
    );
    assert.ok(snapshot);
    assert.equal(writeRanOnTx, true);
  } finally {
    locationService.clearDefaultRmLocationCache?.();
  }
});
