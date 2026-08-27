const { prisma } = require("../utils/prisma");
const { computePlannedQtyFromCustomerBuffer } = require("./regularSoBufferQty");
const { getItemStockQty, usableStockDisplayQty } = require("./stockService");
const {
  validateAndEnrichProductionRuns,
  replaceRegularSoSnapshotProductionRuns,
  mapPersistedRunRow,
  RUN_INCLUDE,
} = require("./woProductionRunAllocationService");
const { WO_MACHINE_RUN_WRITE_ROLES } = require("../constants/erpRoles");

function canWriteMachineRuns(role) {
  const r = String(role ?? "").trim().toUpperCase();
  return WO_MACHINE_RUN_WRITE_ROLES.includes(r);
}

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** First candidate that coerces to a finite number > 0, else 0 (explicit 0 does not block fallback). */
function firstFinitePositive(...candidates) {
  for (const c of candidates) {
    const x = typeof c === "number" ? c : Number(c);
    if (Number.isFinite(x) && x > 0) return x;
  }
  return 0;
}

function clampBufferPercent(v) {
  const p = n(v);
  if (!Number.isFinite(p)) return 0;
  const clamped = Math.min(10, Math.max(0, p));
  // Preserve decimals (max 2 places) — do not integer-round.
  return Math.round((clamped + Number.EPSILON) * 100) / 100;
}

/**
 * True when every FG planned qty has matching allocated run total (buffer-aware planned WO qty).
 * Empty runs are treated as not matching when planned demand exists (allocation still required).
 * @param {Array<{ fgItemId?: number, plannedQty?: number }>} runs
 * @param {Array<{ fgItemId?: number, plannedQty?: number, plannedProductionQty?: number }>} plannedFgLines
 * @param {number} [eps]
 */
function allocationMatchesBufferedPlannedQty(runs, plannedFgLines, eps = 0.001) {
  const planned = (plannedFgLines ?? []).filter((l) => Number(l.fgItemId) > 0);
  if (!planned.length) return (runs ?? []).length === 0;
  const allocatedByFg = new Map();
  for (const r of runs ?? []) {
    const id = Number(r.fgItemId);
    if (!Number.isInteger(id) || id <= 0) continue;
    const q = n(r.plannedQty);
    allocatedByFg.set(id, (allocatedByFg.get(id) ?? 0) + q);
  }
  if (!(runs ?? []).length) return false;
  for (const line of planned) {
    const id = Number(line.fgItemId);
    const target = n(line.plannedQty ?? line.plannedProductionQty);
    const allocated = allocatedByFg.get(id) ?? 0;
    if (Math.abs(allocated - target) > eps) return false;
    allocatedByFg.delete(id);
  }
  for (const leftover of allocatedByFg.values()) {
    if (Math.abs(leftover) > eps) return false;
  }
  return true;
}

/** Apply FG UOM precision (default Nos = 0 dp) without rounding the WO qty upward. */
function applyFgUomPrecisionToPlannedQty(qty, decimalPlaces = 0) {
  const q = n(qty);
  if (!Number.isFinite(q) || q <= 0) return 0;
  const dp = Math.max(0, Math.floor(Number(decimalPlaces) || 0));
  if (dp <= 0) return Math.floor(q + 1e-9);
  const factor = 10 ** dp;
  return Math.floor(q * factor + 1e-9) / factor;
}

function capPlannedQtyByRmSupportedMax(plannedQty, rmSupportedMaxQty) {
  const planned = Math.max(0, n(plannedQty) || 0);
  if (rmSupportedMaxQty == null || rmSupportedMaxQty === "") return planned;
  const cap = Number(rmSupportedMaxQty);
  if (!Number.isFinite(cap) || cap < 0) return planned;
  return Math.min(planned, cap);
}

const REGULAR_SO_BUFFER_SOFT_MAX = 5;
const REGULAR_SO_BUFFER_HARD_MAX = 10;

/**
 * Validate production buffer % for REGULAR SO planning snapshot.
 * 0–5%: ok · >5–10%: Admin + reason, or Store with matching APPROVED request · >10%: blocked.
 * Hard-max check uses 2-decimal normalization so exactly 10% is never treated as blocked.
 * @returns {{ ok: true, bufferPercent: number } | { ok: false, statusCode: number, code: string, message: string }}
 */
function assertRegularSoBufferPercentForPersist(
  bufferPercent,
  { role = null, bufferReason = null, hasMatchingApprovedRequest = false } = {},
) {
  const raw = n(bufferPercent);
  if (!Number.isFinite(raw) || raw < 0) {
    return {
      ok: false,
      statusCode: 400,
      code: "INVALID_BUFFER_PERCENT",
      message: "Production buffer % must be a non-negative number.",
    };
  }
  // 2-decimal round first so exactly 10% (and float noise that rounds to 10) stays valid.
  const rounded = Math.round((raw + Number.EPSILON) * 100) / 100;
  if (rounded > REGULAR_SO_BUFFER_HARD_MAX + 1e-9) {
    return {
      ok: false,
      statusCode: 400,
      code: "BUFFER_PERCENT_BLOCKED",
      message: `Production buffer above ${REGULAR_SO_BUFFER_HARD_MAX}% is blocked.`,
    };
  }
  const normalized = clampBufferPercent(raw);
  if (normalized > REGULAR_SO_BUFFER_SOFT_MAX + 1e-9) {
    const r = String(role ?? "").trim().toUpperCase();
    const reasonOk = Boolean(String(bufferReason ?? "").trim());
    if (r === "ADMIN" || hasMatchingApprovedRequest) {
      if (!reasonOk) {
        return {
          ok: false,
          statusCode: 400,
          code: "BUFFER_PERCENT_REASON_REQUIRED",
          message: "A reason is required when Production buffer is above 5%.",
        };
      }
    } else {
      return {
        ok: false,
        statusCode: 403,
        code: "BUFFER_PERCENT_ADMIN_REQUIRED",
        message: "Buffer above 5% requires Admin approval.",
      };
    }
  }
  return { ok: true, bufferPercent: normalized };
}

function snapshotLineFromSalesOrderLine(line, bufferPercent, fgStockQty, opts = {}) {
  const customerCommittedQty = n(line.customerPoQty ?? line.qty);
  const productionBufferPercent = clampBufferPercent(bufferPercent);
  const rawPlanned = computePlannedQtyFromCustomerBuffer(customerCommittedQty, productionBufferPercent);
  let plannedProductionQty = applyFgUomPrecisionToPlannedQty(rawPlanned, opts.uomDecimalPlaces ?? 0);
  plannedProductionQty = capPlannedQtyByRmSupportedMax(plannedProductionQty, opts.rmSupportedMaxQty);
  const productionBufferQty = Math.max(0, plannedProductionQty - customerCommittedQty);
  const fgStockAdjustmentQty = Math.max(0, n(fgStockQty));
  // Full planned production drives RM demand — surplus FG in store is informational only (Decision 3/4).
  const rmPlanningQty = plannedProductionQty;
  return {
    salesOrderLineId: line.id,
    salesOrderId: line.soId,
    itemId: line.itemId,
    itemName: line.item?.itemName ?? `#${line.itemId}`,
    // FG identity contract expected by fgDemandInputFromPlanningView /
    // fgShortageDemandInputFromPlanningView (parity with the SNAPSHOT branch).
    lineId: line.id,
    fgItemId: line.itemId,
    fgName: line.item?.itemName ?? `#${line.itemId}`,
    customerCommittedQty,
    productionBufferPercent,
    productionBufferQty,
    plannedProductionQty,
    fgStockAdjustmentQty,
    rmPlanningQty,
    orderQty: customerCommittedQty,
    fgStock: fgStockAdjustmentQty,
    toProduce: rmPlanningQty,
  };
}

async function loadRegularSoPlanningSnapshot(salesOrderId, db = prisma) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return null;
  if (typeof db?.regularSoPlanningSnapshot?.findUnique !== "function") return null;
  return db.regularSoPlanningSnapshot.findUnique({
    where: { salesOrderId: soId },
    include: {
      salesOrder: {
        include: {
          lines: { include: { item: true }, orderBy: { id: "asc" } },
          customer: true,
          quotation: { select: { id: true, quotationNo: true } },
        },
      },
      createdBy: { select: { id: true, name: true, email: true } },
      updatedBy: { select: { id: true, name: true, email: true } },
      lines: {
        include: {
          salesOrderLine: { include: { item: true } },
        },
        orderBy: { id: "asc" },
      },
      productionRuns: {
        include: RUN_INCLUDE,
        orderBy: [{ fgItemId: "asc" }, { runSequence: "asc" }],
      },
    },
  });
}

async function buildRegularSoPlanningSnapshotView(salesOrderId, db = prisma) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) {
    const err = new Error("Invalid salesOrderId");
    err.statusCode = 400;
    throw err;
  }

  const snapshot = await loadRegularSoPlanningSnapshot(soId, db);
  const so = snapshot?.salesOrder ?? (await db.salesOrder.findUnique({
    where: { id: soId },
    include: {
      lines: { include: { item: true }, orderBy: { id: "asc" } },
      customer: true,
      quotation: { select: { id: true, quotationNo: true } },
    },
  }));

  if (!so) {
    const err = new Error("Sales order not found");
    err.statusCode = 404;
    throw err;
  }

  const orderType = so.orderType ?? "NORMAL";
  const fgLines = (so.lines ?? []).filter((line) => line.item?.itemType === "FG");
  const bufferPercent = snapshot ? clampBufferPercent(snapshot.bufferPercent) : 0;
  const productionRuns = (snapshot?.productionRuns ?? []).map(mapPersistedRunRow).filter(Boolean);
  const productionRunCount =
    productionRuns.length > 0
      ? productionRuns.length
      : snapshot?.productionRunCount ?? 0;
  const plannedPurgeCount =
    productionRuns.length > 0
      ? productionRuns.filter((r) => r.purgingRequired).length
      : snapshot?.plannedPurgeCount != null
        ? Number(snapshot.plannedPurgeCount)
        : 0;
  // Legacy physical-setup field only — never used as purging multiplier.
  const plannedSetupCount = snapshot?.plannedSetupCount ?? 1;
  const lines = [];

  for (const line of fgLines) {
    const lineSnapshot = snapshot?.lines?.find((row) => Number(row.salesOrderLineId) === Number(line.id)) ?? null;
    if (lineSnapshot) {
      const customerCommittedQty = n(lineSnapshot.customerCommittedQty);
      const productionBufferPercent = clampBufferPercent(lineSnapshot.productionBufferPercent);
      const productionBufferQty = n(lineSnapshot.productionBufferQty);
      const plannedProductionQty = n(lineSnapshot.plannedProductionQty);
      const fgStockAdjustmentQty = n(lineSnapshot.fgStockAdjustmentQty);
      // Always derive RM demand from full planned qty (ignore legacy net-of-FG-stock snapshots).
      const rmPlanningQty = plannedProductionQty;
      lines.push({
        lineId: line.id,
        salesOrderLineId: line.id,
        fgItemId: line.itemId,
        fgName: line.item.itemName,
        customerCommittedQty,
        productionBufferPercent,
        productionBufferQty,
        plannedProductionQty,
        fgStockAdjustmentQty,
        rmPlanningQty,
        orderQty: customerCommittedQty,
        fgStock: fgStockAdjustmentQty,
        toProduce: rmPlanningQty,
      });
      continue;
    }
    const fgStockRaw = await getItemStockQty(line.itemId, db, { stockBucket: "USABLE" });
    const fgStock = usableStockDisplayQty(fgStockRaw);
    lines.push(snapshotLineFromSalesOrderLine(line, bufferPercent, fgStock));
  }

  const allFgEnough = lines.every((l) => Number(l.rmPlanningQty ?? l.toProduce ?? 0) <= 1e-6);

  return {
    source: snapshot ? "SNAPSHOT" : "DERIVED",
    salesOrderId: soId,
    orderType,
    bufferPercent,
    plannedSetupCount,
    plannedPurgeCount,
    productionRunCount,
    productionRuns,
    machinePlanningCompleted: Boolean(snapshot?.machinePlanningCompleted),
    machinePlanningCompletedAt: snapshot?.machinePlanningCompletedAt ?? null,
    snapshotId: snapshot?.id ?? null,
    snapshotUpdatedAt: snapshot?.updatedAt ?? null,
    lines,
    allFgEnough,
    salesOrder: so,
  };
}

async function upsertRegularSoPlanningSnapshot(
  {
    salesOrderId,
    bufferPercent = 0,
    plannedSetupCount,
    productionRuns,
    createdByUserId = null,
    actorRole = null,
    bufferReason = null,
    skipBufferApprovalSupersede = false,
    /** `draft` = allow incomplete/stale qty rows; `complete` = full validation (default when runs sent). */
    machinePlanningMode = null,
    /** Required when newly submitting a past Start Date (Admin / Production Manager). */
    machinePlanningBackdateReason = null,
  },
  db = prisma,
) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) {
    const err = new Error("Invalid salesOrderId");
    err.statusCode = 400;
    throw err;
  }

  const so = await db.salesOrder.findUnique({
    where: { id: soId },
    include: {
      lines: { include: { item: true }, orderBy: { id: "asc" } },
    },
  });
  if (!so) {
    const err = new Error("Sales order not found");
    err.statusCode = 404;
    throw err;
  }
  if ((so.orderType ?? "NORMAL") === "NO_QTY") {
    const err = new Error("Production planning snapshot is not available for NO_QTY sales orders.");
    err.statusCode = 400;
    throw err;
  }

  const existingEarly = await db.regularSoPlanningSnapshot.findUnique({
    where: { salesOrderId: soId },
    select: { machinePlanningCompleted: true },
  });
  if (
    existingEarly?.machinePlanningCompleted &&
    (productionRuns != null ||
      String(machinePlanningMode ?? "")
        .trim()
        .toLowerCase() === "draft" ||
      String(machinePlanningMode ?? "")
        .trim()
        .toLowerCase() === "complete")
  ) {
    const err = new Error(
      "Machine planning is handed to Store. Reopen planning before editing allocations.",
    );
    err.statusCode = 409;
    err.code = "MACHINE_PLANNING_HANDED_OFF";
    throw err;
  }

  const fgLines = (so.lines ?? []).filter((line) => line.item?.itemType === "FG");
  if (!fgLines.length) {
    const err = new Error("Sales order has no FG lines for production planning.");
    err.statusCode = 400;
    throw err;
  }

  // Lazy require avoids circular load with regularSoBufferApprovalService (approve → upsert).
  const {
    hasMatchingApprovedRegularSoBufferRequest,
    supersedeRegularSoBufferApprovalsForSalesOrder,
  } = require("./regularSoBufferApprovalService");

  const hasMatchingApprovedRequest = await hasMatchingApprovedRegularSoBufferRequest(
    soId,
    { bufferPercent, bufferReason },
    db,
  );

  const bufferGate = assertRegularSoBufferPercentForPersist(bufferPercent, {
    role: actorRole,
    bufferReason,
    hasMatchingApprovedRequest,
  });
  if (!bufferGate.ok) {
    const err = new Error(bufferGate.message);
    err.statusCode = bufferGate.statusCode;
    err.code = bufferGate.code;
    throw err;
  }
  const normalizedBufferPercent = bufferGate.bufferPercent;
  // Client-submitted plannedSetupCount is rejected when present (backend derives counts).
  if (plannedSetupCount != null && plannedSetupCount !== "") {
    const { assertClientSetupCountMatchesDerived } = require("./woProductionRunAllocationService");
    assertClientSetupCountMatchesDerived(plannedSetupCount);
  }

  const fgStockRows = await Promise.all(
    fgLines.map(async (line) => {
      const fgStockRaw = await getItemStockQty(line.itemId, db, { stockBucket: "USABLE" });
      return {
        salesOrderLineId: line.id,
        fgStock: usableStockDisplayQty(fgStockRaw),
      };
    }),
  );
  const fgStockByLineId = new Map(fgStockRows.map((row) => [row.salesOrderLineId, row.fgStock]));

  // Root Prisma client starts a transaction; when already inside a tx (interactive client),
  // reuse it — do not call nested `$transaction` (tx.$transaction is undefined).
  const run = async (tx) => {
    const existing = await tx.regularSoPlanningSnapshot.findUnique({
      where: { salesOrderId: soId },
      select: {
        id: true,
        createdByUserId: true,
        plannedSetupCount: true,
        machinePlanningCompleted: true,
        bufferPercent: true,
        productionRuns: {
          select: { fgItemId: true, plannedQty: true, runSequence: true, plannedDate: true },
        },
      },
    });

    // Build line metrics first so run qty can be validated against planned production qty.
    const plannedLineMetrics = fgLines.map((line) => {
      const fgStock = fgStockByLineId.get(line.id) ?? 0;
      const customerCommittedQty = n(line.customerPoQty ?? line.qty);
      const rawPlanned = computePlannedQtyFromCustomerBuffer(customerCommittedQty, normalizedBufferPercent);
      const plannedProductionQty = applyFgUomPrecisionToPlannedQty(rawPlanned, 0);
      const productionBufferQty = Math.max(0, plannedProductionQty - customerCommittedQty);
      const fgStockAdjustmentQty = Math.max(0, n(fgStock));
      const rmPlanningQty = plannedProductionQty;
      return {
        salesOrderLineId: line.id,
        fgItemId: line.itemId,
        fgName: line.item?.itemName ?? `FG ${line.itemId}`,
        customerCommittedQty,
        productionBufferQty,
        plannedProductionQty,
        fgStockAdjustmentQty,
        rmPlanningQty,
      };
    });

    let derivedPurgeCount = null;
    let derivedRunCount = null;
    let enrichedRuns = null;
    let handoffPatch = {};
    /** @type {{ backdatedRuns: Array, reason: string|null }|null} */
    let backdateResult = null;

    // Buffer-only update (no productionRuns payload): keep existing runs, but if allocated
    // totals no longer equal revised Planned Qty, revoke Store handoff until reallocated.
    if (productionRuns === undefined && existing?.productionRuns?.length) {
      const existingRuns = existing.productionRuns.map((r) => ({
        fgItemId: Number(r.fgItemId),
        plannedQty: n(r.plannedQty),
      }));
      const matches = allocationMatchesBufferedPlannedQty(
        existingRuns,
        plannedLineMetrics.map((l) => ({
          fgItemId: l.fgItemId,
          plannedQty: l.plannedProductionQty,
        })),
      );
      if (!matches) {
        handoffPatch = {
          machinePlanningCompleted: false,
          machinePlanningCompletedAt: null,
          machinePlanningCompletedByUserId: null,
        };
      }
    }

    if (productionRuns !== undefined) {
      if (!canWriteMachineRuns(actorRole)) {
        const err = new Error(
          "Only Admin, Production, or Production Manager may create or edit machine production-run allocations.",
        );
        err.statusCode = 403;
        err.code = "PRODUCTION_RUNS_FORBIDDEN";
        throw err;
      }
      const mode = String(machinePlanningMode ?? "").trim().toLowerCase();
      const allowIncomplete = mode === "draft";
      const requireComplete = mode === "complete";
      const validated = await validateAndEnrichProductionRuns(
        tx,
        productionRuns,
        plannedLineMetrics.map((l) => ({
          fgItemId: l.fgItemId,
          plannedQty: l.plannedProductionQty,
          fgName: l.fgName,
        })),
        {
          requireRuns: requireComplete || (Array.isArray(productionRuns) && productionRuns.length > 0 && !allowIncomplete),
          allowIncomplete,
          actorRole,
        },
      );
      if (requireComplete && (!validated.enriched?.length || validated.incomplete)) {
        const err = new Error(
          "Complete machine planning requires valid allocations that equal planned WO quantity for every FG.",
        );
        err.statusCode = 400;
        err.code = "MACHINE_PLANNING_INCOMPLETE";
        throw err;
      }
      enrichedRuns = validated.enriched;
      derivedPurgeCount = validated.plannedPurgeCount;
      derivedRunCount = validated.productionRunCount;

      const {
        assertMachinePlanningPlannedDatesAllowed,
      } = require("./machinePlanningBackdate");
      backdateResult = assertMachinePlanningPlannedDatesAllowed({
        runs: (enrichedRuns ?? []).map((r) => ({
          fgItemId: r.fgItemId,
          runSequence: r.runSequence,
          machineId: r.machineId,
          plannedDate: r.plannedDate,
        })),
        actorRole,
        backdateReason: machinePlanningBackdateReason,
        salesOrder: so,
        existingRuns: existing?.productionRuns ?? [],
      });

      // Explicit handoff: only `complete` with valid runs marks Store-ready machine planning.
      // Draft / incomplete edits revoke Store handoff until Complete is clicked again.
      if (requireComplete && enrichedRuns?.length && !validated.incomplete) {
        handoffPatch = {
          machinePlanningCompleted: true,
          machinePlanningCompletedAt: new Date(),
          machinePlanningCompletedByUserId: createdByUserId ?? null,
        };
      } else {
        handoffPatch = {
          machinePlanningCompleted: false,
          machinePlanningCompletedAt: null,
          machinePlanningCompletedByUserId: null,
        };
      }
    }

    const snapshot = existing
      ? await tx.regularSoPlanningSnapshot.update({
          where: { salesOrderId: soId },
          data: {
            bufferPercent: String(normalizedBufferPercent),
            ...(derivedPurgeCount != null
              ? {
                  plannedPurgeCount: derivedPurgeCount,
                  productionRunCount: derivedRunCount ?? 0,
                }
              : {}),
            ...handoffPatch,
            ...(createdByUserId != null ? { updatedByUserId: createdByUserId } : {}),
          },
        })
      : await tx.regularSoPlanningSnapshot.create({
          data: {
            salesOrderId: soId,
            bufferPercent: String(normalizedBufferPercent),
            plannedSetupCount: 1,
            plannedPurgeCount: derivedPurgeCount ?? 0,
            productionRunCount: derivedRunCount ?? 0,
            machinePlanningCompleted: Boolean(handoffPatch.machinePlanningCompleted),
            machinePlanningCompletedAt: handoffPatch.machinePlanningCompletedAt ?? null,
            machinePlanningCompletedByUserId: handoffPatch.machinePlanningCompletedByUserId ?? null,
            createdByUserId,
            updatedByUserId: createdByUserId,
          },
        });

    await tx.regularSoPlanningSnapshotLine.deleteMany({
      where: { salesOrderId: soId },
    });

    const rows = plannedLineMetrics.map((line) => ({
      snapshotId: snapshot.id,
      salesOrderId: soId,
      salesOrderLineId: line.salesOrderLineId,
      customerCommittedQty: String(line.customerCommittedQty),
      productionBufferPercent: String(normalizedBufferPercent),
      productionBufferQty: String(line.productionBufferQty),
      plannedProductionQty: String(line.plannedProductionQty),
      fgStockAdjustmentQty: String(line.fgStockAdjustmentQty),
      rmPlanningQty: String(line.rmPlanningQty),
    }));

    await tx.regularSoPlanningSnapshotLine.createMany({ data: rows });

    if (enrichedRuns != null) {
      await replaceRegularSoSnapshotProductionRuns(tx, snapshot.id, enrichedRuns);
    }

    if (backdateResult?.backdatedRuns?.length && backdateResult.reason) {
      const { writeMachinePlanningBackdateAudits } = require("./machinePlanningBackdate");
      await writeMachinePlanningBackdateAudits(tx, {
        salesOrderId: soId,
        salesOrderDocNo: so.docNo ?? null,
        actorUserId: createdByUserId,
        actorRole,
        reason: backdateResult.reason,
        backdatedRuns: backdateResult.backdatedRuns,
      });
    }

    if (!skipBufferApprovalSupersede) {
      const roleUpper = String(actorRole ?? "").trim().toUpperCase();
      // Admin direct apply or buffer drop to ≤5% invalidates outstanding Store approval requests.
      // Store persist of a matching APPROVED fingerprint keeps that approval intact.
      const shouldSupersede =
        roleUpper === "ADMIN" ||
        normalizedBufferPercent <= REGULAR_SO_BUFFER_SOFT_MAX + 1e-9 ||
        !hasMatchingApprovedRequest;
      if (shouldSupersede) {
        await supersedeRegularSoBufferApprovalsForSalesOrder(soId, tx);
      }
    }

    return tx.regularSoPlanningSnapshot.findUnique({
      where: { salesOrderId: soId },
      include: {
        salesOrder: {
          include: {
            lines: { include: { item: true }, orderBy: { id: "asc" } },
            customer: true,
            quotation: { select: { id: true, quotationNo: true } },
          },
        },
        createdBy: { select: { id: true, name: true, email: true } },
        updatedBy: { select: { id: true, name: true, email: true } },
        lines: {
          include: {
            salesOrderLine: { include: { item: true } },
          },
          orderBy: { id: "asc" },
        },
        productionRuns: {
          include: RUN_INCLUDE,
          orderBy: [{ fgItemId: "asc" }, { runSequence: "asc" }],
        },
      },
    });
  };

  return typeof db.$transaction === "function" ? db.$transaction(run) : run(db);
}

/**
 * Canonical FG demand rows for BOM explosion — always uses plannedProductionQty (buffer-aware).
 * @param {{ lines?: Array<{ lineId?: number, fgItemId?: number, fgName?: string, plannedProductionQty?: number, rmPlanningQty?: number, toProduce?: number, unit?: string, note?: string }> }} planningView
 */
function fgDemandInputFromPlanningView(planningView) {
  return (planningView?.lines ?? [])
    .filter((line) => !line.note)
    .map((line) => ({
      lineId: line.lineId ?? null,
      fgItemId: line.fgItemId,
      fgName: line.fgName ?? "",
      fgQty: n(line.plannedProductionQty ?? line.rmPlanningQty ?? line.toProduce ?? 0),
      unit: line.unit ?? "",
    }))
    .filter((row) => row.fgItemId && row.fgQty > 1e-6);
}

/**
 * Operational FG demand for RM Control Center / Material Planning shortage detection.
 * Uses full planned production qty (buffer-aware). Surplus FG in store does not reduce RM demand.
 */
function fgShortageDemandInputFromPlanningView(planningView) {
  return (planningView?.lines ?? [])
    .filter((line) => !line.note)
    .map((line) => ({
      lineId: line.lineId ?? null,
      fgItemId: line.fgItemId,
      fgName: line.fgName ?? "",
      fgQty: firstFinitePositive(line.plannedProductionQty, line.rmPlanningQty, line.toProduce),
      unit: line.unit ?? "",
    }))
    .filter((row) => row.fgItemId && row.fgQty > 1e-6);
}

/**
 * Suggested default buffer from approved BOM for the SO primary FG (optional).
 */
async function resolveSuggestedFgPlanningBufferPercentForSalesOrder(salesOrderId, db = prisma) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return null;
  const so = await db.salesOrder.findUnique({
    where: { id: soId },
    include: {
      lines: {
        where: { item: { itemType: "FG" } },
        include: { item: { select: { id: true, itemName: true } } },
        orderBy: { id: "asc" },
        take: 1,
      },
    },
  });
  const fgLine = so?.lines?.[0];
  if (!fgLine?.itemId) return null;
  const bom = await db.bom.findFirst({
    where: { fgItemId: fgLine.itemId, status: "APPROVED" },
    orderBy: { revisionNo: "desc" },
    select: { suggestedFgPlanningBufferPercent: true },
  });
  if (bom?.suggestedFgPlanningBufferPercent == null) return null;
  const pct = n(bom.suggestedFgPlanningBufferPercent);
  return Number.isFinite(pct) ? clampBufferPercent(pct) : null;
}

function regularSoPlanningSnapshotToDto(snapshot) {
  if (!snapshot) return null;
  const productionRuns = (snapshot.productionRuns ?? []).map(mapPersistedRunRow).filter(Boolean);
  const productionRunCount =
    productionRuns.length > 0 ? productionRuns.length : snapshot.productionRunCount ?? 0;
  const plannedPurgeCount =
    productionRuns.length > 0
      ? productionRuns.filter((r) => r.purgingRequired).length
      : snapshot.plannedPurgeCount != null
        ? Number(snapshot.plannedPurgeCount)
        : 0;
  return {
    id: snapshot.id,
    salesOrderId: snapshot.salesOrderId,
    bufferPercent: n(snapshot.bufferPercent),
    plannedSetupCount: snapshot.plannedSetupCount ?? 1,
    plannedPurgeCount,
    productionRunCount,
    productionRuns,
    machinePlanningCompleted: Boolean(snapshot.machinePlanningCompleted),
    machinePlanningCompletedAt: snapshot.machinePlanningCompletedAt ?? null,
    createdByUserId: snapshot.createdByUserId ?? null,
    updatedByUserId: snapshot.updatedByUserId ?? null,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    lines: (snapshot.lines ?? []).map((line) => ({
      id: line.id,
      salesOrderLineId: line.salesOrderLineId,
      itemId: line.salesOrderLine?.itemId ?? null,
      itemName: line.salesOrderLine?.item?.itemName ?? "",
      customerCommittedQty: n(line.customerCommittedQty),
      productionBufferPercent: n(line.productionBufferPercent),
      productionBufferQty: n(line.productionBufferQty),
      plannedProductionQty: n(line.plannedProductionQty),
      fgStockAdjustmentQty: n(line.fgStockAdjustmentQty),
      rmPlanningQty: n(line.rmPlanningQty),
    })),
  };
}

/**
 * Clear Store handoff so Production can edit machine runs again.
 * Blocked when any Work Order already exists for the sales order.
 * @param {{
 *   salesOrderId: number,
 *   reason: string,
 *   createdByUserId?: number|null,
 *   actorRole?: string|null,
 *   user?: object|null,
 * }} input
 */
async function reopenRegularSoMachinePlanning(input, db = prisma) {
  const soId = Number(input?.salesOrderId);
  const reason = String(input?.reason ?? "").trim();
  if (!Number.isFinite(soId) || soId <= 0) {
    const err = new Error("Invalid salesOrderId");
    err.statusCode = 400;
    throw err;
  }
  if (reason.length < 3) {
    const err = new Error("A reopen reason is required (at least 3 characters).");
    err.statusCode = 400;
    err.code = "REOPEN_REASON_REQUIRED";
    throw err;
  }

  const role = String(input?.actorRole ?? "").trim().toUpperCase();
  if (role !== "ADMIN" && role !== "PRODUCTION" && role !== "PRODUCTION_MANAGER") {
    const err = new Error("Only Production, Production Manager, or Admin may reopen machine planning.");
    err.statusCode = 403;
    err.code = "REOPEN_FORBIDDEN";
    throw err;
  }

  const existingWo = await db.workOrder.findFirst({
    where: { salesOrderId: soId },
    select: { id: true, docNo: true },
    orderBy: { id: "desc" },
  });
  if (existingWo) {
    const err = new Error(
      `Cannot reopen machine planning after a Work Order exists (${existingWo.docNo || `#${existingWo.id}`}).`,
    );
    err.statusCode = 409;
    err.code = "MACHINE_PLANNING_WO_EXISTS";
    throw err;
  }

  const snapshot = await db.regularSoPlanningSnapshot.findUnique({
    where: { salesOrderId: soId },
  });
  if (!snapshot) {
    const err = new Error("No production planning snapshot to reopen.");
    err.statusCode = 404;
    err.code = "SNAPSHOT_NOT_FOUND";
    throw err;
  }
  if (!snapshot.machinePlanningCompleted) {
    const err = new Error("Machine planning is not completed — nothing to reopen.");
    err.statusCode = 409;
    err.code = "MACHINE_PLANNING_NOT_COMPLETED";
    throw err;
  }

  const updated = await db.regularSoPlanningSnapshot.update({
    where: { salesOrderId: soId },
    data: {
      machinePlanningCompleted: false,
      machinePlanningCompletedAt: null,
      machinePlanningCompletedByUserId: null,
      ...(input?.createdByUserId != null ? { updatedByUserId: input.createdByUserId } : {}),
    },
    include: {
      salesOrder: { select: { id: true, docNo: true } },
      productionRuns: true,
      lines: { include: { salesOrderLine: { include: { item: true } } } },
    },
  });

  try {
    const { logActivity } = require("./activityLogService");
    const { ACTIVITY_MODULES, ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES } = require("../constants/activityLogConstants");
    await logActivity({
      user: input?.user ?? null,
      module: ACTIVITY_MODULES.PRODUCTION,
      entityType: ACTIVITY_ENTITY_TYPES.SALES_ORDER,
      entityId: soId,
      docNo: updated.salesOrder?.docNo ?? null,
      action: ACTIVITY_ACTIONS.REOPENED,
      subAction: "MACHINE_PLANNING_REOPENED",
      message: "Machine Run Planning reopened — Store readiness invalidated until Complete again.",
      reason,
      metadata: {
        salesOrderId: soId,
        previousCompletedAt: snapshot.machinePlanningCompletedAt
          ? new Date(snapshot.machinePlanningCompletedAt).toISOString()
          : null,
        previousCompletedByUserId: snapshot.machinePlanningCompletedByUserId ?? null,
      },
    });
  } catch {
    // Activity log must not block reopen.
  }

  return updated;
}

module.exports = {
  buildRegularSoPlanningSnapshotView,
  fgDemandInputFromPlanningView,
  fgShortageDemandInputFromPlanningView,
  loadRegularSoPlanningSnapshot,
  regularSoPlanningSnapshotToDto,
  reopenRegularSoMachinePlanning,
  resolveSuggestedFgPlanningBufferPercentForSalesOrder,
  snapshotLineFromSalesOrderLine,
  upsertRegularSoPlanningSnapshot,
  clampBufferPercent,
  assertRegularSoBufferPercentForPersist,
  allocationMatchesBufferedPlannedQty,
  applyFgUomPrecisionToPlannedQty,
  capPlannedQtyByRmSupportedMax,
  REGULAR_SO_BUFFER_SOFT_MAX,
  REGULAR_SO_BUFFER_HARD_MAX,
};
