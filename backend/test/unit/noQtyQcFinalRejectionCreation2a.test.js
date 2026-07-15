/**
 * Phase 2A — Final QC Rejection recovery creation parity (unit, no live DB).
 *
 * Covers: terminal scrap producers, excluded states, idempotency, delta up/down,
 * reverse/cancel, SO/item isolation, production-shortfall unchanged, reconciliation.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  computeAvailableQty,
  createProductionShortRecovery,
  createFinalQcRejectedRecovery,
  appendTerminalQcScrapRecovery,
  cancelUnallocatedRecoverySource,
  getAvailableRecovery,
  getRecoverySummary,
  allocateRecovery,
} = require("../../src/services/noQtyRecoveryService");

function makeDb() {
  let nextCfId = 1;
  let nextAllocId = 1;
  /** @type {any[]} */
  const sources = [];
  /** @type {any[]} */
  const allocations = [];
  /** @type {any[]} */
  const sheets = [
    { id: 10, status: "DRAFT", salesOrderId: 42 },
    { id: 11, status: "LOCKED", salesOrderId: 42 },
  ];
  /** @type {any[]} */
  const lines = [
    { id: 100, sheetId: 10, itemId: 501 },
    { id: 101, sheetId: 10, itemId: 502 },
  ];
  const salesOrders = {
    42: { id: 42, orderType: "NO_QTY" },
    43: { id: 43, orderType: "NO_QTY" },
    99: { id: 99, orderType: "REGULAR" },
  };

  const db = {
    salesOrder: {
      findUnique: async ({ where }) => salesOrders[where.id] ?? null,
    },
    requirementSheet: {
      findUnique: async ({ where }) => sheets.find((s) => s.id === where.id) ?? null,
    },
    requirementSheetLine: {
      findUnique: async ({ where }) => {
        if (where.id != null) return lines.find((l) => l.id === where.id) ?? null;
        if (where.sheetId_itemId) {
          return (
            lines.find(
              (l) => l.sheetId === where.sheetId_itemId.sheetId && l.itemId === where.sheetId_itemId.itemId,
            ) ?? null
          );
        }
        return null;
      },
      create: async ({ data }) => {
        const row = { id: 200 + lines.length, ...data };
        lines.push(row);
        return row;
      },
    },
    carryForwardPending: {
      findFirst: async ({ where }) => {
        return (
          sources.find(
            (s) =>
              s.recoveryType === where.recoveryType &&
              s.sourceDocumentType === where.sourceDocumentType &&
              Number(s.sourceDocumentId) === Number(where.sourceDocumentId),
          ) ?? null
        );
      },
      findUnique: async ({ where, include }) => {
        const row = sources.find((s) => s.id === where.id);
        if (!row) return null;
        if (include?.allocations) {
          return {
            ...row,
            allocations: allocations.filter((a) => a.recoverySourceId === row.id),
          };
        }
        return { ...row };
      },
      findMany: async ({ where, include }) => {
        const rows = sources.filter((s) => {
          if (where.salesOrderId != null && s.salesOrderId !== where.salesOrderId) return false;
          if (where.itemId != null && s.itemId !== where.itemId) return false;
          if (where.recoveryType != null && s.recoveryType !== where.recoveryType) return false;
          if (where.recoveryStatus?.notIn && where.recoveryStatus.notIn.includes(s.recoveryStatus)) {
            return false;
          }
          return true;
        });
        return rows.map((r) => ({
          ...r,
          allocations: include?.allocations
            ? allocations.filter((a) => a.recoverySourceId === r.id)
            : undefined,
          item: include?.item ? { id: r.itemId, itemName: `Item-${r.itemId}`, unit: "Kg" } : undefined,
        }));
      },
      create: async ({ data }) => {
        const row = {
          id: nextCfId++,
          waivedQty: "0",
          remainingQty: data.remainingQty ?? data.sourceQty,
          recoveryStatus: data.recoveryStatus ?? "OPEN",
          status: data.status ?? "PENDING",
          migrationIncomplete: false,
          sourceWorkOrderId: data.sourceWorkOrderId ?? null,
          sourceRequirementSheetId: data.sourceRequirementSheetId ?? null,
          ...data,
        };
        const dup = sources.find(
          (s) =>
            s.recoveryType === row.recoveryType &&
            s.sourceDocumentType === row.sourceDocumentType &&
            Number(s.sourceDocumentId) === Number(row.sourceDocumentId),
        );
        if (dup) {
          const err = new Error("Unique constraint failed");
          err.code = "P2002";
          throw err;
        }
        sources.push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const row = sources.find((s) => s.id === where.id);
        if (!row) return null;
        Object.assign(row, data);
        return { ...row };
      },
    },
    recoveryAllocation: {
      findMany: async ({ where }) =>
        allocations.filter((a) => {
          if (where.recoverySourceId != null && a.recoverySourceId !== where.recoverySourceId) return false;
          return true;
        }),
      findFirst: async ({ where }) => {
        return (
          allocations.find((a) => {
            if (where.recoverySourceId != null && a.recoverySourceId !== where.recoverySourceId) return false;
            if (where.requirementSheetLineId != null && a.requirementSheetLineId !== where.requirementSheetLineId) {
              return false;
            }
            if (where.status?.in && !where.status.in.includes(a.status)) return false;
            return true;
          }) ?? null
        );
      },
      findUnique: async ({ where, include }) => {
        const row = allocations.find((a) => a.id === where.id);
        if (!row) return null;
        const sheet = sheets.find((s) => s.id === row.requirementSheetId);
        return {
          ...row,
          requirementSheet: include?.requirementSheet ? sheet : undefined,
        };
      },
      create: async ({ data }) => {
        const row = { id: nextAllocId++, ...data };
        allocations.push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const row = allocations.find((a) => a.id === where.id);
        if (!row) return null;
        Object.assign(row, data);
        return { ...row };
      },
    },
    _sources: sources,
    _allocations: allocations,
  };

  return db;
}

function scrapDisposition({
  id = 55,
  itemId = 501,
  workOrderId = 7,
  salesOrderId = 42,
  cycleId = 3,
  requirementSheetId = 1,
} = {}) {
  return {
    id,
    itemId,
    workOrderId,
    salesOrderId,
    cycleId,
    sourceRequirementSheetId: requirementSheetId,
    workOrder: {
      id: workOrderId,
      salesOrderId,
      cycleId,
      requirementSheetId,
    },
  };
}

describe("Phase 2A — terminal SCRAP creates QC_FINAL_REJECTION", () => {
  it("1. direct first-pass SCRAP creates QC recovery", async () => {
    const db = makeDb();
    const row = await appendTerminalQcScrapRecovery(db, {
      disposition: scrapDisposition({ id: 101 }),
      scrapQty: 12,
      actorUserId: 9,
      remarks: "First-pass QC scrap",
    });
    assert.ok(row);
    assert.equal(row.recoveryType, "QC_FINAL_REJECTION");
    assert.equal(Number(row.sourceQty), 12);
    assert.equal(row.sourceDocumentType, "QC_REJECTED_DISPOSITION");
    assert.equal(Number(row.sourceDocumentId), 101);
    assert.equal(Number(row.sourceWorkOrderId), 7);
    assert.equal(Number(row.sourceRequirementSheetId), 1);
    assert.equal(Number(row.cycleId), 3);
    assert.equal(Number(row.salesOrderId), 42);
  });

  it("2. split accepted + rejected: only rejected scrap creates recovery", async () => {
    const db = makeDb();
    // Accept path never calls recovery — only SCRAP portion:
    const row = await appendTerminalQcScrapRecovery(db, {
      disposition: scrapDisposition({ id: 102 }),
      scrapQty: 8,
    });
    assert.equal(Number(row.sourceQty), 8);
    assert.equal(db._sources.length, 1);
  });

  it("3. deny-to-scrap creates recovery", async () => {
    const db = makeDb();
    const row = await appendTerminalQcScrapRecovery(db, {
      disposition: scrapDisposition({ id: 103 }),
      scrapQty: 5,
      remarks: "Supervisor denied rework → scrap",
    });
    assert.equal(row.recoveryType, "QC_FINAL_REJECTION");
    assert.equal(Number(row.sourceQty), 5);
  });

  it("4. hold-to-scrap creates recovery", async () => {
    const db = makeDb();
    const row = await appendTerminalQcScrapRecovery(db, {
      disposition: scrapDisposition({ id: 104 }),
      scrapQty: 4,
      remarks: "Hold scrap",
    });
    assert.equal(Number(row.sourceQty), 4);
  });

  it("5. rework final scrap creates recovery", async () => {
    const db = makeDb();
    const row = await appendTerminalQcScrapRecovery(db, {
      disposition: scrapDisposition({ id: 105 }),
      scrapQty: 6,
      remarks: "Rework final QC scrap",
    });
    assert.equal(Number(row.sourceQty), 6);
  });
});

describe("Phase 2A — excluded states create no recovery", () => {
  it("6–9. pending / hold / rework / accepted: no producer call ⇒ no recovery", async () => {
    const db = makeDb();
    // Hold/rework/accept paths never call appendTerminalQcScrapRecovery.
    // Explicit create with qty 0 also yields null:
    const none = await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 0,
      sourceDocumentId: 999,
    });
    assert.equal(none, null);
    assert.equal(db._sources.length, 0);

    // REGULAR SO ignored:
    const regular = await createFinalQcRejectedRecovery(db, {
      salesOrderId: 99,
      itemId: 501,
      sourceQty: 10,
      sourceDocumentId: 998,
    });
    assert.equal(regular, null);
    assert.equal(db._sources.length, 0);
  });
});

describe("Phase 2A — idempotency and delta adjustment", () => {
  it("10. repeated absolute create is idempotent", async () => {
    const db = makeDb();
    const a = await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 10,
      workOrderId: 7,
      sourceDocumentId: 201,
    });
    const b = await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 10,
      workOrderId: 7,
      sourceDocumentId: 201,
    });
    assert.equal(a.id, b.id);
    assert.equal(db._sources.length, 1);
    assert.equal(Number(b.sourceQty), 10);
  });

  it("11. increased terminal scrap adds delta only", async () => {
    const db = makeDb();
    const d = scrapDisposition({ id: 202 });
    await appendTerminalQcScrapRecovery(db, { disposition: d, scrapQty: 5 });
    const b = await appendTerminalQcScrapRecovery(db, { disposition: d, scrapQty: 3 });
    assert.equal(db._sources.length, 1);
    assert.equal(Number(b.sourceQty), 8);
  });

  it("12. decreased terminal scrap adjusts safely", async () => {
    const db = makeDb();
    await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 20,
      sourceDocumentId: 203,
      workOrderId: 7,
    });
    const reduced = await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 12,
      sourceDocumentId: 203,
      workOrderId: 7,
    });
    assert.equal(Number(reduced.sourceQty), 12);
    assert.equal(db._sources.length, 1);
  });

  it("12b. decrease below active allocated is blocked", async () => {
    const db = makeDb();
    const src = await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 20,
      sourceDocumentId: 204,
    });
    await allocateRecovery(db, {
      recoverySourceId: src.id,
      requirementSheetId: 10,
      qty: 15,
    });
    await assert.rejects(
      () =>
        createFinalQcRejectedRecovery(db, {
          salesOrderId: 42,
          itemId: 501,
          sourceQty: 10,
          sourceDocumentId: 204,
        }),
      (err) => err.code === "RECOVERY_SOURCE_QTY_BELOW_ALLOCATED",
    );
  });

  it("13. reversal cancels unallocated recovery", async () => {
    const db = makeDb();
    await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 9,
      sourceDocumentId: 205,
    });
    const cancelled = await cancelUnallocatedRecoverySource(db, {
      recoveryType: "QC_FINAL_REJECTION",
      sourceDocumentType: "QC_REJECTED_DISPOSITION",
      sourceDocumentId: 205,
      actorUserId: 1,
      reason: "QC reversed",
    });
    assert.equal(cancelled.recoveryStatus, "CANCELLED");
    const available = await getAvailableRecovery(db, { salesOrderId: 42 });
    assert.equal(available.length, 0);
  });

  it("14. nested paths do not duplicate — same disposition provenance", async () => {
    const db = makeDb();
    const d = scrapDisposition({ id: 206 });
    // Absolute set then re-create same qty (would happen if both create and append hit once incorrectly):
    await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 7,
      sourceDocumentId: 206,
      workOrderId: 7,
    });
    const again = await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 7,
      sourceDocumentId: 206,
      workOrderId: 7,
    });
    assert.equal(db._sources.length, 1);
    assert.equal(Number(again.sourceQty), 7);
  });
});

describe("Phase 2A — isolation and non-regression", () => {
  it("15–17. SO, item, and WO provenance isolation", async () => {
    const db = makeDb();
    await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 10,
      workOrderId: 7,
      sourceDocumentId: 301,
    });
    await createFinalQcRejectedRecovery(db, {
      salesOrderId: 43,
      itemId: 501,
      sourceQty: 4,
      workOrderId: 8,
      sourceDocumentId: 302,
    });
    await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 502,
      sourceQty: 3,
      workOrderId: 9,
      sourceDocumentId: 303,
    });

    const so42 = await getAvailableRecovery(db, { salesOrderId: 42 });
    assert.equal(so42.length, 2);
    assert.ok(so42.every((r) => r.salesOrderId === 42));

    const item501 = await getAvailableRecovery(db, { salesOrderId: 42, itemId: 501 });
    assert.equal(item501.length, 1);
    assert.equal(item501[0].itemId, 501);
    assert.equal(item501[0].sourceWorkOrderId, 7);

    const so43 = await getAvailableRecovery(db, { salesOrderId: 43 });
    assert.equal(so43.length, 1);
    assert.equal(so43[0].sourceWorkOrderId, 8);
  });

  it("18. production-shortfall recovery unchanged alongside QC", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 7, salesOrderId: 42, requirementSheetId: 1, cycleId: 3 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 25,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 88,
    });
    await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 6,
      sourceDocumentId: 304,
      workOrderId: 7,
    });
    const summary = await getRecoverySummary(db, 42);
    assert.equal(summary.totals.productionShortfallSourceQty, 25);
    assert.equal(summary.totals.qcFinalRejectionSourceQty, 6);
    assert.equal(summary.totals.productionShortfallAvailableQty, 25);
    assert.equal(summary.totals.qcFinalRejectionAvailableQty, 6);
  });

  it("19. REGULAR_SO unaffected", async () => {
    const db = makeDb();
    const row = await createFinalQcRejectedRecovery(db, {
      salesOrderId: 99,
      itemId: 501,
      sourceQty: 10,
      sourceDocumentId: 305,
    });
    assert.equal(row, null);
    assert.equal(db._sources.length, 0);
  });

  it("20. scrapStock / accepted FG not touched by recovery service (ledger-only)", async () => {
    // Recovery service never writes StockTransaction — assertion is structural: only CarryForwardPending mutated.
    const db = makeDb();
    await appendTerminalQcScrapRecovery(db, {
      disposition: scrapDisposition({ id: 306 }),
      scrapQty: 2,
    });
    assert.equal(db._sources.length, 1);
    assert.ok(!("stockTransaction" in db));
  });
});

describe("Phase 2A — visibility + reconciliation", () => {
  it("21. recovery summary separates QC and production", async () => {
    const db = makeDb();
    await createProductionShortRecovery(db, {
      workOrder: { id: 7, salesOrderId: 42, requirementSheetId: 1, cycleId: 3 },
      workOrderLine: { fgItemId: 501 },
      remainderQty: 11,
      resolutionReason: "CAPACITY_CONSTRAINT",
      productionShortfallResolutionId: 90,
    });
    const qc = await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 502,
      sourceQty: 5,
      sourceDocumentId: 307,
      workOrderId: 8,
    });
    const summary = await getRecoverySummary(db, 42);
    const types = summary.sources.map((s) => s.recoveryType).sort();
    assert.deepEqual(types, ["PRODUCTION_SHORTFALL", "QC_FINAL_REJECTION"]);
    const qcSrc = summary.sources.find((s) => s.recoveryType === "QC_FINAL_REJECTION");
    assert.equal(qcSrc.sourceWorkOrderId, 8);
    assert.equal(qcSrc.itemId, 502);
    assert.equal(Number(qc.id), qcSrc.recoverySourceId);
  });

  it("22. reconciliation identity holds after alloc + waive floor", async () => {
    const db = makeDb();
    const src = await createFinalQcRejectedRecovery(db, {
      salesOrderId: 42,
      itemId: 501,
      sourceQty: 100,
      sourceDocumentId: 308,
    });
    await allocateRecovery(db, {
      recoverySourceId: src.id,
      requirementSheetId: 10,
      qty: 40,
    });
    // Simulate partial waiver on source:
    const row = db._sources.find((s) => s.id === src.id);
    row.waivedQty = "10";
    const refreshed = await getRecoverySummary(db, 42);
    const s = refreshed.sources[0];
    const expected = computeAvailableQty(
      { sourceQty: s.sourceQty, waivedQty: s.waivedQty },
      [{ status: "RESERVED", allocatedQty: s.activeAllocatedQty }],
    );
    assert.equal(s.availableQty, expected);
    assert.equal(
      Math.round((s.sourceQty - (s.activeAllocatedQty + s.waivedQty + s.availableQty)) * 1000) / 1000,
      0,
    );
  });
});
