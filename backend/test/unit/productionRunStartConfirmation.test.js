/**
 * Production-run start confirmation + per-run entry gate + wastage category — focused tests.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  MATERIAL_CONDITION,
  SETUP_CONDITION,
  LEGACY_LABEL,
  PURGING_CONSUMPTION_EVENT,
  suggestPurgeFromActualCondition,
  parseActualPurgeQtyGrams,
  parseSetupCondition,
  assertProductionStartConfirmRole,
  resolveConfirmActorUserId,
  formatReadableMaterialProfileLabel,
  mapStartConfirmPersistenceError,
  resolveProductionRunStartGate,
  assertProductionRunStartConfirmed,
  confirmProductionRunStart,
} = require("../../src/services/productionRunStartConfirmationService");

const { mapPrismaClientError } = require("../../src/middleware/errorHandler");
const { Prisma } = require("../../src/prismaClientPackage");

const {
  isPurgingConsumptionNote,
  summarizeMaterialWastageByCategory,
} = require("../../src/services/materialWastageService");

function allocTx(allocations, confsByRunId = {}, opts = {}) {
  return {
    workOrderProductionRunAllocation: {
      findMany: async ({ where } = {}) => {
        if (opts.allocQueryError) throw opts.allocQueryError;
        return allocations.filter((a) => {
          if (where?.workOrderId != null && Number(a.workOrderId) !== Number(where.workOrderId)) {
            return false;
          }
          if (where?.fgItemId != null && Number(a.fgItemId) !== Number(where.fgItemId)) {
            return false;
          }
          return true;
        });
      },
      findUnique: async ({ where }) => {
        const row = allocations.find((a) => a.id === where.id);
        if (!row) return null;
        return {
          ...row,
          startConfirmation: confsByRunId[row.id] ?? null,
          machine: { id: row.machineId, machineCode: `M${row.machineId}`, machineName: "Machine" },
        };
      },
    },
    workOrderProductionRunStartConfirmation: opts.noConfirmSchema
      ? undefined
      : {
          findUnique: async () => null,
          findMany: async ({ where } = {}) =>
            Object.entries(confsByRunId)
              .filter(([, c]) => c?.status === "CONFIRMED")
              .map(([runAllocationId, c]) => ({
                runAllocationId: Number(runAllocationId),
                ...c,
              }))
              .filter((row) => {
                if (where?.workOrderId != null && where.workOrderId !== 1) return false;
                if (where?.fgItemId != null && where.fgItemId !== 2) return false;
                if (where?.runAllocationId?.in) {
                  return where.runAllocationId.in.includes(row.runAllocationId);
                }
                return true;
              }),
        },
  };
}

describe("suggestPurgeFromActualCondition", () => {
  it("same material retained → no purge", () => {
    assert.equal(
      suggestPurgeFromActualCondition(MATERIAL_CONDITION.SAME_MATERIAL_RETAINED).suggestedPurgingRequired,
      false,
    );
  });
  it("different / cleared / unknown → purge", () => {
    assert.equal(
      suggestPurgeFromActualCondition(MATERIAL_CONDITION.DIFFERENT_MATERIAL_RETAINED).suggestedPurgingRequired,
      true,
    );
    assert.equal(suggestPurgeFromActualCondition(MATERIAL_CONDITION.MACHINE_CLEARED).suggestedPurgingRequired, true);
    assert.equal(suggestPurgeFromActualCondition(MATERIAL_CONDITION.UNKNOWN).suggestedPurgingRequired, true);
  });
});

describe("parseActualPurgeQtyGrams", () => {
  it("rejects unsafe values; zero only when not required", () => {
    assert.throws(() => parseActualPurgeQtyGrams(-1, { purgingRequired: true }), /negative/i);
    assert.throws(() => parseActualPurgeQtyGrams(NaN, { purgingRequired: true }), /finite/i);
    assert.equal(parseActualPurgeQtyGrams(0, { purgingRequired: false }), 0);
    assert.throws(() => parseActualPurgeQtyGrams(0, { purgingRequired: true }), /greater than zero/i);
  });
});

describe("roles", () => {
  it("STORE forbidden; PRODUCTION/ADMIN allowed", () => {
    assert.throws(() => assertProductionStartConfirmRole("STORE"), (e) => e.code === "STORE_START_CONFIRM_FORBIDDEN");
    assert.equal(assertProductionStartConfirmRole("PRODUCTION"), "PRODUCTION");
    assert.equal(parseSetupCondition(SETUP_CONDITION.SETUP_RETAINED), "SETUP_RETAINED");
  });
});

describe("per-run production-entry gate", () => {
  const run1 = { id: 10, workOrderId: 1, fgItemId: 2, machineId: 100, runSequence: 1, isActive: true };
  const run2 = { id: 11, workOrderId: 1, fgItemId: 2, machineId: 101, runSequence: 2, isActive: true };

  it("historical WO with no allocations remains legacy-compatible", async () => {
    const tx = allocTx([]);
    const gate = await resolveProductionRunStartGate(tx, { workOrderId: 1, fgItemId: 2 });
    assert.equal(gate.mode, "LEGACY");
    assert.equal(gate.label, LEGACY_LABEL);
    await assertProductionRunStartConfirmed(tx, { workOrderId: 1, fgItemId: 2, runAllocationId: null });
  });

  it("confirm Run 1 only → Run 1 entry allowed", async () => {
    const tx = allocTx([run1, run2], {
      10: { id: 501, status: "CONFIRMED" },
    });
    const gate = await assertProductionRunStartConfirmed(tx, {
      workOrderId: 1,
      fgItemId: 2,
      runAllocationId: 10,
    });
    assert.equal(gate.runAllocationId, 10);
    assert.equal(gate.machineId, 100);
  });

  it("Run 2 entry remains blocked when only Run 1 confirmed", async () => {
    const tx = allocTx([run1, run2], {
      10: { id: 501, status: "CONFIRMED" },
    });
    await assert.rejects(
      () =>
        assertProductionRunStartConfirmed(tx, {
          workOrderId: 1,
          fgItemId: 2,
          runAllocationId: 11,
        }),
      (e) => e.code === "PRODUCTION_START_CONFIRMATION_REQUIRED",
    );
  });

  it("missing runAllocationId rejected for new-model WO", async () => {
    const tx = allocTx([run1, run2], { 10: { id: 501, status: "CONFIRMED" } });
    await assert.rejects(
      () => assertProductionRunStartConfirmed(tx, { workOrderId: 1, fgItemId: 2 }),
      (e) => e.code === "RUN_ALLOCATION_REQUIRED",
    );
  });

  it("wrong WO / FG / machine run rejected", async () => {
    const tx = allocTx([run1], { 10: { id: 501, status: "CONFIRMED" } });
    // Wrong WO: no allocations for WO 99 → legacy, then runAllocationId not applicable
    await assert.rejects(
      () =>
        assertProductionRunStartConfirmed(tx, {
          workOrderId: 99,
          fgItemId: 2,
          runAllocationId: 10,
        }),
      (e) => e.code === "RUN_ALLOCATION_NOT_APPLICABLE" || e.code === "RUN_ALLOCATION_WO_MISMATCH",
    );
    // Wrong FG on same WO that has allocations for FG 2 only → legacy for FG 99
    await assert.rejects(
      () =>
        assertProductionRunStartConfirmed(tx, {
          workOrderId: 1,
          fgItemId: 99,
          runAllocationId: 10,
        }),
      (e) => e.code === "RUN_ALLOCATION_NOT_APPLICABLE" || e.code === "RUN_ALLOCATION_FG_MISMATCH",
    );
    // Cross-check: matching WO/FG but client machineId disagrees with planned run
    await assert.rejects(
      () =>
        assertProductionRunStartConfirmed(tx, {
          workOrderId: 1,
          fgItemId: 2,
          runAllocationId: 10,
          claimedMachineId: 999,
        }),
      (e) => e.code === "RUN_ALLOCATION_MACHINE_MISMATCH",
    );
    // Explicit FG mismatch when allocation is loaded (same WO has the run)
    const txBothFg = allocTx(
      [run1, { id: 12, workOrderId: 1, fgItemId: 99, machineId: 100, runSequence: 1, isActive: true }],
      { 10: { id: 501, status: "CONFIRMED" }, 12: { id: 502, status: "CONFIRMED" } },
    );
    await assert.rejects(
      () =>
        assertProductionRunStartConfirmed(txBothFg, {
          workOrderId: 1,
          fgItemId: 99,
          runAllocationId: 10,
        }),
      (e) => e.code === "RUN_ALLOCATION_FG_MISMATCH",
    );
  });

  it("inactive run rejected", async () => {
    const inactive = { ...run1, isActive: false };
    const tx = allocTx([inactive], { 10: { id: 501, status: "CONFIRMED" } });
    await assert.rejects(
      () =>
        assertProductionRunStartConfirmed(tx, {
          workOrderId: 1,
          fgItemId: 2,
          runAllocationId: 10,
        }),
      (e) => e.code === "RUN_ALLOCATION_INACTIVE",
    );
  });

  it("missing confirmation schema fails closed for new-model WO", async () => {
    const tx = allocTx([run1], {}, { noConfirmSchema: true });
    await assert.rejects(
      () => resolveProductionRunStartGate(tx, { workOrderId: 1, fgItemId: 2 }),
      (e) => e.code === "PRODUCTION_START_CONFIRM_SETUP_REQUIRED" && e.statusCode === 503,
    );
  });

  it("database error never becomes legacy allow", async () => {
    const tx = allocTx([], {}, { allocQueryError: new Error("ECONNRESET") });
    await assert.rejects(
      () => resolveProductionRunStartGate(tx, { workOrderId: 1, fgItemId: 2 }),
      (e) => e.code === "PRODUCTION_RUN_ALLOCATION_QUERY_FAILED",
    );
  });

  it("allocation query unavailable fails closed (not legacy)", async () => {
    const tx = {};
    await assert.rejects(
      () => resolveProductionRunStartGate(tx, { workOrderId: 1, fgItemId: 2 }),
      (e) => e.code === "PRODUCTION_START_CONFIRM_SETUP_REQUIRED",
    );
  });
});

describe("confirmProductionRunStart orchestration", () => {
  it("idempotent retry returns existing confirmation", async () => {
    const existing = {
      id: 55,
      status: "CONFIRMED",
      actualMaterialCondition: "SAME_MATERIAL_RETAINED",
      actualSetupCondition: "SETUP_RETAINED",
      suggestedPurgingRequired: false,
      suggestedPurgingReason: "ok",
      actualPurgingRequired: false,
      purgeOverrideReason: null,
      purgeOverrideAt: null,
      plannedPurgeQtyGrams: 0,
      actualPurgeQtyGrams: 0,
      purgeVarianceGrams: 0,
      confirmedAt: new Date(),
      confirmedByUserId: 1,
      confirmedBy: { id: 1, name: "Prod" },
      machineStateVersionBefore: 0,
      machineStateVersionAfter: 1,
      purgeRmLines: [],
    };
    const db = {
      workOrderProductionRunStartConfirmation: {
        findUnique: async () => existing,
      },
      $transaction: async (fn) => fn(db),
    };
    const r1 = await confirmProductionRunStart(
      {
        runAllocationId: 77,
        actualMaterialCondition: "SAME_MATERIAL_RETAINED",
        actualSetupCondition: "SETUP_RETAINED",
        idempotencyKey: "idem-1",
      },
      { userId: 1, role: "PRODUCTION" },
      db,
    );
    assert.equal(r1.idempotent, true);
    assert.equal(PURGING_CONSUMPTION_EVENT, "PURGING_CONSUMPTION");
  });

  it("rejects missing actor userId before Prisma create (exact prior failure mode)", async () => {
    assert.throws(
      () => resolveConfirmActorUserId({ role: "PRODUCTION" }),
      (e) => e.code === "START_CONFIRM_ACTOR_REQUIRED",
    );
    await assert.rejects(
      () =>
        confirmProductionRunStart(
          {
            runAllocationId: 1,
            actualMaterialCondition: "UNKNOWN",
            actualSetupCondition: "SETUP_RETAINED",
          },
          { role: "PRODUCTION" },
          {
            workOrderProductionRunStartConfirmation: { findUnique: async () => null },
            $transaction: async (fn) => fn({}),
          },
        ),
      (e) => e.code === "START_CONFIRM_ACTOR_REQUIRED",
    );
  });

  it("maps Prisma create failure to safe operator error (no raw Prisma text)", () => {
    const fakePrisma = new Error(
      "Invalid `tx.workOrderProductionRunStartConfirmation.create()` invocation\n\nArgument `confirmedByUserId` is missing.",
    );
    fakePrisma.name = "PrismaClientValidationError";
    const mapped = mapStartConfirmPersistenceError(fakePrisma);
    assert.equal(mapped.code, "PRODUCTION_START_CONFIRM_FAILED");
    assert.match(mapped.message, /No changes were saved/i);
    assert.doesNotMatch(mapped.message, /Invalid `|confirmedByUserId|PrismaClient/i);
    assert.equal(resolveConfirmActorUserId({ userId: 42 }), 42);
    assert.equal(
      formatReadableMaterialProfileLabel([{ itemName: "PP Black Grinding", mixPercent: 100 }]),
      "PP Black Grinding — 100%",
    );
  });

  it("successful actor resolution uses JWT userId (not req.user.id)", () => {
    // Route bug was req.user?.id (undefined on JWT); service requires actor.userId.
    assert.equal(resolveConfirmActorUserId({ userId: 7, id: undefined }), 7);
    assert.equal(resolveConfirmActorUserId({ id: 9 }), 9);
  });
});

describe("errorHandler never exposes raw Prisma create text", () => {
  it("maps Invalid create invocation to stable operator message", () => {
    const err = new Error(
      "Invalid `tx.workOrderProductionRunStartConfirmation.create()` invocation\n\nArgument confirmedByUserId is missing.",
    );
    Object.setPrototypeOf(err, Prisma.PrismaClientValidationError.prototype);
    err.name = "PrismaClientValidationError";
    const mapped = mapPrismaClientError(err);
    assert.ok(mapped);
    assert.equal(mapped.code, "INTERNAL_PRISMA_VALIDATION");
    assert.doesNotMatch(mapped.message, /Invalid `|confirmedByUserId|Prisma/i);
  });
});

describe("purging remains separate from generic process wastage", () => {
  it("classifies PURGING reason and PURGING_CONSUMPTION remarks", () => {
    assert.equal(isPurgingConsumptionNote({ reason: "PURGING", qty: 1 }), true);
    assert.equal(
      isPurgingConsumptionNote({
        reason: "PROCESS_LOSS",
        remarks: "[PURGING_CONSUMPTION] startConfirmationId=1",
      }),
      true,
    );
    assert.equal(isPurgingConsumptionNote({ reason: "PROCESS_LOSS", qty: 1 }), false);
  });

  it("summarize does not inflate process wastage with purging", () => {
    const summary = summarizeMaterialWastageByCategory([
      { reason: "PROCESS_LOSS", qty: 2 },
      { reason: "PURGING", qty: 5, remarks: "[PURGING_CONSUMPTION] x" },
      { reason: "SPILLAGE", qty: 1 },
    ]);
    assert.equal(summary.processWastageQty, 3);
    assert.equal(summary.purgingConsumptionQty, 5);
    assert.equal(summary.totalWastageQty, 8);
    assert.equal(summary.eventTypePurging, "PURGING_CONSUMPTION");
  });
});
