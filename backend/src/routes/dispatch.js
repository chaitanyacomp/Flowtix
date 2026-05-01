const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { getItemStockQty, STOCK_EPS, assertUsableStockBeforeDispatchOut } = require("../services/stockService");
const {
  buildQcAcceptedMap,
  buildReplacementReturnQcGrossBySoItemKey,
  assertDispatchAllowedForSoItem,
} = require("../services/dispatchQcCap");
const { netDispatchedByItemId, remainingDispatchCapacityForSoItem } = require("../services/salesOrderDispatchAllocation");
const {
  buildSoLineDispatchAllocation,
  getSoLineAttributedDispatchedQty,
  getSoLineOrderQtyMinusAttributedDispatch,
  getSoLineDispatchPendingQty,
  getSoItemQcApprovedRemainingQty,
  buildDispatchableQtyBySalesOrderLineId,
  getDispatchBlockedReason,
  METRIC_CONTEXT,
  METRIC_DEFINITIONS,
  DISPATCH_ALLOC_MODE,
  REPORT_QUEUE_EPS,
} = require("../services/reportMetrics");
const {
  lockSalesOrderForUpdate,
  lockItemForUpdate,
  lockDispatchForUpdate,
} = require("../services/dispatchWriteLocks");
const { mapSoLinesToDispatchFifoInputs, dispatchFifoQtyForSoLine } = require("../services/regularSoBufferQty");
const { assertAdminPassword } = require("../services/adminPasswordAuth");
const {
  ROUTE_KEYS,
  normalizeIdempotencyKey,
  hashRequestBody,
  claimOrReplayDispatchIdempotency,
  completeDispatchIdempotency,
} = require("../services/dispatchIdempotency");
const {
  assertSalesOrderNotCompletedForDispatch,
  reopenSalesOrderIfConfirmedDispatchIncomplete,
} = require("../services/salesOrderDispatchHelpers");
const auditLog = require("../services/auditLog");
const { logActivity } = require("../services/activityLogService");
const {
  ACTIVITY_MODULES,
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
} = require("../constants/activityLogConstants");
const { displayDispatchNo, displaySalesOrderNo } = require("../utils/docNoLabels");
const { DocType } = require("@prisma/client");
const { allocateDocNo } = require("../services/docNoService");
const { normalizePositiveCycleId } = require("../utils/cycleIds");
const { repairNoQtyCycleIntegrity } = require("../services/noQtyCycleLifecycle");

const dispatchRouter = express.Router();

function friendlyNoQtyDispatchError(message, statusCode = 409) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function num(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

/**
 * NO_QTY: operational net and caps MUST use only rows where Dispatch.cycleId equals SalesOrder.currentCycleId.
 * - Rows with null/undefined cycleId are excluded (no fallback).
 * - Rows for other cycles are excluded so a new cycle is not blocked by prior-cycle dispatch.
 * - Reversals are included only when they carry the same non-null cycleId (set from the forward row at reversal create).
 *
 * @param {Array<{ id?: number; cycleId?: unknown; itemId?: unknown; reversalOfId?: unknown }>} dispatchRecords
 * @param {unknown} activeCycleId — typically SalesOrder.currentCycleId
 */
function filterNoQtyDispatchRowsForActiveCycle(dispatchRecords, activeCycleId) {
  const want = normalizePositiveCycleId(activeCycleId);
  if (want == null) return [];
  const out = [];
  for (const d of dispatchRecords || []) {
    const got = normalizePositiveCycleId(d.cycleId);
    if (got == null) continue;
    if (got !== want) continue;
    out.push(d);
  }
  return out;
}

/**
 * NO_QTY only: same as {@link netDispatchedByItemId}, then merge per numeric itemId (Prisma/JSON may split keys).
 */
function netNoQtyCycleDispatchedByItemId(dispatchRecords, mode) {
  const raw = netDispatchedByItemId(dispatchRecords, mode);
  const m = new Map();
  for (const [k, v] of raw) {
    const nk = Number(k);
    if (!Number.isFinite(nk)) continue;
    m.set(nk, (m.get(nk) ?? 0) + num(v));
  }
  return m;
}

/**
 * Sum active QC accepted qty for NO_QTY, attributed to a sales-order cycle.
 * Uses WorkOrder.cycleId when set; otherwise falls back to RequirementSheet.cycleId via WO.requirementSheet
 * (legacy WOs may omit cycleId).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ id: number; currentCycleId: number | null }[]} noQtySos
 * @returns {Promise<Map<string, number>>} key `${soId}:${cycleId}:${itemId}` → accepted qty
 */
async function loadNoQtyCycleQcAcceptedMap(prisma, noQtySos) {
  const soIds = [...new Set(noQtySos.map((s) => s.id).filter((x) => Number.isFinite(x) && x > 0))];
  if (!soIds.length) return new Map();

  const rows = await prisma.qcEntry.findMany({
    where: {
      reversedAt: null,
      production: {
        workOrderLine: {
          workOrder: { salesOrderId: { in: soIds } },
        },
      },
    },
    select: {
      acceptedQty: true,
      production: {
        select: {
          workOrderLine: {
            select: {
              fgItemId: true,
              workOrder: {
                select: {
                  salesOrderId: true,
                  cycleId: true,
                  requirementSheet: { select: { cycleId: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  /** @type {Map<string, number>} */
  const map = new Map();
  for (const r of rows) {
    const wol = r.production?.workOrderLine;
    const wo = wol?.workOrder;
    if (!wo || wol.fgItemId == null) continue;
    const soId = wo.salesOrderId;
    const itemId = wol.fgItemId;
    const cycleIdNorm =
      wo.cycleId != null
        ? normalizePositiveCycleId(wo.cycleId)
        : wo.requirementSheet?.cycleId != null
          ? normalizePositiveCycleId(wo.requirementSheet.cycleId)
          : null;
    if (cycleIdNorm == null) continue;
    const k = `${soId}:${cycleIdNorm}:${itemId}`;
    map.set(k, (map.get(k) || 0) + num(r.acceptedQty));
  }
  return map;
}

/**
 * NO_QTY only: rework QC recheck accepted qty that moved into USABLE during the active cycle.
 *
 * Source of truth:
 * - StockTransaction rows created by POST /api/production/qc-rejected-dispositions/:id/recheck
 * - transactionType = BUCKET_TRANSFER
 * - stockBucket = USABLE
 * - qtyIn > 0
 * - refId = QcRejectedDisposition.id (added for traceability)
 *
 * We attribute each recheck accepted qty to the cycle via the disposition's WorkOrder.cycleId (fallback: WO.requirementSheet.cycleId).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ id: number; currentCycleId: number | null }[]} noQtySos
 * @returns {Promise<Map<string, number>>} key `${soId}:${cycleId}:${itemId}` → accepted qty
 */
async function loadNoQtyCycleRecheckAcceptedMap(prisma, noQtySos) {
  const soIds = [...new Set((noQtySos || []).map((s) => s.id).filter((x) => Number.isFinite(x) && x > 0))];
  if (!soIds.length) return new Map();

  // Candidate stock txns (accepted to usable) for recheck. refId carries disposition id.
  const txns = await prisma.stockTransaction.findMany({
    where: {
      transactionType: "BUCKET_TRANSFER",
      stockBucket: "USABLE",
      refId: { gt: 0 },
      qtyIn: { gt: 0 },
    },
    select: { refId: true, itemId: true, qtyIn: true },
    orderBy: { id: "desc" },
    take: 5000,
  });
  if (!txns.length) return new Map();

  const dispIds = [...new Set(txns.map((t) => Number(t.refId)).filter((x) => Number.isFinite(x) && x > 0))];
  if (!dispIds.length) return new Map();

  const dispositions = await prisma.qcRejectedDisposition.findMany({
    where: { id: { in: dispIds }, voidedAt: null },
    select: {
      id: true,
      itemId: true,
      workOrder: { select: { salesOrderId: true, cycleId: true, requirementSheet: { select: { cycleId: true } } } },
    },
  });
  const dispById = new Map(dispositions.map((d) => [Number(d.id), d]));

  const map = new Map();
  for (const t of txns) {
    const disp = dispById.get(Number(t.refId));
    if (!disp) continue;
    const soId = disp.workOrder?.salesOrderId;
    if (!soId || !soIds.includes(soId)) continue;
    const itemId = Number(disp.itemId ?? t.itemId);
    const cycleIdNorm =
      disp.workOrder?.cycleId != null
        ? normalizePositiveCycleId(disp.workOrder.cycleId)
        : disp.workOrder?.requirementSheet?.cycleId != null
          ? normalizePositiveCycleId(disp.workOrder.requirementSheet.cycleId)
          : null;
    if (cycleIdNorm == null) continue;
    const k = `${soId}:${cycleIdNorm}:${itemId}`;
    map.set(k, (map.get(k) || 0) + num(t.qtyIn));
  }
  return map;
}

/**
 * NO_QTY headroom: NOT cycle-capped.
 * Dispatch is driven by current RS qty (cycleCap) and usable FG stock (USABLE bucket):
 * allowed = min(current RS qty, usable stock).
 * Operational net (alreadyOpNet) includes UNLOCKED draft forwards (same as {@link netDispatchedByItemId} OPERATIONAL).
 * Cycle QC accepted (`qcAcceptedThisCycle`) is informational / traceability — it does not gate dispatch when usable FG stock exists.
 *
 * @param {{ cycleCap: number; alreadyOpNet: number; usableStock: number; qcAcceptedThisCycle?: number }} p
 */
function computeNoQtyDispatchHeadroom(p) {
  const cap = num(p.cycleCap);
  const usable = num(p.usableStock);
  return Math.max(0, Math.min(cap, usable));
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 */
async function sumNoQtyCycleQcAcceptedForSoItem(db, soId, cycleId, itemId) {
  const want = normalizePositiveCycleId(cycleId);
  if (want == null) return 0;
  const rows = await db.qcEntry.findMany({
    where: {
      reversedAt: null,
      production: {
        workOrderLine: {
          fgItemId: itemId,
          workOrder: { salesOrderId: soId },
        },
      },
    },
    select: {
      acceptedQty: true,
      production: {
        select: {
          workOrderLine: {
            select: {
              workOrder: {
                select: {
                  cycleId: true,
                  requirementSheet: { select: { cycleId: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  let sum = 0;
  for (const r of rows) {
    const wo = r.production?.workOrderLine?.workOrder;
    if (!wo) continue;
    const eff =
      wo.cycleId != null
        ? normalizePositiveCycleId(wo.cycleId)
        : wo.requirementSheet?.cycleId != null
          ? normalizePositiveCycleId(wo.requirementSheet.cycleId)
          : null;
    if (eff !== want) continue;
    sum += num(r.acceptedQty);
  }
  return sum;
}

/**
 * NORMAL SO only: compare customer pending vs dispatchable (already stock/QC capped) for dispatch UX.
 * @returns {"READY_FULL" | "PARTIAL_AVAILABLE" | "NOT_READY" | undefined}
 */
function regularDispatchReadinessLabel(orderType, pendingDispatchQty, dispatchable) {
  if (orderType !== "NORMAL") return undefined;
  const p = Number(pendingDispatchQty) || 0;
  const d = Number(dispatchable) || 0;
  const eps = REPORT_QUEUE_EPS;
  if (p <= eps) return "NOT_READY";
  if (d <= eps) return "NOT_READY";
  if (d + eps >= p) return "READY_FULL";
  return "PARTIAL_AVAILABLE";
}

/**
 * Build NO_QTY dispatch context from current cycle locked requirement sheet (cap) + usable stock + current-cycle net dispatch
 * + cycle-scoped QC accepted (WO cycle or RS cycle fallback).
 *
 * @param {object} input
 * @param {number} input.soId
 * @param {number|null} input.currentCycleId
 * @param {{ itemId: number; dispatchedQty: unknown; cycleId?: number | null; reversalOfId?: number | null; workflowStatus?: string | null }[]} input.dispatchRecords
 * @param {Map<number, number>} input.onHandByItemId
 * @param {Map<string, { capsByItemId: Map<number, { cap: number; itemName: string }> }>} input.noQtyCapBySoCycleKey
 * @param {Map<string, number>} input.cycleQcAcceptedMap key `${soId}:${cycleId}:${itemId}`
 * @param {{ id: number; itemId: number; qty?: unknown }[] | undefined} input.salesOrderLines — SO lines for customer remaining demand (NO_QTY display).
 */
function buildNoQtyLineStats({
  soId,
  currentCycleId,
  dispatchRecords,
  onHandByItemId,
  noQtyCapBySoCycleKey,
  cycleQcAcceptedMap,
  cycleRecheckAcceptedMap,
  salesOrderLines,
}) {
  const cycleIdNorm = normalizePositiveCycleId(currentCycleId);
  if (cycleIdNorm == null) {
    return { lineStats: [], blockedReason: "No active cycle available for dispatch." };
  }
  const key = `${soId}:${cycleIdNorm}`;
  const capEntry = noQtyCapBySoCycleKey.get(key);
  if (!capEntry) {
    return { lineStats: [], blockedReason: "Requirement Sheet must be locked before dispatch." };
  }

  const lineInputs = (salesOrderLines || []).map((l) => ({
    id: l.id,
    itemId: l.itemId,
    qty: num(l.qty),
  }));

  const cycleDispatchRecords = filterNoQtyDispatchRowsForActiveCycle(dispatchRecords, cycleIdNorm);
  const netByItemOperational = netNoQtyCycleDispatchedByItemId(cycleDispatchRecords, DISPATCH_ALLOC_MODE.OPERATIONAL);

  const lineStats = [];
  for (const [itemId, capObj] of capEntry.capsByItemId.entries()) {
    const cycleCap = num(capObj.cap);
    if (!(cycleCap > REPORT_QUEUE_EPS)) continue;
    const dispatched = num(netByItemOperational.get(Number(itemId)) ?? 0);
    const remaining = Math.max(0, cycleCap - dispatched);
    // NO_QTY dispatch is not cycle-capped. We keep cycle cap remaining for trace/reference only.
    const qcKey = `${soId}:${cycleIdNorm}:${itemId}`;
    const qcAcceptedThisCycle = num(cycleQcAcceptedMap?.get(qcKey) ?? 0);
    const recheckAcceptedThisCycle = num(cycleRecheckAcceptedMap?.get(qcKey) ?? 0);
    // Usable FG stock is the operational gating quantity for dispatch (same basis as Stock screen).
    // We keep cycle QC accepted purely informational (traceability), because usable stock movements (bucket transfers)
    // are the source-of-truth for "can ship now".
    const usableStock = num(onHandByItemId?.get(Number(itemId)) ?? 0);
    const dispatchable = computeNoQtyDispatchHeadroom({
      cycleCap,
      alreadyOpNet: dispatched,
      usableStock,
      qcAcceptedThisCycle,
    });
    /**
     * NO_QTY: display "demand" as the remaining cycle cap.
     * We intentionally do NOT use SalesOrderLine.qty (may be 0) as demand.
     */
    const soRemainingDemandQty = remaining;
    const lastShortageQty = 0;
    // NO_QTY: treat "pending dispatch" as what can be dispatched now (not shortage).
    const logicalPending = Math.max(0, dispatchable);
    const draftPreparedQty = (cycleDispatchRecords || [])
      .filter((d) => d.reversalOfId == null && d.workflowStatus === "UNLOCKED" && Number(d.itemId) === Number(itemId))
      .reduce((s, d) => s + num(d.dispatchedQty), 0);
    const rowsInCycleNetForItem = cycleDispatchRecords.filter((d) => Number(d.itemId) === Number(itemId));

    lineStats.push({
      lineId: itemId, // stable synthetic id for UI selection
      itemId,
      itemName: capObj.itemName,
      // NO_QTY requirement sheet snapshots (for UI; does not change dispatch eligibility formula).
      fulfillmentQtySnapshot: capObj.fulfillmentQtySnapshot != null ? num(capObj.fulfillmentQtySnapshot) : null,
      productionRequiredQtySnapshot: capObj.productionRequiredQtySnapshot != null ? num(capObj.productionRequiredQtySnapshot) : null,
      coveredFromStockQtySnapshot:
        capObj.availableStockQtySnapshot != null && capObj.fulfillmentQtySnapshot != null
          ? Math.min(num(capObj.fulfillmentQtySnapshot), num(capObj.availableStockQtySnapshot))
          : null,
      requirementSheetAvailableStockQtySnapshot:
        capObj.availableStockQtySnapshot != null ? num(capObj.availableStockQtySnapshot) : null,
      shortfallQtySnapshot: capObj.shortfallQtySnapshot != null ? num(capObj.shortfallQtySnapshot) : null,
      /** Operational net dispatch for this SO + item in the current cycle (incl. draft forwards + reversals). */
      operationalNetDispatchedQty: dispatched,
      /** How many Dispatch rows (forwards + reversals) for this itemId were summed into operationalNetDispatchedQty for this cycle. */
      cycleOperationalDispatchRowsInNet: rowsInCycleNetForItem.length,
      orderQty: 0,
      isFree: false,
      dispatched: dispatched,
      dispatchPendingLock: draftPreparedQty,
      remaining: remaining,
      pendingDispatchQty: logicalPending,
      onHand: usableStock,
      totalStock: usableStock,
      qcAccepted: qcAcceptedThisCycle,
      qcApprovedStock: qcAcceptedThisCycle,
      qcApprovedRemaining: Math.max(0, qcAcceptedThisCycle - dispatched),
      cycleQcAcceptedQty: qcAcceptedThisCycle,
      inQcReworkQty: 0,
      dispatchable,
      dispatchableQty: dispatchable,
      cycleCap,
      cycleDispatchedQty: dispatched,
      cycleCapRemaining: remaining,
      soRemainingDemandQty,
      lastShortageQty,
      usableQcPassedStock: usableStock,
      dispatchBlockedReason:
        usableStock <= REPORT_QUEUE_EPS
            ? "Usable QC-passed stock is not available."
            : dispatchable <= REPORT_QUEUE_EPS
              ? "Nothing is dispatchable from usable stock."
              : null,
      quantityContexts: {
        cycleCap: { qty: cycleCap, metricContext: "NO_QTY_CYCLE_CAP" },
        cycleRemaining: { qty: remaining, metricContext: "NO_QTY_CYCLE_REMAINING" },
        usableStock: { qty: usableStock, metricContext: "NO_QTY_USABLE_STOCK" },
        dispatchableQty: { qty: dispatchable, metricContext: "NO_QTY_DISPATCHABLE_USABLE" },
      },
    });
  }

  return { lineStats, blockedReason: null };
}

/**
 * Which term(s) bind `min(remainingCap, usable)` for NO_QTY headroom (same eps as queue).
 * @returns {{ bindingLimiters: string[]; terms: { CAP: number; STOCK: number }; dispatchableQty: number }}
 */
function classifyNoQtyBindingLimiters(remainingCap, usableStock, dispatchable) {
  const d = num(dispatchable);
  const terms = { CAP: num(remainingCap), STOCK: num(usableStock) };
  const eps = REPORT_QUEUE_EPS;
  const keys = Object.keys(terms);
  const minVal = Math.min(terms.CAP, terms.STOCK);
  const bindingLimiters = keys.filter((k) => Math.abs(terms[k] - minVal) <= eps || (d <= eps && terms[k] <= eps));
  return { bindingLimiters, terms, dispatchableQty: d, minOfTwo: minVal };
}

/**
 * Admin-only: exact inputs/outputs for {@link computeNoQtyDispatchHeadroom} plus per-QC-row cycle resolution.
 * Temporary diagnostic — not for operators.
 */
async function buildNoQtyDispatchDebugPayload(soId, itemId, selectedCycleIdOpt) {
  const so = await prisma.salesOrder.findUnique({
    where: { id: soId },
    include: { lines: { include: { item: true } }, dispatch: true },
  });
  if (!so) {
    return { error: { code: "NOT_FOUND", message: "Sales order not found." } };
  }
  if (so.orderType !== "NO_QTY") {
    return { error: { code: "NOT_NO_QTY", message: "Debug applies only to No Qty sales orders." } };
  }
  const fgLine = (so.lines || []).find((l) => l.itemId === itemId && l.item?.itemType === "FG");
  if (!fgLine) {
    return { error: { code: "ITEM_NOT_ON_SO", message: "FG item not found on this sales order." } };
  }
  let currentCycleId;
  if (selectedCycleIdOpt != null) {
    const c = await prisma.salesOrderCycle.findFirst({
      where: { id: normalizePositiveCycleId(selectedCycleIdOpt), salesOrderId: soId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!c) {
      return { error: { code: "INVALID_CYCLE", message: "cycleId is not an active cycle for this sales order." } };
    }
    currentCycleId = c.id;
  } else {
    currentCycleId = normalizePositiveCycleId(so.currentCycleId);
  }
  if (currentCycleId == null) {
    return {
      salesOrderId: soId,
      currentCycleId: null,
      itemId,
      itemName: fgLine.item?.itemName ?? `Item #${itemId}`,
      error: { code: "NO_ACTIVE_CYCLE", message: "Sales order has no currentCycleId." },
    };
  }

  const sheet = await prisma.requirementSheet.findFirst({
    where: { salesOrderId: soId, cycleId: currentCycleId, status: "LOCKED" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { lines: { include: { item: true } } },
  });
  const capLine = sheet ? (sheet.lines || []).find((ln) => ln.itemId === itemId) : null;
  const cycleCap = capLine ? Math.max(num(capLine.suggestedWoQtySnapshot ?? 0), num(capLine.requirementQty ?? 0)) : 0;

  const cycleDispatchRecords = filterNoQtyDispatchRowsForActiveCycle(so.dispatch, currentCycleId);
  const netByItemOperational = netNoQtyCycleDispatchedByItemId(cycleDispatchRecords, DISPATCH_ALLOC_MODE.OPERATIONAL);
  const alreadyOpNet = num(netByItemOperational.get(Number(itemId)) ?? 0);
  const cycleCapRemaining = Math.max(0, cycleCap - alreadyOpNet);

  const cycleQcMap = await loadNoQtyCycleQcAcceptedMap(prisma, [{ id: soId, currentCycleId }]);
  const cycleRecheckMap = await loadNoQtyCycleRecheckAcceptedMap(prisma, [{ id: soId, currentCycleId }]);
  const qcKey = `${soId}:${currentCycleId}:${itemId}`;
  const qcAcceptedThisCycle = num(cycleQcMap.get(qcKey) ?? 0);
  const recheckAcceptedThisCycle = num(cycleRecheckMap.get(qcKey) ?? 0);
  const qcRemainingAfterOperationalDispatch = Math.max(0, qcAcceptedThisCycle - alreadyOpNet);

  const cycleUsableRemaining = Math.max(0, qcAcceptedThisCycle + recheckAcceptedThisCycle - alreadyOpNet);

  const dispatchableQty = computeNoQtyDispatchHeadroom({
    cycleCap,
    alreadyOpNet,
    usableStock: cycleUsableRemaining,
    qcAcceptedThisCycle,
  });

  const remainingAfterCap = Math.max(0, cycleCap - alreadyOpNet);
  const qcBacked = Math.max(0, qcAcceptedThisCycle - alreadyOpNet);
  const classification = classifyNoQtyBindingLimiters(remainingAfterCap, cycleUsableRemaining, dispatchableQty);

  const qcRowsRaw = await prisma.qcEntry.findMany({
    where: {
      reversedAt: null,
      production: {
        workOrderLine: {
          fgItemId: itemId,
          workOrder: { salesOrderId: soId },
        },
      },
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      acceptedQty: true,
      production: {
        select: {
          workOrderLine: {
            select: {
              id: true,
              workOrder: {
                select: {
                  id: true,
                  cycleId: true,
                  requirementSheetId: true,
                  requirementSheet: { select: { id: true, cycleId: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const contributingQcRows = [];
  const otherQcRows = [];
  for (const r of qcRowsRaw) {
    const wo = r.production?.workOrderLine?.workOrder;
    const eff =
      wo?.cycleId != null
        ? Number(wo.cycleId)
        : wo?.requirementSheet?.cycleId != null
          ? Number(wo.requirementSheet.cycleId)
          : null;
    const resolution =
      wo?.cycleId != null
        ? "WORK_ORDER.cycleId"
        : wo?.requirementSheet?.cycleId != null
          ? "REQUIREMENT_SHEET.cycleId_via_WO"
          : "NONE";
    const row = {
      qcEntryId: r.id,
      acceptedQty: num(r.acceptedQty),
      workOrderId: wo?.id ?? null,
      workOrderCycleId: wo?.cycleId != null ? Number(wo.cycleId) : null,
      workOrderRequirementSheetId: wo?.requirementSheetId ?? null,
      requirementSheetId: wo?.requirementSheet?.id ?? null,
      requirementSheetCycleId: wo?.requirementSheet?.cycleId != null ? Number(wo.requirementSheet.cycleId) : null,
      resolvedCycleIdForRow: eff,
      cycleResolutionSource: resolution,
      countsTowardActiveCycle: normalizePositiveCycleId(eff) === currentCycleId,
    };
    if (row.countsTowardActiveCycle) contributingQcRows.push(row);
    else otherQcRows.push(row);
  }

  return {
    salesOrderId: soId,
    currentCycleId,
    itemId,
    itemName: fgLine.item?.itemName ?? `Item #${itemId}`,
    lockedRequirementSheetId: sheet?.id ?? null,
    cycleCapQty: cycleCap,
    cycleOperationalNetDispatchedQty: alreadyOpNet,
    cycleOperationalDispatchRowsIncludedCount: cycleDispatchRecords.length,
    cycleOperationalDispatchRowIds: cycleDispatchRecords.map((d) => d.id),
    cycleCapRemaining,
    cycleQcAcceptedQty: qcAcceptedThisCycle,
    cycleRecheckAcceptedQty: recheckAcceptedThisCycle,
    qcRemainingAfterOperationalDispatch: qcRemainingAfterOperationalDispatch,
    cycleUsableRemainingQty: cycleUsableRemaining,
    finalDispatchHeadroom_dispatchableQty: dispatchableQty,
    computeNoQtyDispatchHeadroom_inputs: {
      cycleCap,
      alreadyOpNet,
      usableStock: cycleUsableRemaining,
      qcAcceptedThisCycle,
    },
    intermediateTerms_same_as_computeNoQtyDispatchHeadroom: {
      remainingAfterCap: remainingAfterCap,
      qcBackedAfterSubtractingOperationalDispatch: qcBacked,
      cycleUsableRemainingQty: cycleUsableRemaining,
    },
    bindingLimiters: classification.bindingLimiters,
    bindingClassification: classification,
    whichTermIsZeroIfDispatchableIsZero:
      dispatchableQty <= REPORT_QUEUE_EPS
        ? {
            capBlocks: remainingAfterCap <= REPORT_QUEUE_EPS,
            stockBlocks: cycleUsableRemaining <= REPORT_QUEUE_EPS,
            qcPoolInformational: qcBacked,
          }
        : null,
    contributingQcRows,
    otherQcRowsForSameSoAndItem_excludedFromCycleSum: otherQcRows,
    capLineSource: capLine
      ? {
          requirementSheetLineId: capLine.id,
          suggestedWoQtySnapshot: num(capLine.suggestedWoQtySnapshot ?? 0),
          requirementQty: num(capLine.requirementQty ?? 0),
        }
      : null,
    note:
      "Temporary admin debug. Headroom = min(cap remaining, usable FG). Cycle QC accepted is informational. " +
      "cycleOperationalNetDispatchedQty uses ONLY Dispatch rows with cycleId === currentCycleId (null cycleId rows excluded).",
  };
}

dispatchRouter.get("/no-qty-debug", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const soId = Number(req.query.soId);
    const itemId = Number(req.query.itemId);
    const cycleIdQ = req.query.cycleId != null && String(req.query.cycleId).trim() !== "" ? req.query.cycleId : null;
    if (!Number.isFinite(soId) || soId <= 0 || !Number.isFinite(itemId) || itemId <= 0) {
      return res.status(400).json({ error: { message: "Query soId and itemId (positive integers) are required." } });
    }
    const payload = await buildNoQtyDispatchDebugPayload(soId, itemId, cycleIdQ != null ? Number(cycleIdQ) : undefined);
    return res.json(payload);
  } catch (e) {
    return next(e);
  }
});

/**
 * GET /api/dispatch/no-qty-cycles?soId=
 * ACTIVE cycles only (dropdown for NO_QTY dispatch).
 */
dispatchRouter.get("/no-qty-cycles", requireAuth, requireRole(["ADMIN", "SALES", "STORE"]), async (req, res, next) => {
  try {
    const soId = Number(req.query.soId);
    if (!Number.isFinite(soId) || soId <= 0) {
      return res.status(400).json({ error: { message: "Query soId (positive integer) is required." } });
    }
    await prisma.$transaction(async (tx) => {
      await repairNoQtyCycleIntegrity(tx, soId);
    });
    const so = await prisma.salesOrder.findUnique({
      where: { id: soId },
      select: { id: true, orderType: true },
    });
    if (!so || so.orderType !== "NO_QTY") {
      return res.status(400).json({ error: { message: "A No Qty sales order is required." } });
    }
    const cycles = await prisma.salesOrderCycle.findMany({
      where: { salesOrderId: soId, status: "ACTIVE" },
      orderBy: { cycleNo: "asc" },
      select: { id: true, cycleNo: true, status: true },
    });
    const out = [];
    for (const c of cycles) {
      const sheet = await prisma.requirementSheet.findFirst({
        where: { salesOrderId: soId, cycleId: c.id, status: "LOCKED" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      out.push({
        cycleId: c.id,
        cycleNo: c.cycleNo,
        cycleLabel: `Cycle ${c.cycleNo}`,
        status: c.status,
        lockedRequirementSheetId: sheet?.id ?? null,
      });
    }
    return res.json({ cycles: out });
  } catch (e) {
    return next(e);
  }
});

function attachDispatchMaxReversibleQty(dispatchRows) {
  const rows = [...(dispatchRows || [])];
  return rows.map((d) => {
    const base = { ...d };
    if (d.reversalOfId != null) {
      return { ...base, maxReversibleQty: null, ledgerMetricContext: METRIC_CONTEXT.DISPATCH_LEDGER };
    }
    if (d.workflowStatus === "UNLOCKED") {
      return { ...base, maxReversibleQty: null, ledgerMetricContext: METRIC_CONTEXT.DISPATCH_LEDGER };
    }
    const q = Number(d.dispatchedQty);
    if (q <= 0) {
      return { ...base, maxReversibleQty: 0, ledgerMetricContext: METRIC_CONTEXT.DISPATCH_LEDGER };
    }
    const reversed = rows
      .filter((x) => x.reversalOfId === d.id)
      .reduce((s, x) => s + Math.abs(Number(x.dispatchedQty)), 0);
    return { ...base, maxReversibleQty: Math.max(0, q - reversed), ledgerMetricContext: METRIC_CONTEXT.DISPATCH_LEDGER };
  });
}

dispatchRouter.get("/sales-orders", requireAuth, requireRole(["ADMIN", "SALES", "STORE"]), async (req, res, next) => {
  try {
    const noQtySoIdQ = Number(req.query.noQtySoId);
    const noQtyCycleRaw = req.query.noQtyCycleId;
    const hasNoQtyCycleOverride =
      Number.isFinite(noQtySoIdQ) &&
      noQtySoIdQ > 0 &&
      noQtyCycleRaw != null &&
      String(noQtyCycleRaw).trim() !== "";

    /** @type {{ id: number; cycleNo: number; salesOrderId: number } | null} */
    let validatedNoQtyOverride = null;
    if (hasNoQtyCycleOverride) {
      const cid = normalizePositiveCycleId(noQtyCycleRaw);
      if (cid == null) {
        const err = new Error("Invalid noQtyCycleId.");
        err.statusCode = 400;
        throw err;
      }
      const c = await prisma.salesOrderCycle.findFirst({
        where: { id: cid, salesOrderId: noQtySoIdQ, status: "ACTIVE" },
        select: { id: true, cycleNo: true, salesOrderId: true },
      });
      if (!c) {
        const err = new Error("noQtyCycleId is not an active cycle for this sales order.");
        err.statusCode = 400;
        throw err;
      }
      validatedNoQtyOverride = c;
    }

    /**
     * NO_QTY only: selected cycle from query override (validated) or SO.currentCycleId.
     * @param {{ orderType?: string; id: number; currentCycleId?: number | null }} so
     */
    function effectiveNoQtyCycleId(so) {
      if (so.orderType !== "NO_QTY") return null;
      if (validatedNoQtyOverride && so.id === noQtySoIdQ) return validatedNoQtyOverride.id;
      return normalizePositiveCycleId(so.currentCycleId);
    }

    const [rows, bucketStockRows, qcAcceptedMap] = await Promise.all([
      prisma.salesOrder.findMany({
        orderBy: { id: "desc" },
        include: {
          po: { include: { customer: true } },
          customer: true,
          quotation: true,
          lines: { include: { item: true } },
          dispatch: true,
        },
      }),
      prisma.stockTransaction.groupBy({
        by: ["itemId", "stockBucket"],
        where: { stockBucket: { in: ["USABLE", "QC_HOLD", "QC_PENDING", "REWORK"] } },
        _sum: { qtyIn: true, qtyOut: true },
      }),
      buildQcAcceptedMap(prisma),
    ]);
    const replacementQcGrossBySoItem = await buildReplacementReturnQcGrossBySoItemKey(prisma, rows, qcAcceptedMap);

    /** @type {Map<number, number>} */
    const onHandByItemId = new Map();
    /** @type {Map<number, number>} */
    const qcHoldByItemId = new Map();
    /** @type {Map<number, number>} */
    const qcPendingByItemId = new Map();
    /** @type {Map<number, number>} */
    const reworkByItemId = new Map();
    for (const r of bucketStockRows) {
      const net = Number(r._sum.qtyIn ?? 0) - Number(r._sum.qtyOut ?? 0);
      if (r.stockBucket === "USABLE") onHandByItemId.set(r.itemId, net);
      else if (r.stockBucket === "QC_HOLD") qcHoldByItemId.set(r.itemId, net);
      else if (r.stockBucket === "QC_PENDING") qcPendingByItemId.set(r.itemId, net);
      else if (r.stockBucket === "REWORK") reworkByItemId.set(r.itemId, net);
    }

    // Preload latest LOCKED requirement sheet caps for NO_QTY effective cycles (override or current).
    const noQtySos = rows.filter((so) => so.orderType === "NO_QTY" && effectiveNoQtyCycleId(so) != null);
    const noQtySoIds = noQtySos.map((so) => so.id);
    const noQtyCycleIds = [...new Set(noQtySos.map((so) => effectiveNoQtyCycleId(so)).filter((x) => x != null))];
    const noQtyCapBySoCycleKey = new Map();
    const noQtySosForQc = rows.filter((so) => so.orderType === "NO_QTY" && effectiveNoQtyCycleId(so) != null);
    const noQtySoCycleInputs = noQtySosForQc.map((s) => ({ id: s.id, currentCycleId: effectiveNoQtyCycleId(s) }));
    const [cycleQcAcceptedMap, cycleRecheckAcceptedMap] = await Promise.all([
      loadNoQtyCycleQcAcceptedMap(prisma, noQtySoCycleInputs),
      loadNoQtyCycleRecheckAcceptedMap(prisma, noQtySoCycleInputs),
    ]);

    if (noQtySoIds.length && noQtyCycleIds.length) {
      const lockedSheets = await prisma.requirementSheet.findMany({
        where: {
          salesOrderId: { in: noQtySoIds },
          cycleId: { in: noQtyCycleIds },
          status: "LOCKED",
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { lines: { include: { item: true } } },
      });
      for (const sh of lockedSheets) {
        const k = `${sh.salesOrderId}:${Number(sh.cycleId)}`;
        if (noQtyCapBySoCycleKey.has(k)) continue; // already took latest
        const capsByItemId = new Map();
        for (const ln of sh.lines || []) {
          // NO_QTY: cycle cap should be at least the New WO qty (requirementQty), even when stock covers it.
          // Older locked sheets may have suggestedWoQtySnapshot = 0 (legacy EXCESS behavior). Use a safe fallback.
          const cap = Math.max(num(ln.suggestedWoQtySnapshot ?? 0), num(ln.requirementQty ?? 0));
          if (!(cap > REPORT_QUEUE_EPS)) continue;
          capsByItemId.set(ln.itemId, {
            cap,
            itemName: ln.item?.itemName ?? `Item #${ln.itemId}`,
            // NO_QTY snapshots for UI clarity (do not change dispatch core math).
            fulfillmentQtySnapshot: num(ln.requirementQty ?? 0),
            productionRequiredQtySnapshot: num(ln.suggestedWoQtySnapshot ?? 0),
            availableStockQtySnapshot: ln.availableStockQtySnapshot != null ? num(ln.availableStockQtySnapshot) : null,
            shortfallQtySnapshot: ln.shortfallQtySnapshot != null ? num(ln.shortfallQtySnapshot) : null,
          });
        }
        noQtyCapBySoCycleKey.set(k, { capsByItemId });
      }
    }

    /** @type {Map<number, { cycleNo: number }>} */
    const cycleMetaById = new Map();
    if (noQtyCycleIds.length) {
      const metaRows = await prisma.salesOrderCycle.findMany({
        where: { id: { in: noQtyCycleIds } },
        select: { id: true, cycleNo: true },
      });
      for (const m of metaRows) cycleMetaById.set(m.id, m);
    }

    const TRACE_SO_ID = 26;
    const TRACE_ITEM_NAME_LC = "cap";
    const enriched = rows.map((so) => {
      // NO_QTY: override dispatch eligibility using cycle cap + usable stock only.
      if (so.orderType === "NO_QTY") {
        const eff = effectiveNoQtyCycleId(so);
        const meta = eff != null ? cycleMetaById.get(eff) : null;
        const { lineStats, blockedReason: noQtyDispatchBlockedReason } = buildNoQtyLineStats({
          soId: so.id,
          currentCycleId: eff,
          dispatchRecords: so.dispatch,
          onHandByItemId,
          noQtyCapBySoCycleKey,
          cycleQcAcceptedMap,
          cycleRecheckAcceptedMap,
          salesOrderLines: so.lines,
        });
        if (Number(so.id) === TRACE_SO_ID) {
          const match = (lineStats || []).find((ls) => String(ls.itemName || "").trim().toLowerCase() === TRACE_ITEM_NAME_LC);
          console.debug("[DISPATCH_SALES_ORDERS_TRACE][NO_QTY][BEFORE_FILTER]", {
            salesOrderId: so.id,
            orderType: so.orderType,
            currentCycleId: so.currentCycleId ?? null,
            effectiveCycleId: eff,
            noQtyLockedCapKey: eff != null ? `${so.id}:${eff}` : null,
            lineStatsCount: (lineStats || []).length,
            capLineForCapItem: match
              ? {
                  itemId: match.itemId,
                  itemName: match.itemName,
                  usableStock_used: match.usableQcPassedStock ?? null,
                  cycleCapRemaining: match.cycleCapRemaining ?? null,
                  dispatchable: match.dispatchable ?? null,
                  pendingDispatchQty: match.pendingDispatchQty ?? null,
                  dispatchPendingLock: match.dispatchPendingLock ?? null,
                  dispatchBlockedReason: match.dispatchBlockedReason ?? null,
                }
              : null,
          });
        }
        return {
          ...so,
          flowMode: "NO_QTY_SO",
          // NO_QTY dispatch eligibility is cycle-cap + usable stock driven.
          // internalStatus=COMPLETED can occur even when a new cycle is active (SO line qty is often 0),
          // so do not block dispatch purely on COMPLETED. Only CLOSED is treated as view-only.
          dispatchReadOnly: so.internalStatus === "CLOSED",
          noQtyDispatchBlockedReason,
          noQtyDispatchContext:
            eff != null
              ? {
                  selectedCycleId: eff,
                  cycleNo: meta?.cycleNo ?? null,
                  cycleLabel: meta?.cycleNo != null ? `Cycle ${meta.cycleNo}` : null,
                }
              : null,
          lineStats,
          dispatch: attachDispatchMaxReversibleQty(so.dispatch),
          dispatchMetricHints: {
            qcApprovedRemaining: METRIC_DEFINITIONS.qcApprovedRemaining,
            dispatchableQty: METRIC_DEFINITIONS.dispatchableQty,
            metricContextLegend: METRIC_CONTEXT,
          },
        };
      }

      const lineInputs = mapSoLinesToDispatchFifoInputs(so.lines, so.orderType);
      const { alloc: allocOp, netByItem } = buildSoLineDispatchAllocation(
        lineInputs,
        so.dispatch,
        DISPATCH_ALLOC_MODE.OPERATIONAL,
      );
      const { alloc: allocConf } = buildSoLineDispatchAllocation(
        lineInputs,
        so.dispatch,
        DISPATCH_ALLOC_MODE.CONFIRMED,
      );
      /** @type {Map<number, number>} */
      const qcAcceptedTotalByItemId = new Map();
      for (const li of lineInputs) {
        const repKey = `${so.id}:${li.itemId}`;
        let qcGross = qcAcceptedMap.get(repKey) ?? 0;
        if (so.orderType === "REPLACEMENT" && replacementQcGrossBySoItem.has(repKey)) {
          qcGross = replacementQcGrossBySoItem.get(repKey) ?? 0;
        }
        qcAcceptedTotalByItemId.set(li.itemId, qcGross);
      }
      const dispatchableByLineId = buildDispatchableQtyBySalesOrderLineId({
        orderLineInputs: lineInputs,
        dispatchRecords: so.dispatch,
        orderType: so.orderType,
        onHandByItemId,
        qcAcceptedTotalByItemId,
      });
      const lineStats = so.lines.map((line) => {
        const attrOp = getSoLineAttributedDispatchedQty(allocOp, line.id);
        const dispatched = getSoLineAttributedDispatchedQty(allocConf, line.id);
        const dispatchPendingLock = Math.max(0, attrOp - dispatched);
        const fifoCommitment = dispatchFifoQtyForSoLine(line, so.orderType);
        const remaining = getSoLineOrderQtyMinusAttributedDispatch(fifoCommitment, attrOp);
        const pendingDispatchQty = getSoLineDispatchPendingQty(fifoCommitment, dispatched);
        const onHand = onHandByItemId.get(line.itemId) ?? 0;
        const qcHoldQty = qcHoldByItemId.get(line.itemId) ?? 0;
        const qcPendingQty = qcPendingByItemId.get(line.itemId) ?? 0;
        const reworkQty = reworkByItemId.get(line.itemId) ?? 0;
        const inQcReworkQty = qcHoldQty + qcPendingQty + reworkQty;
        const repKey = `${so.id}:${line.itemId}`;
        let qcGrossForLine = qcAcceptedMap.get(repKey) ?? 0;
        if (so.orderType === "REPLACEMENT" && replacementQcGrossBySoItem.has(repKey)) {
          qcGrossForLine = replacementQcGrossBySoItem.get(repKey) ?? 0;
        }
        const qcAccepted = qcGrossForLine;
        const netForItem = netByItem.get(line.itemId) ?? 0;
        const qcApprovedRemaining = getSoItemQcApprovedRemainingQty(qcAccepted, netForItem);
        const dispatchable = dispatchableByLineId.get(line.id) ?? 0;
        const dispatchBlockedReason = getDispatchBlockedReason({
          orderType: so.orderType,
          pendingDispatchQty,
          dispatchable,
          operationalRemaining: remaining,
          totalStock: onHand,
          qcHoldQty,
          qcPendingQty,
          reworkQty,
          qcAcceptedGross: qcAccepted,
          qcApprovedRemaining,
        });
        /** Copied commercial flag from SO line; display-only (does not affect dispatchable qty or stock rules). */
        const isFree = Boolean(line.isFree);
        return {
          lineId: line.id,
          itemId: line.itemId,
          itemName: line.item.itemName,
          /** Operational net dispatch for this SO + FG item (draft UNLOCKED forwards + LOCKED + reversals). */
          operationalNetDispatchedQty: netForItem,
          orderQty: fifoCommitment,
          ...(so.orderType === "NORMAL"
            ? {
                customerPoQty: Number(line.customerPoQty ?? line.qty),
                bufferPercent: Number(line.bufferPercent ?? 0),
                plannedQty: Number(line.qty),
              }
            : {}),
          isFree,
          dispatched,
          dispatchPendingLock,
          remaining,
          pendingDispatchQty,
          onHand,
          /** Same as onHand — global usable FG for this SKU (matches GET /api/stock/summary scope). */
          totalStock: onHand,
          qcAccepted,
          /** Gross QC accepted for this sales order + FG item (production + adjustment QC); display label "QC approved". */
          qcApprovedStock: qcAccepted,
          qcApprovedRemaining,
          /** FG in QC hold, awaiting QC, or rework buckets (global for SKU; display only). */
          inQcReworkQty,
          dispatchable,
          dispatchableQty: dispatchable,
          dispatchBlockedReason,
          regularDispatchReadiness: regularDispatchReadinessLabel(so.orderType, pendingDispatchQty, dispatchable),
          quantityContexts: {
            soLineRemaining: { qty: remaining, metricContext: METRIC_CONTEXT.SO_FIFO },
            qcPoolRemaining: { qty: qcApprovedRemaining, metricContext: METRIC_CONTEXT.QC_POOL },
            dispatchableQty: { qty: dispatchable, metricContext: METRIC_CONTEXT.DISPATCHABLE_MIN },
          },
        };
      });
      return {
        ...so,
        flowMode: "REGULAR_SO",
        dispatchReadOnly: so.internalStatus === "COMPLETED",
        lineStats,
        dispatch: attachDispatchMaxReversibleQty(so.dispatch),
        dispatchMetricHints: {
          qcApprovedRemaining: METRIC_DEFINITIONS.qcApprovedRemaining,
          dispatchableQty: METRIC_DEFINITIONS.dispatchableQty,
          metricContextLegend: METRIC_CONTEXT,
        },
      };
    });

    const pendingFirst = enriched
      .map((so) => {
        if (so.orderType === "NO_QTY") {
          // Line stats already omit SO lines with no remaining customer demand (see buildNoQtyLineStats).
          return { ...so, lineStats: so.lineStats || [] };
        }
        return {
          ...so,
          // Keep rows visible when a draft/Prepared dispatch exists, even if pendingDispatchQty is 0.
          lineStats: (so.lineStats || []).filter(
            (l) => Number(l.pendingDispatchQty) > 0 || Number(l.dispatchPendingLock ?? 0) > 0,
          ),
        };
      })
      .filter((so) => (so.lineStats || []).length > 0);

    if (pendingFirst.some((so) => Number(so.id) === TRACE_SO_ID)) {
      const so = pendingFirst.find((x) => Number(x.id) === TRACE_SO_ID);
      const match = (so?.lineStats || []).find((ls) => String(ls.itemName || "").trim().toLowerCase() === TRACE_ITEM_NAME_LC);
      console.debug("[DISPATCH_SALES_ORDERS_TRACE][AFTER_PENDING_FIRST]", {
        salesOrderId: so?.id ?? null,
        orderType: so?.orderType ?? null,
        dispatchReadOnly: Boolean(so?.dispatchReadOnly),
        keptBecause_lineStatsNonEmpty: Boolean((so?.lineStats || []).length > 0),
        capItem: match
          ? {
              itemId: match.itemId,
              itemName: match.itemName,
              usableStock_used: match.usableQcPassedStock ?? null,
              cycleCapRemaining: match.cycleCapRemaining ?? null,
              dispatchable: match.dispatchable ?? null,
            }
          : null,
      });
    } else if (enriched.some((so) => Number(so.id) === TRACE_SO_ID)) {
      console.debug("[DISPATCH_SALES_ORDERS_TRACE][AFTER_PENDING_FIRST_EXCLUDED]", {
        salesOrderId: TRACE_SO_ID,
        reason: "Filtered out because lineStats empty after pendingFirst stage.",
      });
    }

    const filtered = pendingFirst.filter((so) => !so.dispatchReadOnly);
    if (filtered.some((so) => Number(so.id) === TRACE_SO_ID)) {
      console.debug("[DISPATCH_SALES_ORDERS_TRACE][FINAL_INCLUDED]", { salesOrderId: TRACE_SO_ID });
    } else if (pendingFirst.some((so) => Number(so.id) === TRACE_SO_ID)) {
      const so = pendingFirst.find((x) => Number(x.id) === TRACE_SO_ID);
      console.debug("[DISPATCH_SALES_ORDERS_TRACE][FINAL_EXCLUDED]", {
        salesOrderId: TRACE_SO_ID,
        dispatchReadOnly: Boolean(so?.dispatchReadOnly),
        reason: Boolean(so?.dispatchReadOnly) ? "dispatchReadOnly true" : "unknown",
      });
    } else if (enriched.some((so) => Number(so.id) === TRACE_SO_ID)) {
      console.debug("[DISPATCH_SALES_ORDERS_TRACE][FINAL_EXCLUDED]", {
        salesOrderId: TRACE_SO_ID,
        reason: "excluded before readOnly stage (lineStats empty).",
      });
    }

    return res.json(filtered);
  } catch (e) {
    return next(e);
  }
});

/**
 * GET /api/dispatch/sales-orders-debug?soId=
 * Admin-only: dumps the computed dispatch row (pre/post filtering) for one SO id.
 * This is intended to troubleshoot cases where trace/report data exists but the Dispatch page shows "complete".
 */
dispatchRouter.get("/sales-orders-debug", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const soIdQ = Number(req.query.soId);
    if (!Number.isFinite(soIdQ) || soIdQ <= 0) {
      return res.status(400).json({ error: { message: "Query soId (positive integer) is required." } });
    }

    // Reuse the same computation path as /sales-orders, but scoped to one SO.
    const so = await prisma.salesOrder.findUnique({
      where: { id: soIdQ },
      include: {
        po: { include: { customer: true } },
        customer: true,
        quotation: true,
        lines: { include: { item: true } },
        dispatch: true,
      },
    });
    if (!so) return res.status(404).json({ error: { message: "Sales order not found." } });

    const [bucketStockRows, qcAcceptedMap] = await Promise.all([
      prisma.stockTransaction.groupBy({
        by: ["itemId", "stockBucket"],
        where: { stockBucket: { in: ["USABLE", "QC_HOLD", "QC_PENDING", "REWORK"] } },
        _sum: { qtyIn: true, qtyOut: true },
      }),
      buildQcAcceptedMap(prisma),
    ]);
    const replacementQcGrossBySoItem = await buildReplacementReturnQcGrossBySoItemKey(prisma, [so], qcAcceptedMap);

    const onHandByItemId = new Map();
    const qcHoldByItemId = new Map();
    const qcPendingByItemId = new Map();
    const reworkByItemId = new Map();
    for (const r of bucketStockRows) {
      const net = Number(r._sum.qtyIn ?? 0) - Number(r._sum.qtyOut ?? 0);
      if (r.stockBucket === "USABLE") onHandByItemId.set(r.itemId, net);
      else if (r.stockBucket === "QC_HOLD") qcHoldByItemId.set(r.itemId, net);
      else if (r.stockBucket === "QC_PENDING") qcPendingByItemId.set(r.itemId, net);
      else if (r.stockBucket === "REWORK") reworkByItemId.set(r.itemId, net);
    }

    const effectiveNoQtyCycleId = (soRow) => (soRow.orderType === "NO_QTY" ? normalizePositiveCycleId(soRow.currentCycleId) : null);
    const eff = effectiveNoQtyCycleId(so);

    // NO_QTY requirement sheet caps (latest LOCKED for effective cycle).
    const noQtyCapBySoCycleKey = new Map();
    const cycleMetaById = new Map();
    let lockedSheetId = null;
    if (so.orderType === "NO_QTY" && eff != null) {
      const meta = await prisma.salesOrderCycle.findUnique({ where: { id: eff }, select: { id: true, cycleNo: true } });
      if (meta) cycleMetaById.set(meta.id, meta);

      const lockedSheets = await prisma.requirementSheet.findMany({
        where: { salesOrderId: so.id, cycleId: eff, status: "LOCKED" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { lines: { include: { item: true } } },
        take: 1,
      });
      const sh = lockedSheets[0];
      if (sh) {
        lockedSheetId = sh.id;
        const capsByItemId = new Map();
        for (const ln of sh.lines || []) {
          const cap = Math.max(num(ln.suggestedWoQtySnapshot ?? 0), num(ln.requirementQty ?? 0));
          if (!(cap > REPORT_QUEUE_EPS)) continue;
          capsByItemId.set(ln.itemId, { cap, itemName: ln.item?.itemName ?? `Item #${ln.itemId}` });
        }
        noQtyCapBySoCycleKey.set(`${so.id}:${eff}`, { capsByItemId });
      }
    }

    const cycleQcAcceptedMap =
      so.orderType === "NO_QTY" && eff != null ? await loadNoQtyCycleQcAcceptedMap(prisma, [{ id: so.id, currentCycleId: eff }]) : new Map();
    const cycleRecheckAcceptedMap =
      so.orderType === "NO_QTY" && eff != null ? await loadNoQtyCycleRecheckAcceptedMap(prisma, [{ id: so.id, currentCycleId: eff }]) : new Map();

    let enriched;
    if (so.orderType === "NO_QTY") {
      const meta = eff != null ? cycleMetaById.get(eff) : null;
      const { lineStats, blockedReason: noQtyDispatchBlockedReason } = buildNoQtyLineStats({
        soId: so.id,
        currentCycleId: eff,
        dispatchRecords: so.dispatch,
        onHandByItemId,
        noQtyCapBySoCycleKey,
        cycleQcAcceptedMap,
        cycleRecheckAcceptedMap,
        salesOrderLines: so.lines,
      });
      enriched = {
        ...so,
        flowMode: "NO_QTY_SO",
        dispatchReadOnly: so.internalStatus === "CLOSED",
        noQtyDispatchBlockedReason,
        noQtyDispatchContext:
          eff != null
            ? { selectedCycleId: eff, cycleNo: meta?.cycleNo ?? null, cycleLabel: meta?.cycleNo != null ? `Cycle ${meta.cycleNo}` : null }
            : null,
        lineStats,
        dispatch: attachDispatchMaxReversibleQty(so.dispatch),
      };
    } else {
      const lineInputs = mapSoLinesToDispatchFifoInputs(so.lines, so.orderType);
      const { alloc: allocOp, netByItem } = buildSoLineDispatchAllocation(lineInputs, so.dispatch, DISPATCH_ALLOC_MODE.OPERATIONAL);
      const { alloc: allocConf } = buildSoLineDispatchAllocation(lineInputs, so.dispatch, DISPATCH_ALLOC_MODE.CONFIRMED);

      const qcAcceptedTotalByItemId = new Map();
      for (const li of lineInputs) {
        const repKey = `${so.id}:${li.itemId}`;
        let qcGross = qcAcceptedMap.get(repKey) ?? 0;
        if (so.orderType === "REPLACEMENT" && replacementQcGrossBySoItem.has(repKey)) {
          qcGross = replacementQcGrossBySoItem.get(repKey) ?? 0;
        }
        qcAcceptedTotalByItemId.set(li.itemId, qcGross);
      }
      const dispatchableByLineId = buildDispatchableQtyBySalesOrderLineId({
        orderLineInputs: lineInputs,
        dispatchRecords: so.dispatch,
        orderType: so.orderType,
        onHandByItemId,
        qcAcceptedTotalByItemId,
      });

      const lineStats = so.lines.map((line) => {
        const attrOp = getSoLineAttributedDispatchedQty(allocOp, line.id);
        const dispatched = getSoLineAttributedDispatchedQty(allocConf, line.id);
        const dispatchPendingLock = Math.max(0, attrOp - dispatched);
        const fifoCommitment = dispatchFifoQtyForSoLine(line, so.orderType);
        const remaining = getSoLineOrderQtyMinusAttributedDispatch(fifoCommitment, attrOp);
        const pendingDispatchQty = getSoLineDispatchPendingQty(fifoCommitment, dispatched);
        const onHand = onHandByItemId.get(line.itemId) ?? 0;
        const qcHoldQty = qcHoldByItemId.get(line.itemId) ?? 0;
        const qcPendingQty = qcPendingByItemId.get(line.itemId) ?? 0;
        const reworkQty = reworkByItemId.get(line.itemId) ?? 0;
        const inQcReworkQty = qcHoldQty + qcPendingQty + reworkQty;
        const repKey = `${so.id}:${line.itemId}`;
        let qcGrossForLine = qcAcceptedMap.get(repKey) ?? 0;
        if (so.orderType === "REPLACEMENT" && replacementQcGrossBySoItem.has(repKey)) {
          qcGrossForLine = replacementQcGrossBySoItem.get(repKey) ?? 0;
        }
        const qcAccepted = qcGrossForLine;
        const netForItem = netByItem.get(line.itemId) ?? 0;
        const qcApprovedRemaining = getSoItemQcApprovedRemainingQty(qcAccepted, netForItem);
        const dispatchable = dispatchableByLineId.get(line.id) ?? 0;
        const dispatchBlockedReason = getDispatchBlockedReason({
          orderType: so.orderType,
          pendingDispatchQty,
          dispatchable,
          operationalRemaining: remaining,
          totalStock: onHand,
          qcHoldQty,
          qcPendingQty,
          reworkQty,
          qcAcceptedGross: qcAccepted,
          qcApprovedRemaining,
        });
        return {
          lineId: line.id,
          itemId: line.itemId,
          itemName: line.item.itemName,
          operationalNetDispatchedQty: netForItem,
          orderQty: fifoCommitment,
          ...(so.orderType === "NORMAL"
            ? {
                customerPoQty: Number(line.customerPoQty ?? line.qty),
                bufferPercent: Number(line.bufferPercent ?? 0),
                plannedQty: Number(line.qty),
              }
            : {}),
          isFree: Boolean(line.isFree),
          dispatched,
          dispatchPendingLock,
          remaining,
          pendingDispatchQty,
          onHand,
          totalStock: onHand,
          qcAccepted,
          qcApprovedStock: qcAccepted,
          qcApprovedRemaining,
          inQcReworkQty,
          dispatchable,
          dispatchableQty: dispatchable,
          dispatchBlockedReason,
          regularDispatchReadiness: regularDispatchReadinessLabel(so.orderType, pendingDispatchQty, dispatchable),
        };
      });
      enriched = {
        ...so,
        flowMode: "REGULAR_SO",
        dispatchReadOnly: so.internalStatus === "COMPLETED",
        lineStats,
        dispatch: attachDispatchMaxReversibleQty(so.dispatch),
      };
    }

    const afterPendingFirst =
      enriched.orderType === "NO_QTY"
        ? { ...enriched, lineStats: enriched.lineStats || [] }
        : {
            ...enriched,
            lineStats: (enriched.lineStats || []).filter(
              (l) => Number(l.pendingDispatchQty) > 0 || Number(l.dispatchPendingLock ?? 0) > 0,
            ),
          };
    const afterLineFilterIncluded = (afterPendingFirst.lineStats || []).length > 0;
    const afterReadOnlyIncluded = afterLineFilterIncluded && !afterPendingFirst.dispatchReadOnly;

    return res.json({
      soId: so.id,
      orderType: so.orderType,
      internalStatus: so.internalStatus,
      noQtyEffectiveCycleId: eff,
      noQtyLockedRequirementSheetId: lockedSheetId,
      enrichedRow_beforeFiltering: enriched,
      row_afterPendingFirst: afterPendingFirst,
      included_afterPendingFirst: afterLineFilterIncluded,
      included_afterReadOnlyFilter: afterReadOnlyIncluded,
      note:
        "If included_afterPendingFirst is false, the SO will not show on Dispatch open list. " +
        "For NO_QTY, check locked requirement sheet, cycle id, and usable stock basis (USABLE bucket).",
    });
  } catch (e) {
    return next(e);
  }
});

/** YYYY-MM-DD → UTC day bounds for `Dispatch.date` filtering. */
function parseLedgerYmdStartUtc(ymd) {
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const t = Date.parse(`${ymd}T00:00:00.000Z`);
  return Number.isNaN(t) ? null : new Date(t);
}

function parseLedgerYmdEndUtc(ymd) {
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const t = Date.parse(`${ymd}T23:59:59.999Z`);
  return Number.isNaN(t) ? null : new Date(t);
}

/**
 * GET /api/dispatch/ledger
 * Query: limit (page size, default 10, max 100), offset (default 0), from, to (YYYY-MM-DD, optional, UTC day bounds).
 * Dispatch audit view: draft + locked + reversals, newest first.
 * Open list remains separate (GET /sales-orders filters by backlog).
 */
dispatchRouter.get("/ledger", requireAuth, requireRole(["ADMIN", "SALES", "STORE"]), async (req, res, next) => {
  try {
    const limitIn = Number(req.query.limit ?? 10);
    const limit = Number.isFinite(limitIn) ? Math.max(1, Math.min(100, Math.floor(limitIn))) : 10;

    const offsetIn = Number(req.query.offset ?? 0);
    const offset = Number.isFinite(offsetIn) ? Math.max(0, Math.floor(offsetIn)) : 0;

    const includeDispatchIdRaw = Number(req.query.includeDispatchId ?? 0);
    const includeDispatchId =
      Number.isFinite(includeDispatchIdRaw) && includeDispatchIdRaw > 0 ? includeDispatchIdRaw : null;

    const fromQ = req.query.from;
    const toQ = req.query.to;
    // When opening a draft by id, we must not hide it behind date filters/pagination.
    const fromDate =
      includeDispatchId != null
        ? null
        : fromQ != null && String(fromQ).trim() !== ""
          ? parseLedgerYmdStartUtc(String(fromQ).trim())
          : null;
    const toDate =
      includeDispatchId != null
        ? null
        : toQ != null && String(toQ).trim() !== ""
          ? parseLedgerYmdEndUtc(String(toQ).trim())
          : null;

    if (fromQ != null && String(fromQ).trim() !== "" && !fromDate) {
      const err = new Error("Invalid from date; use YYYY-MM-DD.");
      err.statusCode = 400;
      throw err;
    }
    if (toQ != null && String(toQ).trim() !== "" && !toDate) {
      const err = new Error("Invalid to date; use YYYY-MM-DD.");
      err.statusCode = 400;
      throw err;
    }
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      const err = new Error("from date must be on or before to date.");
      err.statusCode = 400;
      throw err;
    }

    const dateFilter = {};
    if (fromDate) dateFilter.gte = fromDate;
    if (toDate) dateFilter.lte = toDate;
    const soIdLedger = Number(req.query.soId);
    const cycleIdLedger = normalizePositiveCycleId(req.query.cycleId);
    /** NO_QTY: optional scope to one SO + cycle (does not affect NORMAL flows — query-only). */
    const where = {};
    if (Object.keys(dateFilter).length) where.date = dateFilter;
    if (Number.isFinite(soIdLedger) && soIdLedger > 0) where.soId = soIdLedger;
    if (cycleIdLedger != null) where.cycleId = cycleIdLedger;

    const [total, rows] = await prisma.$transaction([
      prisma.dispatch.count({ where }),
      prisma.dispatch.findMany({
        where,
        orderBy: [{ date: "desc" }, { id: "desc" }],
        skip: offset,
        take: limit,
        include: {
          item: true,
          salesOrder: { include: { customer: true, po: { include: { customer: true } } } },
        },
      }),
    ]);

    const dispatchIds = rows.map((d) => d.id);
    /** @type {Map<number, { id: number; isExported: boolean; status: string }>} */
    const billByDispatchId = new Map();
    if (dispatchIds.length) {
      const bills = await prisma.salesBill.findMany({
        where: { dispatchId: { in: dispatchIds } },
        select: { id: true, dispatchId: true, isExported: true, status: true },
      });
      for (const b of bills) {
        billByDispatchId.set(Number(b.dispatchId), {
          id: Number(b.id),
          isExported: Boolean(b.isExported),
          status: String(b.status),
        });
      }
    }

    const payload = rows.map((d) => ({
      id: d.id,
      date: d.date,
      soId: d.soId,
      cycleId: d.cycleId ?? null,
      docNo: d.docNo ?? null,
      soDocNo: d.salesOrder?.docNo ?? null,
      soOrderType: d.salesOrder?.orderType ?? null,
      itemId: d.itemId,
      itemName: d.item?.itemName ?? null,
      customerName:
        d.salesOrder?.customer?.name?.trim() ||
        d.salesOrder?.po?.customer?.name?.trim() ||
        null,
      dispatchedQty: String(d.dispatchedQty),
      reversalOfId: d.reversalOfId ?? null,
      reversalReason: d.reversalReason ?? null,
      workflowStatus: d.workflowStatus,
      // Sales bill export state (bill-based; do not rely on dispatch-only flags).
      salesBillId: billByDispatchId.get(Number(d.id))?.id ?? null,
      salesBillExists: billByDispatchId.has(Number(d.id)),
      salesBillIsExported: billByDispatchId.get(Number(d.id))?.isExported === true,
      salesBillStatus: billByDispatchId.get(Number(d.id))?.status ?? null,
    }));

    // Ensure includeDispatchId row is present even if outside pagination slice.
    if (includeDispatchId != null && !payload.some((r) => Number(r.id) === Number(includeDispatchId))) {
      const extra = await prisma.dispatch.findUnique({
        where: { id: includeDispatchId },
        include: {
          item: true,
          salesOrder: { include: { customer: true, po: { include: { customer: true } } } },
        },
      });
      if (extra) {
        const bill = await prisma.salesBill.findFirst({
          where: { dispatchId: extra.id },
          select: { id: true, isExported: true, status: true },
        });
        payload.unshift({
          id: extra.id,
          date: extra.date,
          soId: extra.soId,
          cycleId: extra.cycleId ?? null,
          docNo: extra.docNo ?? null,
          soDocNo: extra.salesOrder?.docNo ?? null,
          soOrderType: extra.salesOrder?.orderType ?? null,
          itemId: extra.itemId,
          itemName: extra.item?.itemName ?? null,
          customerName:
            extra.salesOrder?.customer?.name?.trim() ||
            extra.salesOrder?.po?.customer?.name?.trim() ||
            null,
          dispatchedQty: String(extra.dispatchedQty),
          reversalOfId: extra.reversalOfId ?? null,
          reversalReason: extra.reversalReason ?? null,
          workflowStatus: extra.workflowStatus,
          salesBillId: bill?.id ?? null,
          salesBillExists: Boolean(bill),
          salesBillIsExported: bill?.isExported === true,
          salesBillStatus: bill?.status ?? null,
        });
      }
    }

    return res.json({ rows: payload, limit, offset, total });
  } catch (e) {
    return next(e);
  }
});

/**
 * GET /api/dispatch/dispatches/:id
 * Fetch a single dispatch row (draft or locked) with enough context to reopen a prepared draft by id.
 */
dispatchRouter.get("/dispatches/:id", requireAuth, requireRole(["ADMIN", "SALES", "STORE"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      const err = new Error("Invalid dispatch id.");
      err.statusCode = 400;
      throw err;
    }

    const d = await prisma.dispatch.findUnique({
      where: { id },
      include: {
        item: { select: { id: true, itemName: true } },
        salesOrder: { select: { id: true, docNo: true, orderType: true, currentCycleId: true } },
      },
    });
    if (!d) {
      const err = new Error("Dispatch not found.");
      err.statusCode = 404;
      throw err;
    }

    // Only drafts are meant to be reopened via this endpoint.
    if (d.workflowStatus !== "UNLOCKED" || d.reversalOfId != null) {
      const err = new Error("Only prepared (draft) dispatch rows can be reopened.");
      err.statusCode = 409;
      throw err;
    }

    const line = await prisma.salesOrderLine.findFirst({
      where: { soId: d.soId, itemId: d.itemId },
      orderBy: { id: "asc" },
      select: { id: true },
    });

    return res.json({
      id: d.id,
      docNo: d.docNo ?? null,
      workflowStatus: d.workflowStatus,
      date: d.date,
      soId: d.soId,
      soDocNo: d.salesOrder?.docNo ?? null,
      soOrderType: d.salesOrder?.orderType ?? null,
      itemId: d.itemId,
      itemName: d.item?.itemName ?? null,
      cycleId: d.cycleId ?? null,
      qty: String(d.dispatchedQty),
      salesOrderLineId: line?.id ?? null,
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * GET /api/dispatch/eligible-sales-orders-for-item?itemId=
 * Approved / in-process sales orders that include the given FG item (for QC allocation dropdowns).
 * Sorted with SOs that have confirmed dispatch backlog for that item first.
 */
dispatchRouter.get(
  "/eligible-sales-orders-for-item",
  requireAuth,
  requireRole(["ADMIN", "SALES", "STORE", "QC"]),
  async (req, res, next) => {
    try {
      const itemId = Number(req.query.itemId);
      if (!Number.isFinite(itemId) || itemId <= 0) {
        const err = new Error("Valid itemId is required.");
        err.statusCode = 400;
        throw err;
      }

      const item = await prisma.item.findUnique({ where: { id: itemId }, select: { id: true, itemType: true } });
      if (!item) {
        const err = new Error("Item not found.");
        err.statusCode = 404;
        throw err;
      }
      if (item.itemType !== "FG") {
        const err = new Error("Only FG items are supported for this list.");
        err.statusCode = 400;
        throw err;
      }

      const orders = await prisma.salesOrder.findMany({
        where: {
          internalStatus: { in: ["APPROVED", "IN_PROCESS"] },
          lines: { some: { itemId } },
        },
        orderBy: { id: "desc" },
        include: {
          customer: true,
          lines: true,
          dispatch: true,
        },
      });

      /** @type {{ salesOrderId: number; salesOrderNo: string; customerName: string | null; pendingDispatchQty: number }[]} */
      const rows = [];

      for (const so of orders) {
        const lineInputs = mapSoLinesToDispatchFifoInputs(so.lines, so.orderType);
        const wantCycle = so.orderType === "NO_QTY" ? normalizePositiveCycleId(so.currentCycleId) : null;
        const dispatchForAlloc =
          so.orderType === "NO_QTY"
            ? wantCycle != null
              ? (so.dispatch || []).filter((d) => normalizePositiveCycleId(d.cycleId) === wantCycle)
              : []
            : so.dispatch;
        const { alloc } = buildSoLineDispatchAllocation(lineInputs, dispatchForAlloc, DISPATCH_ALLOC_MODE.CONFIRMED);

        let pendingSumForItem = 0;
        for (const line of so.lines) {
          if (line.itemId !== itemId) continue;
          const ordered = dispatchFifoQtyForSoLine(line, so.orderType);
          const attributed = getSoLineAttributedDispatchedQty(alloc, line.id);
          pendingSumForItem += getSoLineDispatchPendingQty(ordered, attributed);
        }

        rows.push({
          salesOrderId: so.id,
          salesOrderNo: `SO-${so.id}`,
          customerName: so.customer?.name ?? null,
          pendingDispatchQty: pendingSumForItem,
        });
      }

      rows.sort((a, b) => {
        const ab = a.pendingDispatchQty > REPORT_QUEUE_EPS ? 1 : 0;
        const bb = b.pendingDispatchQty > REPORT_QUEUE_EPS ? 1 : 0;
        if (bb !== ab) return bb - ab;
        return b.salesOrderId - a.salesOrderId;
      });

      return res.json({ rows });
    } catch (e) {
      return next(e);
    }
  },
);

dispatchRouter.post("/dispatches", requireAuth, requireRole(["ADMIN", "SALES"]), async (req, res, next) => {
  try {
    const schema = z.object({
      soId: z.number().int(),
      itemId: z.number().int(),
      dispatchedQty: z.number().positive(),
      /** NO_QTY only: must match an ACTIVE SalesOrderCycle for this SO (dropdown selection). */
      cycleId: z.number().int().positive().optional(),
    });
    const body = schema.parse(req.body);
    const idempotencyKey = normalizeIdempotencyKey(req.get("Idempotency-Key") ?? req.get("idempotency-key"));
    const requestBodyHash = hashRequestBody(body);
    const userId = req.user.userId;

    const txResult = await prisma.$transaction(async (tx) => {
      await lockSalesOrderForUpdate(tx, body.soId);
      await lockItemForUpdate(tx, body.itemId);

      const idem = await claimOrReplayDispatchIdempotency(tx, {
        userId,
        routeKey: ROUTE_KEYS.POST_DISPATCHES,
        idempotencyKey,
        requestBodyHash,
      });
      if (idem.replay) {
        return { status: idem.status, body: idem.body };
      }

      const so = await tx.salesOrder.findUnique({
        where: { id: body.soId },
        include: { lines: true, dispatch: true },
      });
      if (!so) {
        const err = new Error("Sales order not found");
        err.statusCode = 404;
        throw err;
      }
      // Regular SOs require explicit approval before dispatch.
      // NO_QTY dispatch is cycle+stock driven (Requirement Sheet lock + QC-passed stock), and does NOT depend on approval.
      if (so.internalStatus === "DRAFT" && so.orderType !== "NO_QTY") {
        const err = new Error("Dispatch requires an approved sales order.");
        err.statusCode = 409;
        throw err;
      }
      assertSalesOrderNotCompletedForDispatch(so);

      const line = so.lines.find((l) => l.itemId === body.itemId);
      if (!line) {
        const err = new Error("Item not on this sales order");
        err.statusCode = 400;
        throw err;
      }

      const isNoQty = so.orderType === "NO_QTY";
      /** @type {number | null} */
      let currentCycleId = null;
      if (isNoQty) {
        const requested = normalizePositiveCycleId(body.cycleId ?? so.currentCycleId);
        if (requested == null) throw friendlyNoQtyDispatchError("No active cycle available for dispatch.");
        const activeCycle = await tx.salesOrderCycle.findFirst({
          where: { id: requested, salesOrderId: so.id, status: "ACTIVE" },
          select: { id: true },
        });
        if (!activeCycle) throw friendlyNoQtyDispatchError("Select a valid active cycle for dispatch.");
        currentCycleId = activeCycle.id;
        const sheet = await tx.requirementSheet.findFirst({
          where: { salesOrderId: so.id, cycleId: currentCycleId, status: "LOCKED" },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: { lines: { include: { item: true } } },
        });
        if (!sheet) throw friendlyNoQtyDispatchError("Requirement Sheet must be locked before dispatch.");
        const capLine = (sheet.lines || []).find((ln) => ln.itemId === body.itemId);
        if (!capLine) throw friendlyNoQtyDispatchError("This item is not available in the current cycle.", 400);
        // Keep consistent with GET /api/dispatch/sales-orders NO_QTY cap fallback:
        // older LOCKED sheets may have suggestedWoQtySnapshot = 0 (legacy EXCESS behavior).
        const cycleCap = Math.max(num(capLine.suggestedWoQtySnapshot ?? 0), num(capLine.requirementQty ?? 0));
        if (!(cycleCap > REPORT_QUEUE_EPS)) throw friendlyNoQtyDispatchError("No dispatchable quantity remaining for this cycle.");

        const usable = await getItemStockQty(body.itemId, tx, { stockBucket: "USABLE" });
        const allowedDispatchQty = Math.max(0, Math.min(cycleCap, num(usable)));
        if (!(allowedDispatchQty > REPORT_QUEUE_EPS)) {
          if (!(num(usable) > REPORT_QUEUE_EPS)) throw friendlyNoQtyDispatchError("Usable QC-passed stock is not available.");
          throw friendlyNoQtyDispatchError("No dispatchable quantity remaining for this cycle.");
        }
        if (!(body.dispatchedQty > 0)) throw friendlyNoQtyDispatchError("Dispatch quantity must be greater than zero.", 400);
        if (body.dispatchedQty > allowedDispatchQty + 1e-6) throw friendlyNoQtyDispatchError("Dispatch exceeds current cycle allowed quantity.", 400);
      } else {
        const lineInputs = mapSoLinesToDispatchFifoInputs(so.lines, so.orderType);
        await assertDispatchAllowedForSoItem(
          tx,
          {
            soId: so.id,
            itemId: body.itemId,
            lineInputs,
            dispatchRecords: so.dispatch,
            requestQty: body.dispatchedQty,
          },
          { skipStockCheck: true },
        );
      }

      /** Draft row: UNLOCKED until POST /dispatches/:id/lock posts stock (DISPATCH) and sets LOCKED. */
      // UX guard: reuse/update existing draft for same SO + item instead of creating overlapping drafts.
      const existingDraft = await tx.dispatch.findFirst({
        where: {
          soId: so.id,
          itemId: body.itemId,
          ...(isNoQty ? { cycleId: currentCycleId } : {}),
          reversalOfId: null,
          workflowStatus: "UNLOCKED",
        },
        orderBy: { id: "desc" },
      });

      const dispatch = existingDraft
        ? await tx.dispatch.update({
            where: { id: existingDraft.id },
            data: { dispatchedQty: String(body.dispatchedQty) },
          })
        : await tx.dispatch.create({
            data: {
              docNo: await allocateDocNo(tx, { docType: DocType.DISPATCH, date: new Date() }),
              soId: so.id,
              itemId: body.itemId,
              ...(isNoQty ? { cycleId: currentCycleId } : {}),
              dispatchedQty: String(body.dispatchedQty),
              reversalOfId: null,
              workflowStatus: "UNLOCKED",
            },
          });

      const payload = { dispatch };
      await completeDispatchIdempotency(tx, {
        userId,
        routeKey: ROUTE_KEYS.POST_DISPATCHES,
        idempotencyKey,
        responseStatus: existingDraft ? 200 : 201,
        body: payload,
      });

      return { status: existingDraft ? 200 : 201, body: payload };
    });

    return res.status(txResult.status).json(txResult.body);
  } catch (e) {
    return next(e);
  }
});

/**
 * Confirm draft dispatch: post FG stock out and set LOCKED. Idempotent via Idempotency-Key.
 */
dispatchRouter.post("/dispatches/:id/lock", requireAuth, requireRole(["ADMIN", "SALES", "STORE"]), async (req, res, next) => {
  /** @type {number | null} */
  let debugExistingId = null;
  /** @type {string | null} */
  let debugOrderType = null;
  /** @type {number | null} */
  let debugQty = null;
  try {
    console.debug("[LOCK_ROUTE_ENTRY]", { id: req.params.id });
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      const err = new Error("Invalid dispatch id");
      err.statusCode = 400;
      throw err;
    }
    const idempotencyKey = normalizeIdempotencyKey(req.get("Idempotency-Key") ?? req.get("idempotency-key"));
    const requestBodyHash = hashRequestBody({ dispatchId: id });
    const userId = req.user.userId;

    const txResult = await prisma.$transaction(async (tx) => {
      await lockDispatchForUpdate(tx, id);

      const existing = await tx.dispatch.findUnique({ where: { id } });
      if (!existing) {
        const err = new Error("Dispatch not found");
        err.statusCode = 404;
        throw err;
      }
      debugExistingId = Number(existing.id);
      if (existing.reversalOfId != null) {
        const err = new Error("Only forward dispatch rows can be locked.");
        err.statusCode = 400;
        throw err;
      }
      if (existing.workflowStatus !== "UNLOCKED") {
        const err = new Error(
          existing.workflowStatus === "LOCKED"
            ? "This dispatch is already locked."
            : "This dispatch cannot be locked.",
        );
        err.statusCode = 409;
        throw err;
      }

      await lockSalesOrderForUpdate(tx, existing.soId);
      await lockItemForUpdate(tx, existing.itemId);

      const idem = await claimOrReplayDispatchIdempotency(tx, {
        userId,
        routeKey: ROUTE_KEYS.POST_DISPATCH_LOCK,
        idempotencyKey,
        requestBodyHash,
      });
      if (idem.replay) {
        return { status: idem.status, body: idem.body };
      }

      const so = await tx.salesOrder.findUnique({
        where: { id: existing.soId },
        include: { lines: true, dispatch: true, customer: true },
      });
      if (!so) {
        const err = new Error("Sales order not found");
        err.statusCode = 404;
        throw err;
      }
      debugOrderType = so.orderType ?? null;
      assertSalesOrderNotCompletedForDispatch(so);
      const qty = Number(existing.dispatchedQty);
      debugQty = Number.isFinite(qty) ? qty : null;
      console.debug("[LOCK_BEFORE_VALIDATE]", { dispatchId: existing?.id ?? null, orderType: so?.orderType ?? null, qty });
      const isNoQty = so.orderType === "NO_QTY";
      /** @type {number | null} */
      let currentCycleId = null;
      if (isNoQty) {
        const dispatchCycleId = normalizePositiveCycleId(existing.cycleId);
        if (dispatchCycleId == null) {
          throw friendlyNoQtyDispatchError("This dispatch row has no cycle; it cannot be finalized.", 409);
        }
        const activeCycle = await tx.salesOrderCycle.findFirst({
          where: { id: dispatchCycleId, salesOrderId: so.id, status: "ACTIVE" },
          select: { id: true },
        });
        if (!activeCycle) {
          throw friendlyNoQtyDispatchError("This dispatch belongs to a cycle that is not active.", 409);
        }
        currentCycleId = activeCycle.id;

        // Existing prepared dispatch finalize should not be re-blocked by recomputing headroom/cap at lock time.
        // The draft row already represents the reserved intent; finalize simply posts stock and locks it.
        const isDraftFinalize = existing.workflowStatus === "UNLOCKED" && existing.reversalOfId == null;
        if (!(qty > 0)) throw friendlyNoQtyDispatchError("Prepared dispatch quantity must be greater than 0.", 400);

        /** @type {number | null} */
        let currentCycleCap = null;
        /** @type {number | null} */
        let finalDispatchableQty = null;
        // Validate draft finalize against the final NO_QTY rule:
        // currentPreparedQty <= min(current RS qty, usable stock). Do NOT include previous dispatch history.
        const sheet = await tx.requirementSheet.findFirst({
          where: { salesOrderId: so.id, cycleId: currentCycleId, status: "LOCKED" },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: { lines: true },
        });
        if (!sheet) throw friendlyNoQtyDispatchError("Requirement Sheet must be locked before dispatch.");
        const capLine = (sheet.lines || []).find((ln) => ln.itemId === existing.itemId);
        if (!capLine) throw friendlyNoQtyDispatchError("This item is not available in the current cycle.", 400);
        const cycleCapQty = Math.max(num(capLine.suggestedWoQtySnapshot ?? 0), num(capLine.requirementQty ?? 0));
        currentCycleCap = cycleCapQty;
        const usable = await getItemStockQty(existing.itemId, tx, { stockBucket: "USABLE" });
        const allowedDispatchQty = Math.max(0, Math.min(cycleCapQty, num(usable)));
        finalDispatchableQty = allowedDispatchQty;

        if (qty > allowedDispatchQty + 1e-6) {
          throw friendlyNoQtyDispatchError("Dispatch exceeds current cycle allowed quantity.", 400);
        }

        console.debug("[FINALIZE_CHECK]", {
          dispatchId: existing.id,
          qty,
          currentCycleCap,
          finalDispatchableQty,
          mode: isDraftFinalize ? "draft-finalize" : "headroom-validate",
        });
      } else {
        const lineInputs = mapSoLinesToDispatchFifoInputs(so.lines, so.orderType);
        const others = so.dispatch.filter((x) => x.id !== id);
        await assertDispatchAllowedForSoItem(tx, {
          soId: existing.soId,
          itemId: existing.itemId,
          lineInputs,
          dispatchRecords: others,
          requestQty: qty,
          orderType: so.orderType,
          customerReturnId: so.customerReturnId ?? null,
          lockTraceDispatchId: Number(existing.id),
        });
      }
      console.debug("[LOCK_AFTER_VALIDATE]", { dispatchId: existing?.id ?? null });

      const stockBefore = await getItemStockQty(existing.itemId, tx);
      console.debug("[LOCK_BEFORE_POST]", { dispatchId: existing?.id ?? null });

      await assertUsableStockBeforeDispatchOut(tx, existing.itemId, qty);
      await tx.stockTransaction.create({
        data: {
          itemId: existing.itemId,
          transactionType: "DISPATCH",
          refId: id,
          stockBucket: "USABLE",
          qtyIn: "0",
          qtyOut: String(existing.dispatchedQty),
        },
      });

      const dispatch = await tx.dispatch.update({
        where: { id },
        data: { workflowStatus: "LOCKED" },
      });

      const stockAfter = await getItemStockQty(existing.itemId, tx);

      await auditLog.write(tx, {
        action: auditLog.AuditAction.UPDATE,
        entityType: auditLog.AuditEntityType.DISPATCH,
        entityId: String(id),
        actorUserId: userId,
        actorRole: req.user.role,
        summary: `Dispatch #${id} confirmed (SO-${existing.soId}, ${qty} qty)`,
        payload: {
          snapshot: {
            salesOrderId: existing.soId,
            salesOrderNo: `SO-${existing.soId}`,
            itemId: existing.itemId,
            dispatchedQty: qty,
            workflowStatus: "LOCKED",
          },
          stockBefore,
          stockAfter,
          changes: {
            workflowStatus: { from: "UNLOCKED", to: "LOCKED" },
          },
        },
      });

      const dDoc = displayDispatchNo(id, dispatch.docNo ?? existing.docNo);
      const cycLock =
        isNoQty && currentCycleId != null
          ? await tx.salesOrderCycle.findUnique({
              where: { id: Number(currentCycleId) },
              select: { id: true, cycleNo: true },
            })
          : null;
      const lockHuman =
        isNoQty && cycLock?.cycleNo != null ? `Dispatch ${dDoc} locked for NO_QTY Cycle ${cycLock.cycleNo}` : `Dispatch ${dDoc} locked`;
      await logActivity({
        tx,
        user: req.user,
        module: ACTIVITY_MODULES.DISPATCH,
        entityType: ACTIVITY_ENTITY_TYPES.DISPATCH,
        entityId: id,
        docNo: dDoc,
        action: ACTIVITY_ACTIONS.LOCKED,
        message: lockHuman,
        metadata: {
          salesOrderId: so.id,
          salesOrderDocNo: displaySalesOrderNo(so.id, so.docNo),
          customerId: so.customerId ?? so.customer?.id,
          customerName: so.customer?.name,
          cycleId: cycLock?.id ?? (isNoQty && existing.cycleId != null ? Number(existing.cycleId) : undefined),
          cycleNo: cycLock?.cycleNo ?? undefined,
          itemIds: existing.itemId,
          totalQty: qty,
          netQty: qty,
          orderType: so.orderType,
        },
      });

      const payload = { dispatch };
      await completeDispatchIdempotency(tx, {
        userId,
        routeKey: ROUTE_KEYS.POST_DISPATCH_LOCK,
        idempotencyKey,
        responseStatus: 200,
        body: payload,
      });

      console.debug("[LOCK_SUCCESS]", { dispatchId: existing?.id ?? null });
      return { status: 200, body: payload };
    });

    return res.status(txResult.status).json(txResult.body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[LOCK_REJECT]", {
      dispatchId: debugExistingId,
      orderType: debugOrderType,
      qty: debugQty,
      message: msg,
    });
    return next(e);
  }
});

/**
 * POST /api/dispatch/dispatches/:id/finalize-draft
 * Rigid finalize path for an existing prepared (UNLOCKED) forward dispatch row by id.
 * This must not depend on UI "open lines" or any workbench selection state.
 */
dispatchRouter.post(
  "/dispatches/:id/finalize-draft",
  requireAuth,
  requireRole(["ADMIN", "SALES", "STORE"]),
  async (req, res, next) => {
    /** @type {number | null} */
    let debugExistingId = null;
    /** @type {string | null} */
    let debugOrderType = null;
    /** @type {number | null} */
    let debugQty = null;
    try {
      console.debug("[FINALIZE_DRAFT_ENTRY]", { id: req.params.id });
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        const err = new Error("Invalid dispatch id");
        err.statusCode = 400;
        throw err;
      }

      const idempotencyKey = normalizeIdempotencyKey(req.get("Idempotency-Key") ?? req.get("idempotency-key"));
      const requestBodyHash = hashRequestBody({ dispatchId: id, action: "finalize-draft" });
      const userId = req.user.userId;

      const txResult = await prisma.$transaction(async (tx) => {
        await lockDispatchForUpdate(tx, id);
        const existing = await tx.dispatch.findUnique({ where: { id } });
        if (!existing) {
          const err = new Error("Dispatch not found");
          err.statusCode = 404;
          throw err;
        }
        debugExistingId = Number(existing.id);

        if (existing.reversalOfId != null) {
          const err = new Error("Only forward dispatch rows can be finalized.");
          err.statusCode = 400;
          throw err;
        }
        if (existing.workflowStatus !== "UNLOCKED") {
          const err = new Error("Only prepared (draft) dispatch rows can be finalized.");
          err.statusCode = 409;
          throw err;
        }

        await lockSalesOrderForUpdate(tx, existing.soId);
        await lockItemForUpdate(tx, existing.itemId);

        const idem = await claimOrReplayDispatchIdempotency(tx, {
          userId,
          // Keep idempotency semantics identical to the lock flow (finalize by id).
          routeKey: ROUTE_KEYS.POST_DISPATCH_LOCK,
          idempotencyKey,
          requestBodyHash,
        });
        if (idem.replay) {
          return { status: idem.status, body: idem.body };
        }

        const so = await tx.salesOrder.findUnique({
          where: { id: existing.soId },
          include: { lines: true, dispatch: true, customer: true },
        });
        if (!so) {
          const err = new Error("Sales order not found");
          err.statusCode = 404;
          throw err;
        }
        debugOrderType = so.orderType ?? null;
        const qty = Number(existing.dispatchedQty);
        debugQty = Number.isFinite(qty) ? qty : null;
        if (!(qty > 0)) {
          const err = new Error("Prepared dispatch quantity must be greater than 0.");
          err.statusCode = 400;
          throw err;
        }

        console.debug("[FINALIZE_DRAFT_VALIDATE]", {
          dispatchId: existing.id,
          orderType: so.orderType,
          qty,
          cycleId: existing.cycleId ?? null,
          itemId: existing.itemId,
        });

        assertSalesOrderNotCompletedForDispatch(so);

        if (so.orderType === "NO_QTY") {
          const dispatchCycleId = normalizePositiveCycleId(existing.cycleId);
          if (dispatchCycleId == null) {
            throw friendlyNoQtyDispatchError("This dispatch row has no cycle; it cannot be finalized.", 409);
          }
          const activeCycle = await tx.salesOrderCycle.findFirst({
            where: { id: dispatchCycleId, salesOrderId: so.id, status: "ACTIVE" },
            select: { id: true },
          });
          if (!activeCycle) {
            throw friendlyNoQtyDispatchError("This dispatch belongs to a cycle that is not active.", 409);
          }

          const sheet = await tx.requirementSheet.findFirst({
            where: { salesOrderId: so.id, cycleId: activeCycle.id, status: "LOCKED" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            include: { lines: true },
          });
          if (!sheet) throw friendlyNoQtyDispatchError("Requirement Sheet must be locked before dispatch.");
          const capLine = (sheet.lines || []).find((ln) => ln.itemId === existing.itemId);
          if (!capLine) throw friendlyNoQtyDispatchError("This item is not available in the current cycle.", 400);
          const cycleCapQty = Math.max(num(capLine.suggestedWoQtySnapshot ?? 0), num(capLine.requirementQty ?? 0));
          const usable = await getItemStockQty(existing.itemId, tx, { stockBucket: "USABLE" });
          const allowedDispatchQty = Math.max(0, Math.min(cycleCapQty, num(usable)));
          if (qty > allowedDispatchQty + 1e-6) {
            throw friendlyNoQtyDispatchError("Dispatch exceeds current cycle allowed quantity.", 400);
          }
        } else {
          // NORMAL / REPLACEMENT etc: keep standard validation but exclude this draft row from "already dispatched".
          const lineInputs = mapSoLinesToDispatchFifoInputs(so.lines, so.orderType);
          const others = (so.dispatch || []).filter((x) => x.id !== id);
          await assertDispatchAllowedForSoItem(tx, {
            soId: existing.soId,
            itemId: existing.itemId,
            lineInputs,
            dispatchRecords: others,
            requestQty: qty,
            orderType: so.orderType,
            customerReturnId: so.customerReturnId ?? null,
            lockTraceDispatchId: Number(existing.id),
          });
        }

        // Post stock and lock row (same as /lock).
        await assertUsableStockBeforeDispatchOut(tx, existing.itemId, qty);
        await tx.stockTransaction.create({
          data: {
            itemId: existing.itemId,
            transactionType: "DISPATCH",
            refId: id,
            stockBucket: "USABLE",
            qtyIn: "0",
            qtyOut: String(existing.dispatchedQty),
          },
        });

        const dispatch = await tx.dispatch.update({
          where: { id },
          data: { workflowStatus: "LOCKED" },
        });

        await auditLog.write(tx, {
          action: auditLog.AuditAction.UPDATE,
          entityType: auditLog.AuditEntityType.DISPATCH,
          entityId: String(id),
          actorUserId: userId,
          actorRole: req.user.role,
          summary: `Dispatch #${id} confirmed (SO-${existing.soId}, ${qty} qty)`,
          payload: {
            snapshot: {
              salesOrderId: existing.soId,
              salesOrderNo: `SO-${existing.soId}`,
              itemId: existing.itemId,
              dispatchedQty: qty,
              workflowStatus: "LOCKED",
            },
            changes: {
              workflowStatus: { from: "UNLOCKED", to: "LOCKED" },
            },
          },
        });

        const dDoc = displayDispatchNo(id, dispatch.docNo ?? existing.docNo);
        const cycLock =
          so.orderType === "NO_QTY" && existing.cycleId != null
            ? await tx.salesOrderCycle.findUnique({
                where: { id: Number(existing.cycleId) },
                select: { id: true, cycleNo: true },
              })
            : null;
        const lockHuman =
          so.orderType === "NO_QTY" && cycLock?.cycleNo != null
            ? `Dispatch ${dDoc} locked for NO_QTY Cycle ${cycLock.cycleNo}`
            : `Dispatch ${dDoc} locked`;
        await logActivity({
          tx,
          user: req.user,
          module: ACTIVITY_MODULES.DISPATCH,
          entityType: ACTIVITY_ENTITY_TYPES.DISPATCH,
          entityId: id,
          docNo: dDoc,
          action: ACTIVITY_ACTIONS.LOCKED,
          message: lockHuman,
          metadata: {
            salesOrderId: so.id,
            salesOrderDocNo: displaySalesOrderNo(so.id, so.docNo),
            customerId: so.customerId ?? so.customer?.id,
            customerName: so.customer?.name,
            cycleId: cycLock?.id ?? (so.orderType === "NO_QTY" && existing.cycleId != null ? Number(existing.cycleId) : undefined),
            cycleNo: cycLock?.cycleNo ?? undefined,
            itemIds: existing.itemId,
            totalQty: qty,
            netQty: qty,
            orderType: so.orderType,
          },
        });

        console.debug("[FINALIZE_DRAFT_SUCCESS]", { dispatchId: existing.id });

        const payload = { dispatch };
        await completeDispatchIdempotency(tx, {
          userId,
          routeKey: ROUTE_KEYS.POST_DISPATCH_LOCK,
          idempotencyKey,
          responseStatus: 200,
          body: payload,
        });

        return { status: 200, body: payload };
      });

      return res.status(txResult.status).json(txResult.body);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error("[FINALIZE_DRAFT_REJECT]", {
        dispatchId: debugExistingId,
        orderType: debugOrderType,
        qty: debugQty,
        message: errMsg,
      });
      return next(e);
    }
  },
);

/**
 * Cancel a draft (UNLOCKED) dispatch only. Locked rows must use reversal, not delete.
 */
dispatchRouter.delete("/dispatches/:id", requireAuth, requireRole(["ADMIN", "SALES"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      const err = new Error("Invalid dispatch id");
      err.statusCode = 400;
      throw err;
    }

    await prisma.$transaction(async (tx) => {
      await lockDispatchForUpdate(tx, id);
      const d = await tx.dispatch.findUnique({ where: { id } });
      if (!d) {
        const err = new Error("Dispatch not found");
        err.statusCode = 404;
        throw err;
      }
      if (d.reversalOfId != null) {
        const err = new Error("Cannot delete a dispatch reversal row.");
        err.statusCode = 400;
        throw err;
      }
      if (d.workflowStatus !== "UNLOCKED") {
        const err = new Error("Locked dispatch cannot be deleted. Use a reversal instead.");
        err.statusCode = 409;
        throw err;
      }
      await lockSalesOrderForUpdate(tx, d.soId);
      const so = await tx.salesOrder.findUnique({ where: { id: d.soId } });
      if (!so) {
        const err = new Error("Sales order not found");
        err.statusCode = 404;
        throw err;
      }
      assertSalesOrderNotCompletedForDispatch(so);
      await tx.dispatch.delete({ where: { id } });
    });

    return res.sendStatus(204);
  } catch (e) {
    return next(e);
  }
});

/**
 * Reversal: new Dispatch row with negative dispatchedQty + DISPATCH_REVERSAL stock (qtyIn, USABLE).
 * Stock reversal row links reversalOfId → original DISPATCH StockTransaction; when cumulative
 * reversals cover the full forward qty, the forward stock row gets reversedAt (audit; ledger math
 * still uses both rows). Net dispatched = sum(dispatchedQty) per SO line.
 * Only LOCKED forward rows may be reversed; reason is required.
 */
dispatchRouter.post(
  "/reverse",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can reverse dispatch."),
  async (req, res, next) => {
  try {
    const schema = z.object({
      dispatchId: z.number().int().positive(),
      reverseQty: z.number().positive(),
      reason: z.string().min(1, "Reversal reason is required."),
      /** Required only when exported-to-Tally. */
      adminPassword: z.string().min(1).optional(),
    });
    const body = schema.parse(req.body);
    const idempotencyKey = normalizeIdempotencyKey(req.get("Idempotency-Key") ?? req.get("idempotency-key"));
    const requestBodyHash = hashRequestBody(body);
    const userId = req.user.userId;

    const txResult = await prisma.$transaction(async (tx) => {
      // Unlocked read: only discovers soId/itemId so we can lock SalesOrder → Item → Dispatch in that order.
      // It is NOT used for business rules (qty, reversalOfId, etc.). Row may disappear before FOR UPDATE — then
      // lockDispatchForUpdate fails with 404. After locks, `original` (below) is the authoritative forward row.
      const lockRouting = await tx.dispatch.findUnique({
        where: { id: body.dispatchId },
        select: { id: true, soId: true, itemId: true },
      });
      if (!lockRouting) {
        const err = new Error("Dispatch not found");
        err.statusCode = 404;
        throw err;
      }

      await lockSalesOrderForUpdate(tx, lockRouting.soId);
      await lockItemForUpdate(tx, lockRouting.itemId);
      await lockDispatchForUpdate(tx, lockRouting.id);

      const idem = await claimOrReplayDispatchIdempotency(tx, {
        userId,
        routeKey: ROUTE_KEYS.POST_REVERSE,
        idempotencyKey,
        requestBodyHash,
      });
      if (idem.replay) {
        return { status: idem.status, body: idem.body };
      }

      const original = await tx.dispatch.findUnique({
        where: { id: body.dispatchId },
      });
      if (!original) {
        const err = new Error("Dispatch not found");
        err.statusCode = 404;
        throw err;
      }

      if (original.reversalOfId != null) {
        const err = new Error("Cannot reverse a dispatch reversal");
        err.statusCode = 400;
        throw err;
      }

      if (original.workflowStatus !== "LOCKED") {
        const err = new Error(
          original.workflowStatus === "UNLOCKED"
            ? "Lock this dispatch before it can be reversed."
            : "This dispatch cannot be reversed.",
        );
        err.statusCode = 400;
        throw err;
      }

      // Block reversal after Tally export unless admin explicitly overrides.
      const bill = await tx.salesBill.findFirst({
        where: { dispatchId: original.id },
        select: { id: true, isExported: true },
      });
      const isExportedToTally = bill?.isExported === true;
      if (isExportedToTally) {
        await assertAdminPassword(tx, { userId, password: body.adminPassword });
      }

      const originalQty = Number(original.dispatchedQty);
      if (originalQty <= STOCK_EPS) {
        const err = new Error("Cannot reverse this dispatch quantity");
        err.statusCode = 400;
        throw err;
      }

      const so = await tx.salesOrder.findUnique({
        where: { id: original.soId },
        include: { customer: true },
      });
      if (!so) {
        const err = new Error("Sales order not found");
        err.statusCode = 404;
        throw err;
      }

      if (so.orderType === "NO_QTY") {
        const active = normalizePositiveCycleId(so.currentCycleId);
        const forwardCycle = normalizePositiveCycleId(original.cycleId);
        if (active != null && forwardCycle != null && forwardCycle !== active) {
          const err = new Error(
            "Cannot reverse this dispatch: it belongs to a different cycle than the sales order's active cycle.",
          );
          err.statusCode = 409;
          throw err;
        }
      }

      const existingReversals = await tx.dispatch.findMany({
        where: { reversalOfId: original.id },
      });
      const alreadyReversed = existingReversals.reduce(
        (s, r) => s + Math.abs(Number(r.dispatchedQty)),
        0,
      );
      const maxReversible = originalQty - alreadyReversed;
      if (body.reverseQty > maxReversible + STOCK_EPS) {
        const err = new Error("Cannot reverse more than dispatched quantity");
        err.statusCode = 400;
        throw err;
      }

      const reasonTrim = body.reason.trim();
      if (!reasonTrim) {
        const err = new Error("Reversal reason is required.");
        err.statusCode = 400;
        throw err;
      }

      const forwardStockTxn = await tx.stockTransaction.findFirst({
        where: {
          itemId: original.itemId,
          refId: original.id,
          transactionType: "DISPATCH",
        },
        orderBy: { id: "asc" },
      });
      if (!forwardStockTxn) {
        const err = new Error("Dispatch stock posting not found; cannot post reversal.");
        err.statusCode = 500;
        throw err;
      }

      const stockBefore = await getItemStockQty(original.itemId, tx);

      const reversalRow = await tx.dispatch.create({
        data: {
          docNo: await allocateDocNo(tx, { docType: DocType.DISPATCH, date: new Date() }),
          soId: original.soId,
          itemId: original.itemId,
          cycleId: so.orderType === "NO_QTY" ? normalizePositiveCycleId(original.cycleId) : original.cycleId ?? null,
          dispatchedQty: String(-body.reverseQty),
          reversalOfId: original.id,
          reversalReason: reasonTrim,
          workflowStatus: "LOCKED",
        },
      });

      await tx.stockTransaction.create({
        data: {
          itemId: original.itemId,
          transactionType: "DISPATCH_REVERSAL",
          refId: reversalRow.id,
          stockBucket: "USABLE",
          qtyIn: String(body.reverseQty),
          qtyOut: "0",
          reversalOfId: forwardStockTxn.id,
          createdByUserId: userId,
        },
      });

      const totalReversedAfter = alreadyReversed + body.reverseQty;
      if (totalReversedAfter >= originalQty - STOCK_EPS) {
        await tx.stockTransaction.update({
          where: { id: forwardStockTxn.id },
          data: { reversedAt: new Date(), reversedByUserId: userId },
        });
      }

      // If the original dispatch was already exported (via its sales bill), automatically reset export status.
      // This is required to prevent accounting inconsistencies and to allow re-export after correction.
      if (isExportedToTally && bill?.id) {
        await tx.salesBill.update({
          where: { id: bill.id },
          data: {
            isExported: false,
            exportResetAt: new Date(),
            exportResetReason: `Auto reset on dispatch reversal: ${reasonTrim}`.slice(0, 2000),
            exportResetById: userId,
          },
        });
      }

      const stockAfter = await getItemStockQty(original.itemId, tx);

      const soStatusBefore = await tx.salesOrder.findUnique({
        where: { id: original.soId },
        select: { internalStatus: true },
      });
      await reopenSalesOrderIfConfirmedDispatchIncomplete(tx, original.soId);
      const soStatusAfter = await tx.salesOrder.findUnique({
        where: { id: original.soId },
        select: { internalStatus: true },
      });

      /** @type {Record<string, unknown>} */
      const auditPayload = {
        reversedOf: {
          entityType: auditLog.AuditEntityType.DISPATCH,
          entityId: String(original.id),
        },
        reason: reasonTrim,
        isExportedToTally,
        adminPasswordVerified: isExportedToTally ? true : false,
        salesBill: bill?.id
          ? {
              id: bill.id,
              exportReset: isExportedToTally ? true : false,
            }
          : null,
        stockBefore,
        stockAfter,
        snapshot: {
          reverseQty: body.reverseQty,
          forwardDispatchWorkflowStatus: original.workflowStatus,
          reversalDispatchId: reversalRow.id,
        },
      };
      if (
        soStatusBefore &&
        soStatusAfter &&
        soStatusBefore.internalStatus !== soStatusAfter.internalStatus
      ) {
        auditPayload.changes = {
          salesOrderInternalStatus: {
            from: soStatusBefore.internalStatus,
            to: soStatusAfter.internalStatus,
          },
        };
      }

      await auditLog.write(tx, {
        action: auditLog.AuditAction.REVERSE,
        entityType: auditLog.AuditEntityType.DISPATCH,
        entityId: String(reversalRow.id),
        actorUserId: userId,
        actorRole: req.user.role,
        summary: `Dispatch #${original.id} reversed (${body.reverseQty} qty, SO-${original.soId})`,
        payload: auditPayload,
        reason: reasonTrim,
      });

      const fwdDoc = displayDispatchNo(original.id, original.docNo);
      const cyc =
        so.orderType === "NO_QTY" && original.cycleId != null
          ? await tx.salesOrderCycle.findUnique({
              where: { id: Number(original.cycleId) },
              select: { id: true, cycleNo: true },
            })
          : null;
      const revMsg = `Dispatch ${fwdDoc} reversed`;
      await logActivity({
        tx,
        user: req.user,
        module: ACTIVITY_MODULES.DISPATCH,
        entityType: ACTIVITY_ENTITY_TYPES.DISPATCH,
        entityId: original.id,
        docNo: fwdDoc,
        action: ACTIVITY_ACTIONS.REVERSED,
        message: revMsg,
        reason: reasonTrim,
        metadata: {
          salesOrderId: so.id,
          salesOrderDocNo: displaySalesOrderNo(so.id, so.docNo),
          customerId: so.customerId ?? so.customer?.id,
          customerName: so.customer?.name,
          cycleId: cyc?.id ?? (original.cycleId != null ? Number(original.cycleId) : undefined),
          cycleNo: cyc?.cycleNo ?? undefined,
          itemIds: original.itemId,
          totalQty: body.reverseQty,
          orderType: so.orderType,
        },
      });

      const payload = { reversalDispatch: reversalRow };
      await completeDispatchIdempotency(tx, {
        userId,
        routeKey: ROUTE_KEYS.POST_REVERSE,
        idempotencyKey,
        responseStatus: 201,
        body: payload,
      });

      return { status: 201, body: payload };
    });

    return res.status(txResult.status).json(txResult.body);
  } catch (e) {
    return next(e);
  }
});

module.exports = { dispatchRouter, loadNoQtyCycleQcAcceptedMap };
