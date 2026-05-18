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
  getProductionBatchQcPendingQty,
  sumActiveQcAcceptedQty,
  sumActiveQcRejectedQty,
} = require("../services/reportMetrics");
const { QC_ENTRY_ACTIVE_WHERE } = require("../services/qcEntryConstants");
const {
  loadNoQtyDispositionUsableForDispatchPoolMap,
  loadNoQtyPostCycleApprovalMapForInputs,
} = require("../services/noQtyPostCycleApprovalService");
const {
  lockSalesOrderForUpdate,
  lockItemForUpdate,
  lockDispatchForUpdate,
} = require("../services/dispatchWriteLocks");
const { mapSoLinesToDispatchFifoInputs, dispatchFifoQtyForSoLine } = require("../services/regularSoBufferQty");
const { fetchInvoicedQtyBySoId } = require("../services/salesOrderProcessStage");
const {
  filterLineStatsForDispatchOpenList,
  shouldExcludeSalesOrderFromDispatchOpenList,
  isDispatchOpenListLineCandidate,
  isSalesOrderCommerciallyClosedForDispatch,
} = require("../services/dispatchOpenListEligibility");
const { assertAdminPassword } = require("../services/adminPasswordAuth");
const { DISPATCH_WRITE_ROLES, DISPATCH_READ_ROLES, QC_PAGE_ROLES } = require("../constants/erpRoles");
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
const { DocType } = require("../prismaClientPackage");
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
 * NO_QTY prepare validation: net operational dispatch for the cycle+item after applying the requested draft qty
 * (replace existing UNLOCKED draft for that cycle+item, or add a synthetic draft row).
 *
 * @param {Array} soDispatch
 * @param {number} activeCycleId
 * @param {number} itemId
 * @param {number | null | undefined} existingDraftId
 * @param {number} proposedDraftQty
 */
function hypotheticalNoQtyCycleOperationalNetForItem(soDispatch, activeCycleId, itemId, existingDraftId, proposedDraftQty) {
  const want = normalizePositiveCycleId(activeCycleId);
  if (want == null) return 0;
  let rows = filterNoQtyDispatchRowsForActiveCycle(soDispatch, want);
  if (existingDraftId != null) {
    const idNum = Number(existingDraftId);
    const hasDraft = rows.some((d) => Number(d.id) === idNum);
    if (hasDraft) {
      rows = rows.map((d) =>
        Number(d.id) === idNum && d.workflowStatus === "UNLOCKED" && d.reversalOfId == null
          ? { ...d, dispatchedQty: String(proposedDraftQty) }
          : d,
      );
    } else {
      rows = [
        ...rows,
        {
          id: -1,
          itemId,
          dispatchedQty: String(proposedDraftQty),
          workflowStatus: "UNLOCKED",
          reversalOfId: null,
          cycleId: want,
        },
      ];
    }
  } else {
    rows = [
      ...rows,
      {
        id: -1,
        itemId,
        dispatchedQty: String(proposedDraftQty),
        workflowStatus: "UNLOCKED",
        reversalOfId: null,
        cycleId: want,
      },
    ];
  }
  return num(netNoQtyCycleDispatchedByItemId(rows, DISPATCH_ALLOC_MODE.OPERATIONAL).get(Number(itemId)) ?? 0);
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

  /**
   * FINAL DESIGN DECISION:
   * "Late QC" (QC accepted posted after a cycle was closed) must be attributed to the current ACTIVE cycle,
   * not to the historical (closed) work-order cycle.
   *
   * This keeps closed cycles "completed" while still letting new usable stock increase dispatchability on the active cycle.
   */
  const soActiveCycleRows = await prisma.salesOrder.findMany({
    where: { id: { in: soIds }, orderType: "NO_QTY" },
    select: { id: true, currentCycleId: true },
  });
  /** @type {Map<number, number>} */
  const activeCycleIdBySoId = new Map(
    soActiveCycleRows
      .map((r) => [Number(r.id), normalizePositiveCycleId(r.currentCycleId)])
      .filter(([, cid]) => cid != null),
  );

  const rows = await prisma.qcEntry.findMany({
    where: {
      reversedAt: null,
      // QC stock belongs to the production batch; only APPROVED production counts toward dispatchable QC.
      production: {
        workflowStatus: "APPROVED",
        workOrderLine: {
          workOrder: { salesOrderId: { in: soIds } },
        },
      },
    },
    select: {
      acceptedQty: true,
      date: true,
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

  /** Cycle meta for "late QC" reassignment */
  const cycleIds = [
    ...new Set(
      rows
        .map((r) => {
          const wo = r.production?.workOrderLine?.workOrder;
          const raw =
            wo?.cycleId != null
              ? normalizePositiveCycleId(wo.cycleId)
              : wo?.requirementSheet?.cycleId != null
                ? normalizePositiveCycleId(wo.requirementSheet.cycleId)
                : null;
          return raw ?? null;
        })
        .filter((x) => x != null),
    ),
  ];
  const cycleMetaRows =
    cycleIds.length > 0
      ? await prisma.salesOrderCycle.findMany({
          where: { id: { in: cycleIds } },
          select: { id: true, status: true, closedAt: true },
        })
      : [];
  /** @type {Map<number, { status: string; closedAt: Date | null }>} */
  const cycleMetaById = new Map(
    cycleMetaRows.map((c) => [
      Number(c.id),
      {
        status: String(c.status ?? ""),
        closedAt: c.closedAt ? (c.closedAt instanceof Date ? c.closedAt : new Date(c.closedAt)) : null,
      },
    ]),
  );

  /** @type {Map<string, number>} */
  const map = new Map();
  for (const r of rows) {
    const wol = r.production?.workOrderLine;
    const wo = wol?.workOrder;
    if (!wo || wol.fgItemId == null) continue;
    if (num(r.acceptedQty) <= REPORT_QUEUE_EPS) continue;
    const soId = wo.salesOrderId;
    const itemId = wol.fgItemId;
    const cycleIdNorm =
      wo.cycleId != null
        ? normalizePositiveCycleId(wo.cycleId)
        : wo.requirementSheet?.cycleId != null
          ? normalizePositiveCycleId(wo.requirementSheet.cycleId)
          : null;
    if (cycleIdNorm == null) continue;

    // Late QC: if the WO cycle is CLOSED and this QC entry was posted after closedAt, attribute to active cycle.
    let effCycleId = cycleIdNorm;
    const meta = cycleMetaById.get(cycleIdNorm);
    if (meta?.status === "CLOSED" && meta.closedAt instanceof Date && !Number.isNaN(meta.closedAt.getTime())) {
      const qcDate = r.date instanceof Date ? r.date : new Date(r.date);
      if (!Number.isNaN(qcDate.getTime()) && qcDate.getTime() > meta.closedAt.getTime()) {
        const active = activeCycleIdBySoId.get(Number(soId)) ?? null;
        if (active != null) effCycleId = active;
      }
    }

    const k = `${soId}:${effCycleId}:${itemId}`;
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
 * NO_QTY: purely cycle-wise QC eligibility (salesOrderId + cycleId + itemId).
 * dispatchableQty = qcAcceptedForCycle + in-cycle disposition→USABLE + post-cycle approvals from prior closed cycles
 * − same-cycle operational dispatch (incl. drafts).
 *
 * @param {{ alreadyOpNet: number; qcAcceptedThisCycle?: number; recheckAcceptedThisCycle?: number; postCycleApprovalQty?: number }} p
 */
function computeNoQtyDispatchHeadroom(p) {
  const net = num(p.alreadyOpNet);
  const qc = num(p.qcAcceptedThisCycle);
  const recheck = num(p.recheckAcceptedThisCycle ?? 0);
  const post = num(p.postCycleApprovalQty ?? 0);
  return Math.max(0, qc + recheck + post - net);
}

/**
 * NO_QTY: QC-backed headroom for one SO + cycle + FG item (QC + recheck + post-cycle − same-cycle operational net).
 */
function getNoQtyCycleDispatchHeadroomForItem(so, cycleId, itemId, qcMap, recheckMap, postCycleMap) {
  const c = normalizePositiveCycleId(cycleId);
  if (c == null) return 0;
  const qcKey = `${so.id}:${c}:${itemId}`;
  const qcTotal =
    num(qcMap.get(qcKey) ?? 0) + num(recheckMap.get(qcKey) ?? 0) + num(postCycleMap.get(qcKey) ?? 0);
  const net = num(
    netNoQtyCycleDispatchedByItemId(
      filterNoQtyDispatchRowsForActiveCycle(so.dispatch, c),
      DISPATCH_ALLOC_MODE.OPERATIONAL,
    ).get(Number(itemId)) ?? 0,
  );
  return Math.max(0, qcTotal - net);
}

/**
 * FIFO across sales-order cycles (cycleNo ascending) for one FG item: oldest cycle pool first, then next.
 *
 * @returns {{ slices: Array<{ cycleId: number; cycleNo: number; qty: number }>; totalAvailable: number; unallocated: number }}
 */
function computeNoQtyFifoPrepareSlicesForItem({
  so,
  itemId,
  requestedQty,
  cyclesSorted,
  qcMap,
  recheckMap,
  postCycleMap,
}) {
  let rem = num(requestedQty);
  /** @type {Array<{ cycleId: number; cycleNo: number; qty: number }>} */
  const slices = [];
  let totalAvailable = 0;
  for (const c of cyclesSorted) {
    totalAvailable += getNoQtyCycleDispatchHeadroomForItem(so, c.id, itemId, qcMap, recheckMap, postCycleMap);
  }
  for (const c of cyclesSorted) {
    if (rem <= REPORT_QUEUE_EPS) break;
    const headroom = getNoQtyCycleDispatchHeadroomForItem(so, c.id, itemId, qcMap, recheckMap, postCycleMap);
    const take = Math.min(rem, headroom);
    if (take > REPORT_QUEUE_EPS) {
      slices.push({ cycleId: c.id, cycleNo: num(c.cycleNo), qty: take });
      rem -= take;
    }
  }
  return { slices, totalAvailable, unallocated: Math.max(0, rem) };
}

/**
 * NO_QTY only: set {@link SalesOrderCycle.noQtyTreatFgAsOptionalStoreStock} from **QC-backed** per-cycle
 * dispatch headroom after dispatch rows change (prepare / lock / delete draft). True when any FG on that
 * cycle still has positive `getNoQtyCycleDispatchHeadroomForItem` (same basis as FIFO prepare validation).
 * Does not alter dispatch math, stock, or shortage — dashboard / UX intent only.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {number} soId
 * @param {{ qcMapAll: Map<string, number>; recheckMapAll: Map<string, number>; postCycleMapAll: Map<string, number> } | null} mapsOrNull
 *        Pass preloaded maps when already available in the caller transaction; otherwise reloads.
 */
async function syncNoQtyOptionalStoreStockIntentForSalesOrderAfterDispatchChange(tx, soId, mapsOrNull) {
  const soFresh = await tx.salesOrder.findUnique({
    where: { id: soId },
    include: { lines: { include: { item: true } }, dispatch: true },
  });
  if (!soFresh || soFresh.orderType !== "NO_QTY") return;

  const allCycles = await tx.salesOrderCycle.findMany({
    where: { salesOrderId: soId },
    orderBy: { cycleNo: "asc" },
    select: { id: true },
  });
  if (!allCycles.length) return;

  const allCycleInputs = allCycles.map((c) => ({ id: soId, currentCycleId: c.id }));
  let qcMapAll;
  let recheckMapAll;
  let postCycleMapAll;
  if (mapsOrNull) {
    qcMapAll = mapsOrNull.qcMapAll;
    recheckMapAll = mapsOrNull.recheckMapAll;
    postCycleMapAll = mapsOrNull.postCycleMapAll;
  } else {
    [qcMapAll, recheckMapAll, postCycleMapAll] = await Promise.all([
      loadNoQtyCycleQcAcceptedMap(tx, allCycleInputs),
      loadNoQtyDispositionUsableForDispatchPoolMap(tx, allCycleInputs),
      loadNoQtyPostCycleApprovalMapForInputs(tx, allCycleInputs),
    ]);
  }

  const syntheticSo = { id: soFresh.id, dispatch: soFresh.dispatch };

  for (const c of allCycles) {
    const itemIds = collectNoQtyItemIdsForCycle({
      soId: soFresh.id,
      cycleIdNorm: c.id,
      salesOrderLines: soFresh.lines,
      cycleQcAcceptedMap: qcMapAll,
      cycleRecheckAcceptedMap: recheckMapAll,
      postCycleApprovalMap: postCycleMapAll,
      dispatchRecords: soFresh.dispatch,
    });
    let anyRemain = false;
    for (const itemId of itemIds) {
      const h = getNoQtyCycleDispatchHeadroomForItem(syntheticSo, c.id, itemId, qcMapAll, recheckMapAll, postCycleMapAll);
      if (h > REPORT_QUEUE_EPS) {
        anyRemain = true;
        break;
      }
    }
    await tx.salesOrderCycle.update({
      where: { id: c.id },
      data: { noQtyTreatFgAsOptionalStoreStock: anyRemain },
    });
  }
}

/**
 * FG items + any item appearing in QC/recheck maps or dispatch ledger for this cycle.
 */
function collectNoQtyItemIdsForCycle({
  soId,
  cycleIdNorm,
  salesOrderLines,
  cycleQcAcceptedMap,
  cycleRecheckAcceptedMap,
  postCycleApprovalMap,
  dispatchRecords,
}) {
  /** @type {Set<number>} */
  const ids = new Set();
  for (const l of salesOrderLines || []) {
    if (l.item?.itemType === "FG") ids.add(Number(l.itemId));
  }
  const prefix = `${soId}:${cycleIdNorm}:`;
  for (const k of cycleQcAcceptedMap.keys()) {
    if (!String(k).startsWith(prefix)) continue;
    const parts = String(k).split(":");
    const iid = Number(parts[2]);
    if (Number.isFinite(iid) && iid > 0) ids.add(iid);
  }
  for (const k of cycleRecheckAcceptedMap.keys()) {
    if (!String(k).startsWith(prefix)) continue;
    const parts = String(k).split(":");
    const iid = Number(parts[2]);
    if (Number.isFinite(iid) && iid > 0) ids.add(iid);
  }
  if (postCycleApprovalMap) {
    for (const k of postCycleApprovalMap.keys()) {
      if (!String(k).startsWith(prefix)) continue;
      const parts = String(k).split(":");
      const iid = Number(parts[2]);
      if (Number.isFinite(iid) && iid > 0) ids.add(iid);
    }
  }
  for (const d of filterNoQtyDispatchRowsForActiveCycle(dispatchRecords, cycleIdNorm)) {
    const iid = Number(d.itemId);
    if (Number.isFinite(iid) && iid > 0) ids.add(iid);
  }
  return [...ids];
}

/**
 * Cycles where at least one APPROVED production batch still has QC quantity pending (produced − accepted − rejected > 0).
 * Used to enforce true upstream dependency: cannot rely on later-cycle dispatch pools until batches clear QC.
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number[]} salesOrderIds
 * @returns {Promise<Map<number, Set<number>>>} soId → Set of SalesOrderCycle.id
 */
async function loadNoQtyCycleIdsWithBatchQcPendingBySalesOrderIds(db, salesOrderIds) {
  const ids = [...new Set((salesOrderIds || []).filter((x) => Number.isFinite(x) && x > 0))];
  /** @type {Map<number, Set<number>>} */
  const map = new Map();
  for (const sid of ids) map.set(sid, new Set());
  if (!ids.length) return map;

  const wos = await db.workOrder.findMany({
    where: { salesOrderId: { in: ids }, cycleId: { not: null } },
    select: {
      salesOrderId: true,
      cycleId: true,
      lines: {
        select: {
          productions: {
            where: { workflowStatus: "APPROVED" },
            select: {
              producedQty: true,
              qcEntries: { where: QC_ENTRY_ACTIVE_WHERE, select: { acceptedQty: true, rejectedQty: true } },
            },
          },
        },
      },
    },
  });

  for (const wo of wos) {
    const sid = Number(wo.salesOrderId);
    const cid = normalizePositiveCycleId(wo.cycleId);
    if (cid == null) continue;
    const set = map.get(sid);
    if (!set) continue;
    outer: for (const line of wo.lines || []) {
      for (const pe of line.productions || []) {
        const produced = num(pe.producedQty);
        const acc = sumActiveQcAcceptedQty(pe.qcEntries || []);
        const rej = sumActiveQcRejectedQty(pe.qcEntries || []);
        const pend = getProductionBatchQcPendingQty(produced, acc, rej);
        if (pend > REPORT_QUEUE_EPS) {
          set.add(cid);
          break outer;
        }
      }
    }
  }
  return map;
}

/**
 * Sequential gate for NO_QTY: earliest cycle that still **blocks** dispatch from strictly-later cycles.
 *
 * - Skips cycles that only have prepared (UNLOCKED) drafts — stock is already staged; operators may finalize later.
 * - Returns the first cycle (by cycleNo) with positive QC-backed dispatch headroom (must clear pool first).
 * - Otherwise returns the first cycle with **batch QC still pending on production** (true manufacturing dependency).
 *
 * @param {object} p
 * @param {{ lines?: unknown[]; dispatch?: unknown[]; id: number }} p.so
 * @param {{ id: number; cycleNo: number }[]} p.cyclesSorted — all relevant cycles sorted ascending by cycleNo
 * @param {Map<string, number>} p.qcMap
 * @param {Map<string, number>} p.recheckMap
 * @param {Set<number>} [p.cycleIdsWithBatchQcPending] — from {@link loadNoQtyCycleIdsWithBatchQcPendingBySalesOrderIds}
 * @returns {{ id: number; cycleNo: number } | null}
 */
function findSequentialNoQtyGateCycle({ so, cyclesSorted, qcMap, recheckMap, postCycleApprovalMap, cycleIdsWithBatchQcPending }) {
  const batchPending = cycleIdsWithBatchQcPending ?? new Set();
  for (const c of cyclesSorted) {
    const itemIds = collectNoQtyItemIdsForCycle({
      soId: so.id,
      cycleIdNorm: c.id,
      salesOrderLines: so.lines,
      cycleQcAcceptedMap: qcMap,
      cycleRecheckAcceptedMap: recheckMap,
      postCycleApprovalMap,
      dispatchRecords: so.dispatch,
    });
    let totalReady = 0;
    for (const itemId of itemIds) {
      const qcKey = `${so.id}:${c.id}:${itemId}`;
      const qcAccepted = num(qcMap.get(qcKey) ?? 0);
      const recheckAccepted = num(recheckMap.get(qcKey) ?? 0);
      const postCycle = num(postCycleApprovalMap?.get(qcKey) ?? 0);
      const net = num(
        netNoQtyCycleDispatchedByItemId(
          filterNoQtyDispatchRowsForActiveCycle(so.dispatch, c.id),
          DISPATCH_ALLOC_MODE.OPERATIONAL,
        ).get(itemId) ?? 0,
      );
      totalReady += Math.max(0, qcAccepted + recheckAccepted + postCycle - net);
    }
    const hasPreparedDraft = (so.dispatch || []).some(
      (d) =>
        d.reversalOfId == null &&
        d.workflowStatus === "UNLOCKED" &&
        normalizePositiveCycleId(d.cycleId) === c.id,
    );

    // Prepared drafts do not block advancing to later cycles for new prepares/FIFO allocation.
    if (hasPreparedDraft) continue;

    if (totalReady > REPORT_QUEUE_EPS) return c;

    if (batchPending.has(c.id)) return c;
  }
  return null;
}

/**
 * NO_QTY: pick cycle for list/detail — sequential gate first; URL override only when it matches gate (else coerce).
 */
function pickNoQtyEffectiveCycleId({
  so,
  noQtyScopedSoId,
  validatedNoQtyOverride,
  cyclesBySoId,
  /** All cycles (any status), sorted by cycleNo — used for sequential gate so closed-cycle dispatch pending is not ignored. */
  allCyclesBySoIdForGate,
  noQtyCapBySoCycleKey,
  onHandByItemId,
  cycleQcAcceptedMap,
  cycleRecheckAcceptedMap,
  postCycleApprovalMap,
  cycleIdsWithBatchQcPending,
}) {
  if (so.orderType !== "NO_QTY") return null;
  const activeSorted = [...(cyclesBySoId.get(so.id) || [])].sort((a, b) => a.cycleNo - b.cycleNo);
  const allSorted = [...(allCyclesBySoIdForGate?.get(so.id) ?? cyclesBySoId.get(so.id) ?? [])].sort(
    (a, b) => a.cycleNo - b.cycleNo,
  );
  const gate = findSequentialNoQtyGateCycle({
    so,
    cyclesSorted: allSorted,
    qcMap: cycleQcAcceptedMap,
    recheckMap: cycleRecheckAcceptedMap,
    postCycleApprovalMap,
    cycleIdsWithBatchQcPending: cycleIdsWithBatchQcPending ?? new Set(),
  });
  if (validatedNoQtyOverride && Number(so.id) === Number(noQtyScopedSoId)) {
    if (gate == null) return validatedNoQtyOverride.id;
    if (validatedNoQtyOverride.id === gate.id) return validatedNoQtyOverride.id;
    return gate.id;
  }
  if (gate) return gate.id;
  const cur = normalizePositiveCycleId(so.currentCycleId);
  if (cur != null && activeSorted.some((x) => x.id === cur)) return cur;
  return activeSorted[0]?.id ?? allSorted[0]?.id ?? null;
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
        workflowStatus: "APPROVED",
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
    const acc = num(r.acceptedQty);
    if (acc <= REPORT_QUEUE_EPS) continue;
    sum += acc;
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
 * Build NO_QTY dispatch context from current-cycle net dispatch + cycle-scoped QC accepted (WO.cycleId or RS via WO).
 * RS cap / global USABLE are informational only — dispatch headroom is QC (+ recheck) − same-cycle operational dispatch.
 *
 * @param {object} input
 * @param {number} input.soId
 * @param {number|null} input.currentCycleId
 * @param {{ itemId: number; dispatchedQty: unknown; cycleId?: number | null; reversalOfId?: number | null; workflowStatus?: string | null }[]} input.dispatchRecords
 * @param {Map<number, number>} input.onHandByItemId
 * @param {Map<string, { capsByItemId: Map<number, { cap: number; itemName: string }> }>} input.noQtyCapBySoCycleKey
 * @param {Map<string, number>} input.cycleQcAcceptedMap key `${soId}:${cycleId}:${itemId}`
 * @param {Map<string, number>} [input.postCycleApprovalMap] key `${soId}:${cycleId}:${itemId}` → qty from prior closed cycles
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
  postCycleApprovalMap,
  salesOrderLines,
}) {
  const cycleIdNorm = normalizePositiveCycleId(currentCycleId);
  if (cycleIdNorm == null) {
    return { lineStats: [], blockedReason: "No active cycle available for dispatch." };
  }
  const key = `${soId}:${cycleIdNorm}`;
  const capEntry = noQtyCapBySoCycleKey.get(key);

  const cycleDispatchRecords = filterNoQtyDispatchRowsForActiveCycle(dispatchRecords, cycleIdNorm);
  const netByItemOperational = netNoQtyCycleDispatchedByItemId(cycleDispatchRecords, DISPATCH_ALLOC_MODE.OPERATIONAL);

  const itemIds = collectNoQtyItemIdsForCycle({
    soId,
    cycleIdNorm,
    salesOrderLines,
    cycleQcAcceptedMap,
    cycleRecheckAcceptedMap,
    postCycleApprovalMap,
    dispatchRecords,
  });

  const lineStats = [];
  for (const itemId of itemIds) {
    const capObj = capEntry?.capsByItemId?.get(Number(itemId));
    const cycleCap = capObj ? num(capObj.cap) : 0;
    const dispatched = num(netByItemOperational.get(Number(itemId)) ?? 0);
    const qcKey = `${soId}:${cycleIdNorm}:${itemId}`;
    const qcAcceptedThisCycle = num(cycleQcAcceptedMap?.get(qcKey) ?? 0);
    const recheckAcceptedThisCycle = num(cycleRecheckAcceptedMap?.get(qcKey) ?? 0);
    const postCycleApprovalThisCycle = num(postCycleApprovalMap?.get(qcKey) ?? 0);
    const usableStock = num(onHandByItemId?.get(Number(itemId)) ?? 0);
    const dispatchable = computeNoQtyDispatchHeadroom({
      alreadyOpNet: dispatched,
      qcAcceptedThisCycle,
      recheckAcceptedThisCycle,
      postCycleApprovalQty: postCycleApprovalThisCycle,
    });
    const qcPoolGross = qcAcceptedThisCycle + recheckAcceptedThisCycle + postCycleApprovalThisCycle;
    // Cap QC-backed headroom by physical free USABLE stock.
    // Without this cap, cycle attribution mismatches (rework credited to one cycle, dispatch consumed under another)
    // can show "optional dispatch available" even when physical USABLE is already exhausted.
    const unlockedDraftAllCyclesForItem = (dispatchRecords || [])
      .filter((d) => d.reversalOfId == null && d.workflowStatus === "UNLOCKED" && Number(d.itemId) === Number(itemId))
      .reduce((s, d) => s + num(d.dispatchedQty), 0);
    const freePhysicalUsable = Math.max(0, num(usableStock) - num(unlockedDraftAllCyclesForItem));
    const dispatchableCapped = Math.min(num(dispatchable), freePhysicalUsable);
    /** Dispatchable amount for UI: min(QC headroom, free physical USABLE). */
    const cycleDispatchHeadroom = dispatchableCapped;

    const itemName =
      capObj?.itemName ??
      (salesOrderLines || []).find((l) => Number(l.itemId) === Number(itemId))?.item?.itemName ??
      `Item #${itemId}`;
    const soRemainingDemandQty = cycleDispatchHeadroom;
    const lastShortageQty = 0;
    // NO_QTY: dispatch is optional. Do not treat QC-backed availability as customer backlog/pending dispatch.
    const logicalPending = 0;
    const draftPreparedQty = (cycleDispatchRecords || [])
      .filter((d) => d.reversalOfId == null && d.workflowStatus === "UNLOCKED" && Number(d.itemId) === Number(itemId))
      .reduce((s, d) => s + num(d.dispatchedQty), 0);
    const rowsInCycleNetForItem = cycleDispatchRecords.filter((d) => Number(d.itemId) === Number(itemId));

    lineStats.push({
      lineId: itemId, // stable synthetic id for UI selection
      itemId,
      itemName,
      fulfillmentQtySnapshot: capObj?.fulfillmentQtySnapshot != null ? num(capObj.fulfillmentQtySnapshot) : null,
      productionRequiredQtySnapshot: capObj?.productionRequiredQtySnapshot != null ? num(capObj.productionRequiredQtySnapshot) : null,
      coveredFromStockQtySnapshot:
        capObj?.availableStockQtySnapshot != null && capObj?.fulfillmentQtySnapshot != null
          ? Math.min(num(capObj.fulfillmentQtySnapshot), num(capObj.availableStockQtySnapshot))
          : null,
      requirementSheetAvailableStockQtySnapshot:
        capObj?.availableStockQtySnapshot != null ? num(capObj.availableStockQtySnapshot) : null,
      shortfallQtySnapshot: capObj?.shortfallQtySnapshot != null ? num(capObj.shortfallQtySnapshot) : null,
      /** Operational net dispatch for this SO + item in the current cycle (incl. draft forwards + reversals). */
      operationalNetDispatchedQty: dispatched,
      /** How many Dispatch rows (forwards + reversals) for this itemId were summed into operationalNetDispatchedQty for this cycle. */
      cycleOperationalDispatchRowsInNet: rowsInCycleNetForItem.length,
      orderQty: 0,
      isFree: false,
      dispatched: dispatched,
      dispatchPendingLock: draftPreparedQty,
      remaining: cycleDispatchHeadroom,
      pendingDispatchQty: logicalPending,
      onHand: usableStock,
      totalStock: usableStock,
      qcAccepted: qcAcceptedThisCycle,
      qcApprovedStock: qcAcceptedThisCycle,
      qcApprovedRemaining: Math.max(0, qcPoolGross - dispatched),
      cycleQcAcceptedQty: qcAcceptedThisCycle,
      cycleRecheckAcceptedQty: recheckAcceptedThisCycle,
      postCycleApprovalQty: postCycleApprovalThisCycle,
      inQcReworkQty: 0,
      dispatchable: dispatchableCapped,
      dispatchableQty: dispatchableCapped,
      cycleCap,
      cycleDispatchedQty: dispatched,
      cycleCapRemaining: cycleDispatchHeadroom,
      soRemainingDemandQty,
      lastShortageQty,
      usableQcPassedStock: usableStock,
      dispatchBlockedReason:
        dispatchableCapped > REPORT_QUEUE_EPS
          ? null
          : qcPoolGross <= REPORT_QUEUE_EPS
            ? "No QC-accepted quantity for this cycle yet (post-cycle approvals appear once a prior cycle is closed and stock is released)."
            : "QC-accepted quantity for this cycle is fully dispatched.",
      quantityContexts: {
        cycleCap: { qty: cycleCap, metricContext: "NO_QTY_CYCLE_CAP" },
        cycleRemaining: { qty: cycleDispatchHeadroom, metricContext: "NO_QTY_CYCLE_REMAINING" },
        usableStock: { qty: 0, metricContext: "NO_QTY_USABLE_STOCK" },
        dispatchableQty: { qty: dispatchableCapped, metricContext: "NO_QTY_DISPATCHABLE_QC" },
      },
    });
  }

  if (!lineStats.length) {
    return {
      lineStats: [],
      blockedReason: "No QC-attributed FG lines or dispatch activity for this cycle.",
    };
  }

  return { lineStats, blockedReason: null };
}

/** Synthetic stable line id for NO_QTY multi-cycle rows (avoids React / selection collisions on same FG item across cycles). */
function noQtyDispatchSyntheticLineId(cycleIdNorm, itemId) {
  const c = Number(cycleIdNorm);
  const i = Number(itemId);
  if (!Number.isFinite(c) || c <= 0 || !Number.isFinite(i) || i <= 0) return i;
  return c * 1_000_000 + i;
}

/**
 * NO_QTY: same per-cycle math as {@link buildNoQtyLineStats} for **every** sales order cycle (active + closed),
 * so dispatch pending matches dashboard QC-pool headroom. Cycle isolation is preserved per row (`noQtyCycleId`).
 *
 * @param {object} input
 * @param {number} input.soId
 * @param {{ id: number; cycleNo?: number }[]} input.cyclesForSo — all cycles for this SO, any status
 * @returns {{ lineStats: object[]; blockedReason: string | null }}
 */
function buildNoQtyDispatchLineStatsForAllCycles({
  soId,
  dispatchRecords,
  onHandByItemId,
  noQtyCapBySoCycleKey,
  cycleQcAcceptedMap,
  cycleRecheckAcceptedMap,
  postCycleApprovalMap,
  salesOrderLines,
  cyclesForSo,
}) {
  const sorted = [...(cyclesForSo || [])].sort((a, b) => Number(a.cycleNo) - Number(b.cycleNo));
  /** @type {object[]} */
  const out = [];
  let blockedReason = null;
  for (const c of sorted) {
    const cid = normalizePositiveCycleId(c.id);
    if (cid == null) continue;
    const { lineStats: one, blockedReason: br } = buildNoQtyLineStats({
      soId,
      currentCycleId: cid,
      dispatchRecords,
      onHandByItemId,
      noQtyCapBySoCycleKey,
      cycleQcAcceptedMap,
      cycleRecheckAcceptedMap,
      postCycleApprovalMap,
      salesOrderLines,
    });
    if (br && (!one || !one.length)) blockedReason = blockedReason || br;
    for (const ls of one || []) {
      const itemId = Number(ls.itemId);
      out.push({
        ...ls,
        lineId: noQtyDispatchSyntheticLineId(cid, itemId),
        noQtyCycleId: cid,
        noQtyCycleNo: Number.isFinite(Number(c.cycleNo)) ? Number(c.cycleNo) : null,
      });
    }
  }
  if (!out.length) {
    return {
      lineStats: [],
      blockedReason: blockedReason || "No QC-attributed FG lines or dispatch activity for any cycle.",
    };
  }
  return { lineStats: out, blockedReason: null };
}

/**
 * Which term(s) bind `min(capRem, qcPoolRem, usable)` for NO_QTY headroom (same eps as queue).
 * @returns {{ bindingLimiters: string[]; terms: { CAP: number; QC_POOL: number; STOCK: number }; dispatchableQty: number; minOfThree: number }}
 */
function classifyNoQtyBindingLimiters(capRem, qcPoolRem, usableStock, dispatchable) {
  const d = num(dispatchable);
  const terms = { CAP: num(capRem), QC_POOL: num(qcPoolRem), STOCK: num(usableStock) };
  const eps = REPORT_QUEUE_EPS;
  const minVal = Math.min(terms.CAP, terms.QC_POOL, terms.STOCK);
  const keys = /** @type {const} */ (["CAP", "QC_POOL", "STOCK"]);
  const bindingLimiters = keys.filter((k) => Math.abs(terms[k] - minVal) <= eps || (d <= eps && terms[k] <= eps));
  return { bindingLimiters, terms, dispatchableQty: d, minOfThree: minVal };
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
      where: { id: normalizePositiveCycleId(selectedCycleIdOpt), salesOrderId: soId },
      select: { id: true },
    });
    if (!c) {
      return { error: { code: "INVALID_CYCLE", message: "cycleId is not a cycle for this sales order." } };
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
  const cycleRecheckMap = await loadNoQtyDispositionUsableForDispatchPoolMap(prisma, [{ id: soId, currentCycleId }]);
  const postCycleMapDbg = await loadNoQtyPostCycleApprovalMapForInputs(prisma, [{ id: soId, currentCycleId }]);
  const qcKey = `${soId}:${currentCycleId}:${itemId}`;
  const qcAcceptedThisCycle = num(cycleQcMap.get(qcKey) ?? 0);
  const recheckAcceptedThisCycle = num(cycleRecheckMap.get(qcKey) ?? 0);
  const postCycleThisCycle = num(postCycleMapDbg.get(qcKey) ?? 0);
  const qcPoolGross = qcAcceptedThisCycle + recheckAcceptedThisCycle + postCycleThisCycle;
  const qcRemainingAfterOperationalDispatch = Math.max(0, qcAcceptedThisCycle - alreadyOpNet);
  const qcPoolRemainingAfterOperationalDispatch = Math.max(0, qcPoolGross - alreadyOpNet);

  const usableFgStock = await getItemStockQty(itemId, prisma, { stockBucket: "USABLE" });
  const unlockedDraftReserved = (so.dispatch || [])
    .filter((d) => d.reversalOfId == null && d.workflowStatus === "UNLOCKED" && Number(d.itemId) === Number(itemId))
    .reduce((s, d) => s + num(d.dispatchedQty), 0);
  const freePhysicalUsable = Math.max(0, num(usableFgStock) - num(unlockedDraftReserved));

  const dispatchableQtyRaw = computeNoQtyDispatchHeadroom({
    alreadyOpNet,
    qcAcceptedThisCycle,
    recheckAcceptedThisCycle,
    postCycleApprovalQty: postCycleThisCycle,
  });
  const dispatchableQty = Math.min(num(dispatchableQtyRaw), freePhysicalUsable);

  const remainingAfterCap = Math.max(0, cycleCap - alreadyOpNet);
  const qcBacked = Math.max(0, qcAcceptedThisCycle - alreadyOpNet);
  const classification = classifyNoQtyBindingLimiters(
    remainingAfterCap,
    qcPoolRemainingAfterOperationalDispatch,
    usableFgStock,
    dispatchableQty,
  );

  const qcRowsRaw = await prisma.qcEntry.findMany({
    where: {
      reversedAt: null,
      production: {
        workflowStatus: "APPROVED",
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
    cyclePostCycleApprovalQty: postCycleThisCycle,
    qcRemainingAfterOperationalDispatch,
    qcPoolRemainingAfterOperationalDispatch,
    qcPoolGrossQty: qcPoolGross,
    usableFgStockUsableBucket: usableFgStock,
    finalDispatchHeadroom_dispatchableQty: dispatchableQty,
    computeNoQtyDispatchHeadroom_inputs: {
      alreadyOpNet,
      qcAcceptedThisCycle,
      recheckAcceptedThisCycle,
      postCycleApprovalQty: postCycleThisCycle,
    },
    intermediateTerms_same_as_computeNoQtyDispatchHeadroom: {
      remainingAfterCap,
      qcPoolRemainingAfterOperationalDispatch,
      qcBackedAfterSubtractingOperationalDispatch: qcBacked,
    },
    bindingLimiters: classification.bindingLimiters,
    bindingClassification: classification,
    whichTermIsZeroIfDispatchableIsZero:
      dispatchableQty <= REPORT_QUEUE_EPS
        ? {
            capBlocks: remainingAfterCap <= REPORT_QUEUE_EPS,
            qcPoolBlocks: qcPoolRemainingAfterOperationalDispatch <= REPORT_QUEUE_EPS,
            stockBlocks: usableFgStock <= REPORT_QUEUE_EPS,
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
      "Temporary admin debug. NO_QTY dispatchable = max(0, QC + in-cycle disposition→USABLE + post-cycle approvals − same-cycle operational net). " +
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
 * Sales order cycles (incl. closed when they still have QC-backed dispatch or a prepared draft).
 */
dispatchRouter.get("/no-qty-cycles", requireAuth, requireRole(DISPATCH_READ_ROLES), async (req, res, next) => {
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
      include: { lines: { include: { item: true } }, dispatch: true },
    });
    if (!so || so.orderType !== "NO_QTY") {
      return res.status(400).json({ error: { message: "A No Qty sales order is required." } });
    }
    const cycles = await prisma.salesOrderCycle.findMany({
      where: { salesOrderId: soId },
      orderBy: { cycleNo: "asc" },
      select: { id: true, cycleNo: true, status: true },
    });
    const inputs = cycles.map((c) => ({ id: soId, currentCycleId: c.id }));
    const [qcMap, recheckMap, postCycleMap, batchPendingMapCyc] = await Promise.all([
      loadNoQtyCycleQcAcceptedMap(prisma, inputs),
      loadNoQtyDispositionUsableForDispatchPoolMap(prisma, inputs),
      loadNoQtyPostCycleApprovalMapForInputs(prisma, inputs),
      loadNoQtyCycleIdsWithBatchQcPendingBySalesOrderIds(prisma, [soId]),
    ]);
    const gate = findSequentialNoQtyGateCycle({
      so,
      cyclesSorted: cycles,
      qcMap,
      recheckMap,
      postCycleApprovalMap: postCycleMap,
      cycleIdsWithBatchQcPending: batchPendingMapCyc.get(soId) ?? new Set(),
    });
    // Physical free USABLE cap (prevents cycle attribution mismatch from showing phantom headroom).
    const usableRows = await prisma.stockTransaction.groupBy({
      by: ["itemId"],
      where: { stockBucket: "USABLE" },
      _sum: { qtyIn: true, qtyOut: true },
    });
    const usableByItemId = new Map(usableRows.map((r) => [Number(r.itemId), num(r._sum.qtyIn) - num(r._sum.qtyOut)]));
    const unlockedDraftByItemId = new Map();
    for (const d of so.dispatch || []) {
      if (d.reversalOfId != null) continue;
      if (d.workflowStatus !== "UNLOCKED") continue;
      const iid = Number(d.itemId);
      if (!Number.isFinite(iid) || iid <= 0) continue;
      unlockedDraftByItemId.set(iid, (unlockedDraftByItemId.get(iid) ?? 0) + num(d.dispatchedQty));
    }
    const out = [];
    for (const c of cycles) {
      const itemIds = collectNoQtyItemIdsForCycle({
        soId,
        cycleIdNorm: c.id,
        salesOrderLines: so.lines,
        cycleQcAcceptedMap: qcMap,
        cycleRecheckAcceptedMap: recheckMap,
        postCycleApprovalMap: postCycleMap,
        dispatchRecords: so.dispatch,
      });
      let totalReady = 0;
      for (const itemId of itemIds) {
        const qcKey = `${soId}:${c.id}:${itemId}`;
        const qcAccepted = num(qcMap.get(qcKey) ?? 0);
        const recheckAccepted = num(recheckMap.get(qcKey) ?? 0);
        const post = num(postCycleMap.get(qcKey) ?? 0);
        const net = num(
          netNoQtyCycleDispatchedByItemId(
            filterNoQtyDispatchRowsForActiveCycle(so.dispatch, c.id),
            DISPATCH_ALLOC_MODE.OPERATIONAL,
          ).get(itemId) ?? 0,
        );
        const headroom = Math.max(0, qcAccepted + recheckAccepted + post - net);
        const freePhysical =
          Math.max(0, num(usableByItemId.get(itemId) ?? 0) - num(unlockedDraftByItemId.get(itemId) ?? 0));
        totalReady += Math.min(headroom, freePhysical);
      }
      const hasPreparedDraft = (so.dispatch || []).some(
        (d) =>
          d.reversalOfId == null &&
          d.workflowStatus === "UNLOCKED" &&
          normalizePositiveCycleId(d.cycleId) === c.id,
      );
      const needsWork = totalReady > REPORT_QUEUE_EPS || hasPreparedDraft;

      let eligible = false;
      /** @type {string | null} */
      let sequentialLockReason = null;
      let cycleLabel = `Cycle ${c.cycleNo}`;
      const readyLabel = Number.isInteger(totalReady) ? String(totalReady) : totalReady.toFixed(3);

      if (gate == null) {
        cycleLabel = `Cycle ${c.cycleNo} — Completed`;
      } else if (c.id === gate.id) {
        eligible = needsWork;
        cycleLabel =
          totalReady > REPORT_QUEUE_EPS
            ? `Cycle ${c.cycleNo} — Ready ${readyLabel}`
            : hasPreparedDraft
              ? `Cycle ${c.cycleNo} — Prepared draft`
              : `Cycle ${c.cycleNo}`;
      } else if (c.cycleNo < gate.cycleNo) {
        cycleLabel = `Cycle ${c.cycleNo} — Completed`;
      } else {
        sequentialLockReason = `Cycle ${c.cycleNo} locked until Cycle ${gate.cycleNo} dispatch is completed`;
        cycleLabel = `Cycle ${c.cycleNo} — Locked`;
      }

      if (String(c.status) !== "ACTIVE" && !needsWork) continue;

      out.push({
        cycleId: c.id,
        cycleNo: c.cycleNo,
        dispatchableQty: totalReady,
        eligible,
        sequentialLockReason,
        cycleLabel,
        status: c.status,
        lockedRequirementSheetId: null,
      });
    }
    return res.json({ cycles: out, sequentialGateCycleId: gate?.id ?? null, sequentialGateCycleNo: gate?.cycleNo ?? null });
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

dispatchRouter.get("/sales-orders", requireAuth, requireRole(DISPATCH_READ_ROLES), async (req, res, next) => {
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
        where: { id: cid, salesOrderId: noQtySoIdQ },
        select: { id: true, cycleNo: true, salesOrderId: true },
      });
      if (!c) {
        const err = new Error("noQtyCycleId is not a cycle for this sales order.");
        err.statusCode = 400;
        throw err;
      }
      validatedNoQtyOverride = c;
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
        where: { stockBucket: { in: ["USABLE", "QC_HOLD", "QC_PENDING", "REWORK", "SCRAP"] } },
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
    /** @type {Map<number, number>} */
    const scrapByItemId = new Map();
    for (const r of bucketStockRows) {
      const net = Number(r._sum.qtyIn ?? 0) - Number(r._sum.qtyOut ?? 0);
      if (r.stockBucket === "USABLE") onHandByItemId.set(r.itemId, net);
      else if (r.stockBucket === "QC_HOLD") qcHoldByItemId.set(r.itemId, net);
      else if (r.stockBucket === "QC_PENDING") qcPendingByItemId.set(r.itemId, net);
      else if (r.stockBucket === "REWORK") reworkByItemId.set(r.itemId, net);
      else if (r.stockBucket === "SCRAP") scrapByItemId.set(r.itemId, net);
    }

    const allNoQtyFromRows = rows.filter((so) => so.orderType === "NO_QTY");
    const noQtySoIds = allNoQtyFromRows.map((so) => so.id);
    const noQtyBatchPendingBySo =
      noQtySoIds.length > 0 ? await loadNoQtyCycleIdsWithBatchQcPendingBySalesOrderIds(prisma, noQtySoIds) : new Map();
    const allCyclesForNoQty =
      noQtySoIds.length > 0
        ? await prisma.salesOrderCycle.findMany({
            where: { salesOrderId: { in: noQtySoIds } },
            select: { id: true, salesOrderId: true, cycleNo: true, status: true },
            orderBy: [{ salesOrderId: "asc" }, { cycleNo: "asc" }],
          })
        : [];
    /** Active cycles only — used for sequential gate / default cycle context (not for QC map coverage). */
    /** @type {Map<number, { id: number; cycleNo: number }[]>} */
    const cyclesBySoId = new Map();
    /** Every cycle (active + closed) — used for NO_QTY dispatch line stats so closed-cycle dispatch pending matches dashboard. */
    /** @type {Map<number, { id: number; cycleNo: number; status: string }[]>} */
    const allCyclesBySoId = new Map();
    for (const c of allCyclesForNoQty) {
      const row = { id: c.id, cycleNo: Number(c.cycleNo), status: String(c.status ?? "") };
      const arrAll = allCyclesBySoId.get(c.salesOrderId) ?? [];
      arrAll.push(row);
      allCyclesBySoId.set(c.salesOrderId, arrAll);
      if (row.status === "ACTIVE") {
        const arrA = cyclesBySoId.get(c.salesOrderId) ?? [];
        arrA.push({ id: c.id, cycleNo: Number(c.cycleNo) });
        cyclesBySoId.set(c.salesOrderId, arrA);
      }
    }
    const noQtySoCycleInputsAll = [];
    const seenSoCycleInput = new Set();
    for (const c of allCyclesForNoQty) {
      const k = `${c.salesOrderId}:${c.id}`;
      if (seenSoCycleInput.has(k)) continue;
      seenSoCycleInput.add(k);
      noQtySoCycleInputsAll.push({ id: c.salesOrderId, currentCycleId: c.id });
    }
    const noQtyCycleIdsAll = [...new Set(allCyclesForNoQty.map((c) => c.id))];

    const noQtyCapBySoCycleKey = new Map();
    const [cycleQcAcceptedMap, cycleRecheckAcceptedMap, postCycleApprovalMapAll] = await Promise.all([
      loadNoQtyCycleQcAcceptedMap(prisma, noQtySoCycleInputsAll),
      loadNoQtyDispositionUsableForDispatchPoolMap(prisma, noQtySoCycleInputsAll),
      loadNoQtyPostCycleApprovalMapForInputs(prisma, noQtySoCycleInputsAll),
    ]);

    if (noQtySoIds.length && noQtyCycleIdsAll.length) {
      const lockedSheets = await prisma.requirementSheet.findMany({
        where: {
          salesOrderId: { in: noQtySoIds },
          cycleId: { in: noQtyCycleIdsAll },
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
    if (noQtyCycleIdsAll.length) {
      const metaRows = await prisma.salesOrderCycle.findMany({
        where: { id: { in: noQtyCycleIdsAll } },
        select: { id: true, cycleNo: true },
      });
      for (const m of metaRows) cycleMetaById.set(m.id, m);
    }

    const TRACE_SO_ID = 26;
    const TRACE_ITEM_NAME_LC = "cap";
    const enriched = rows.map((so) => {
      // NO_QTY: dispatch eligibility is QC-accepted qty minus same-cycle dispatch (see buildNoQtyLineStats).
      if (so.orderType === "NO_QTY") {
        const eff = pickNoQtyEffectiveCycleId({
          so,
          noQtyScopedSoId: noQtySoIdQ,
          validatedNoQtyOverride,
          cyclesBySoId,
          allCyclesBySoIdForGate: allCyclesBySoId,
          noQtyCapBySoCycleKey,
          onHandByItemId,
          cycleQcAcceptedMap,
          cycleRecheckAcceptedMap,
          postCycleApprovalMap: postCycleApprovalMapAll,
          cycleIdsWithBatchQcPending: noQtyBatchPendingBySo.get(so.id) ?? new Set(),
        });
        const meta = eff != null ? cycleMetaById.get(eff) : null;
        const { lineStats, blockedReason: noQtyDispatchBlockedReason } = buildNoQtyDispatchLineStatsForAllCycles({
          soId: so.id,
          dispatchRecords: so.dispatch,
          onHandByItemId,
          noQtyCapBySoCycleKey,
          cycleQcAcceptedMap,
          cycleRecheckAcceptedMap,
          postCycleApprovalMap: postCycleApprovalMapAll,
          salesOrderLines: so.lines,
          cyclesForSo: allCyclesBySoId.get(so.id) || [],
        });
        const lineStatsWithBuckets = (lineStats || []).map((ls) => {
          const itemId = Number(ls.itemId);
          const qcHoldQty = qcHoldByItemId.get(itemId) ?? 0;
          const qcPendingQty = qcPendingByItemId.get(itemId) ?? 0;
          const reworkQty = reworkByItemId.get(itemId) ?? 0;
          const scrapQty = scrapByItemId.get(itemId) ?? 0;
          const inProcessQty = qcHoldQty + qcPendingQty + reworkQty;
          return {
            ...ls,
            qcHoldQty,
            qcPendingQty,
            reworkQty,
            inProcessQty,
            scrapQty,
            inQcReworkQty: inProcessQty,
          };
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
          // NO_QTY dispatch eligibility is cycle-wise QC minus same-cycle dispatch.
          // internalStatus=COMPLETED can occur even when a new cycle is active (SO line qty is often 0),
          // so do not block dispatch purely on COMPLETED. Only manual SO close is view-only.
          dispatchReadOnly:
            so.internalStatus === "MANUALLY_CLOSED" || so.internalStatus === "CLOSED",
          noQtyDispatchBlockedReason,
          noQtyDispatchContext:
            eff != null
              ? {
                  selectedCycleId: eff,
                  cycleNo: meta?.cycleNo ?? null,
                  cycleLabel: meta?.cycleNo != null ? `Cycle ${meta.cycleNo}` : null,
                }
              : null,
          lineStats: lineStatsWithBuckets,
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
        const scrapQty = scrapByItemId.get(line.itemId) ?? 0;
        const inProcessQty = qcHoldQty + qcPendingQty + reworkQty;
        const inQcReworkQty = inProcessQty;
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
          /** Display-only: raw bucket rollups (global by SKU). */
          qcHoldQty,
          qcPendingQty,
          reworkQty,
          /** Display-only: IN PROCESS = qcHold + qcPending + rework. */
          inProcessQty,
          /** Display-only: SCRAP bucket net (global by SKU). */
          scrapQty,
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

    const regularSoIdsForInvoice = enriched
      .filter((so) => so.orderType !== "NO_QTY")
      .map((so) => so.id);
    const invoicedBySoId = await fetchInvoicedQtyBySoId(prisma, regularSoIdsForInvoice);

    const pendingFirst = enriched
      .map((so) => {
        if (so.orderType === "NO_QTY") {
          return { ...so, lineStats: so.lineStats || [] };
        }
        return {
          ...so,
          lineStats: filterLineStatsForDispatchOpenList(so.lineStats || [], so.orderType),
        };
      })
      .filter((so) => {
        if (shouldExcludeSalesOrderFromDispatchOpenList(so, invoicedBySoId.get(so.id))) {
          return false;
        }
        if (so.orderType === "NO_QTY") {
          return (so.lineStats || []).some((l) => isDispatchOpenListLineCandidate(l, so.orderType));
        }
        return (so.lineStats || []).length > 0;
      });

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
        where: { stockBucket: { in: ["USABLE", "QC_HOLD", "QC_PENDING", "REWORK", "SCRAP"] } },
        _sum: { qtyIn: true, qtyOut: true },
      }),
      buildQcAcceptedMap(prisma),
    ]);
    const replacementQcGrossBySoItem = await buildReplacementReturnQcGrossBySoItemKey(prisma, [so], qcAcceptedMap);

    const onHandByItemId = new Map();
    const qcHoldByItemId = new Map();
    const qcPendingByItemId = new Map();
    const reworkByItemId = new Map();
    const scrapByItemId = new Map();
    for (const r of bucketStockRows) {
      const net = Number(r._sum.qtyIn ?? 0) - Number(r._sum.qtyOut ?? 0);
      if (r.stockBucket === "USABLE") onHandByItemId.set(r.itemId, net);
      else if (r.stockBucket === "QC_HOLD") qcHoldByItemId.set(r.itemId, net);
      else if (r.stockBucket === "QC_PENDING") qcPendingByItemId.set(r.itemId, net);
      else if (r.stockBucket === "REWORK") reworkByItemId.set(r.itemId, net);
      else if (r.stockBucket === "SCRAP") scrapByItemId.set(r.itemId, net);
    }

    /** @type {Map<number, { id: number; cycleNo: number }[]>} */
    const cyclesBySoIdDbg = new Map();
    /** @type {Map<number, { id: number; cycleNo: number; status: string }[]>} */
    const allCyclesBySoIdDbg = new Map();
    if (so.orderType === "NO_QTY") {
      const allC = await prisma.salesOrderCycle.findMany({
        where: { salesOrderId: so.id },
        select: { id: true, salesOrderId: true, cycleNo: true, status: true },
        orderBy: { cycleNo: "asc" },
      });
      const activeOnly = [];
      for (const c of allC) {
        const row = { id: c.id, cycleNo: Number(c.cycleNo), status: String(c.status ?? "") };
        const arrAll = allCyclesBySoIdDbg.get(c.salesOrderId) ?? [];
        arrAll.push(row);
        allCyclesBySoIdDbg.set(c.salesOrderId, arrAll);
        if (row.status === "ACTIVE") activeOnly.push({ id: c.id, cycleNo: Number(c.cycleNo) });
      }
      cyclesBySoIdDbg.set(so.id, activeOnly);
    }
    const noQtyBatchPendingDbg =
      so.orderType === "NO_QTY"
        ? (await loadNoQtyCycleIdsWithBatchQcPendingBySalesOrderIds(prisma, [so.id])).get(so.id) ?? new Set()
        : new Set();
    const dbgInputs =
      so.orderType === "NO_QTY"
        ? (allCyclesBySoIdDbg.get(so.id) || []).map((c) => ({ id: so.id, currentCycleId: c.id }))
        : [];
    const noQtyCapBySoCycleKey = new Map();
    const cycleMetaById = new Map();
    let lockedSheetId = null;
    if (so.orderType === "NO_QTY" && dbgInputs.length) {
      const cycleIds = dbgInputs.map((x) => x.currentCycleId);
      const metaRows = await prisma.salesOrderCycle.findMany({
        where: { id: { in: cycleIds } },
        select: { id: true, cycleNo: true },
      });
      for (const m of metaRows) cycleMetaById.set(m.id, m);

      const lockedSheets = await prisma.requirementSheet.findMany({
        where: { salesOrderId: so.id, cycleId: { in: cycleIds }, status: "LOCKED" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { lines: { include: { item: true } } },
      });
      for (const sh of lockedSheets) {
        const k = `${sh.salesOrderId}:${Number(sh.cycleId)}`;
        if (noQtyCapBySoCycleKey.has(k)) continue;
        lockedSheetId = lockedSheetId ?? sh.id;
        const capsByItemId = new Map();
        for (const ln of sh.lines || []) {
          const cap = Math.max(num(ln.suggestedWoQtySnapshot ?? 0), num(ln.requirementQty ?? 0));
          if (!(cap > REPORT_QUEUE_EPS)) continue;
          capsByItemId.set(ln.itemId, { cap, itemName: ln.item?.itemName ?? `Item #${ln.itemId}` });
        }
        noQtyCapBySoCycleKey.set(k, { capsByItemId });
      }
    }

    let cycleQcAcceptedMap = new Map();
    let cycleRecheckAcceptedMap = new Map();
    let postCycleApprovalMapDbg = new Map();
    if (so.orderType === "NO_QTY" && dbgInputs.length) {
      const trip = await Promise.all([
        loadNoQtyCycleQcAcceptedMap(prisma, dbgInputs),
        loadNoQtyDispositionUsableForDispatchPoolMap(prisma, dbgInputs),
        loadNoQtyPostCycleApprovalMapForInputs(prisma, dbgInputs),
      ]);
      cycleQcAcceptedMap = trip[0];
      cycleRecheckAcceptedMap = trip[1];
      postCycleApprovalMapDbg = trip[2];
    }

    const eff =
      so.orderType === "NO_QTY"
        ? pickNoQtyEffectiveCycleId({
            so,
            noQtyScopedSoId: -1,
            validatedNoQtyOverride: null,
            cyclesBySoId: cyclesBySoIdDbg,
            allCyclesBySoIdForGate: allCyclesBySoIdDbg,
            noQtyCapBySoCycleKey,
            onHandByItemId,
            cycleQcAcceptedMap,
            cycleRecheckAcceptedMap,
            postCycleApprovalMap: postCycleApprovalMapDbg,
            cycleIdsWithBatchQcPending: noQtyBatchPendingDbg,
          })
        : null;

    let enriched;
    if (so.orderType === "NO_QTY") {
      const meta = eff != null ? cycleMetaById.get(eff) : null;
      const { lineStats, blockedReason: noQtyDispatchBlockedReason } = buildNoQtyDispatchLineStatsForAllCycles({
        soId: so.id,
        dispatchRecords: so.dispatch,
        onHandByItemId,
        noQtyCapBySoCycleKey,
        cycleQcAcceptedMap,
        cycleRecheckAcceptedMap,
        postCycleApprovalMap: postCycleApprovalMapDbg,
        salesOrderLines: so.lines,
        cyclesForSo: allCyclesBySoIdDbg.get(so.id) || [],
      });
      const lineStatsWithBuckets = (lineStats || []).map((ls) => {
        const itemId = Number(ls.itemId);
        const qcHoldQty = qcHoldByItemId.get(itemId) ?? 0;
        const qcPendingQty = qcPendingByItemId.get(itemId) ?? 0;
        const reworkQty = reworkByItemId.get(itemId) ?? 0;
        const scrapQty = scrapByItemId.get(itemId) ?? 0;
        const inProcessQty = qcHoldQty + qcPendingQty + reworkQty;
        return {
          ...ls,
          qcHoldQty,
          qcPendingQty,
          reworkQty,
          inProcessQty,
          scrapQty,
          inQcReworkQty: inProcessQty,
        };
      });
      enriched = {
        ...so,
        flowMode: "NO_QTY_SO",
        dispatchReadOnly:
          so.internalStatus === "MANUALLY_CLOSED" || so.internalStatus === "CLOSED",
        noQtyDispatchBlockedReason,
        noQtyDispatchContext:
          eff != null
            ? { selectedCycleId: eff, cycleNo: meta?.cycleNo ?? null, cycleLabel: meta?.cycleNo != null ? `Cycle ${meta.cycleNo}` : null }
            : null,
        lineStats: lineStatsWithBuckets,
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
        const scrapQty = scrapByItemId.get(line.itemId) ?? 0;
        const inProcessQty = qcHoldQty + qcPendingQty + reworkQty;
        const inQcReworkQty = inProcessQty;
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
          qcHoldQty,
          qcPendingQty,
          reworkQty,
          inProcessQty,
          scrapQty,
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

    const invoicedQtyDebug = await fetchInvoicedQtyBySoId(prisma, enriched.orderType !== "NO_QTY" ? [enriched.id] : []);
    const afterPendingFirst =
      enriched.orderType === "NO_QTY"
        ? { ...enriched, lineStats: enriched.lineStats || [] }
        : {
            ...enriched,
            lineStats: filterLineStatsForDispatchOpenList(enriched.lineStats || [], enriched.orderType),
          };
    const excludedAtSoLevel = shouldExcludeSalesOrderFromDispatchOpenList(
      enriched,
      invoicedQtyDebug.get(enriched.id),
    );
    const afterLineFilterIncluded =
      !excludedAtSoLevel &&
      (enriched.orderType === "NO_QTY"
        ? (afterPendingFirst.lineStats || []).some((l) => isDispatchOpenListLineCandidate(l, enriched.orderType))
        : (afterPendingFirst.lineStats || []).length > 0);
    const afterReadOnlyIncluded = afterLineFilterIncluded && !afterPendingFirst.dispatchReadOnly;

    return res.json({
      soId: so.id,
      orderType: so.orderType,
      internalStatus: so.internalStatus,
      invoicedQty: invoicedQtyDebug.get(enriched.id) ?? 0,
      excludedAtSoLevel,
      commerciallyClosed: isSalesOrderCommerciallyClosedForDispatch(
        enriched,
        invoicedQtyDebug.get(enriched.id),
      ),
      noQtyEffectiveCycleId: eff,
      noQtyLockedRequirementSheetId: lockedSheetId,
      enrichedRow_beforeFiltering: enriched,
      row_afterPendingFirst: afterPendingFirst,
      included_afterPendingFirst: afterLineFilterIncluded,
      included_afterReadOnlyFilter: afterReadOnlyIncluded,
      note:
        "NORMAL open list: line needs (pending + dispatchable) OR draft lock; fully confirmed lines drop unless lock remains. " +
        "SO excluded when DRAFT/COMPLETED/CLOSED or fully dispatched + finalized billing. " +
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
dispatchRouter.get("/ledger", requireAuth, requireRole(DISPATCH_READ_ROLES), async (req, res, next) => {
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
dispatchRouter.get("/dispatches/:id", requireAuth, requireRole(DISPATCH_READ_ROLES), async (req, res, next) => {
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
  requireRole([...new Set([...DISPATCH_READ_ROLES, ...QC_PAGE_ROLES])]),
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

/**
 * NO_QTY: preview FIFO allocation across cycles (no writes). Same ordering as POST /dispatches with autoAllocateAcrossCycles.
 */
dispatchRouter.post(
  "/dispatches/no-qty-fifo-preview",
  requireAuth,
  requireRole(DISPATCH_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const schema = z.object({
        soId: z.number().int(),
        itemId: z.number().int(),
        dispatchedQty: z.number().positive(),
      });
      const body = schema.parse(req.body);
      const so = await prisma.salesOrder.findUnique({
        where: { id: body.soId },
        include: { lines: true, dispatch: true },
      });
      if (!so || so.orderType !== "NO_QTY") {
        const err = new Error("FIFO preview applies only to No Qty sales orders.");
        err.statusCode = 400;
        throw err;
      }
      const line = so.lines.find((l) => l.itemId === body.itemId);
      if (!line) {
        const err = new Error("Item not on this sales order");
        err.statusCode = 400;
        throw err;
      }
      const allCycles = await prisma.salesOrderCycle.findMany({
        where: { salesOrderId: so.id },
        orderBy: { cycleNo: "asc" },
        select: { id: true, cycleNo: true },
      });
      const allCycleInputs = allCycles.map((c) => ({ id: so.id, currentCycleId: c.id }));
      const [qcMapAll, recheckMapAll, postCycleMapAll, batchPendingForSo] = await Promise.all([
        loadNoQtyCycleQcAcceptedMap(prisma, allCycleInputs),
        loadNoQtyDispositionUsableForDispatchPoolMap(prisma, allCycleInputs),
        loadNoQtyPostCycleApprovalMapForInputs(prisma, allCycleInputs),
        loadNoQtyCycleIdsWithBatchQcPendingBySalesOrderIds(prisma, [so.id]),
      ]);
      const batchSet = batchPendingForSo.get(so.id) ?? new Set();
      const gate = findSequentialNoQtyGateCycle({
        so,
        cyclesSorted: allCycles,
        qcMap: qcMapAll,
        recheckMap: recheckMapAll,
        postCycleApprovalMap: postCycleMapAll,
        cycleIdsWithBatchQcPending: batchSet,
      });
      const fifo = computeNoQtyFifoPrepareSlicesForItem({
        so,
        itemId: body.itemId,
        requestedQty: body.dispatchedQty,
        cyclesSorted: allCycles,
        qcMap: qcMapAll,
        recheckMap: recheckMapAll,
        postCycleMap: postCycleMapAll,
      });
      const first = fifo.slices[0] ?? null;
      let gateBlockedReason = null;
      if (gate != null && first != null && first.cycleId !== gate.id) {
        gateBlockedReason = `Complete Cycle ${gate.cycleNo} dispatch before starting another cycle.`;
      }
      return res.json({
        allocation: fifo.slices.map((s) => ({ cycleId: s.cycleId, cycleNo: s.cycleNo, qty: s.qty })),
        totalAvailable: fifo.totalAvailable,
        requestedQty: body.dispatchedQty,
        unallocated: fifo.unallocated,
        wouldExceedTotal: fifo.totalAvailable + REPORT_QUEUE_EPS < body.dispatchedQty,
        gateCycle: gate ? { id: gate.id, cycleNo: gate.cycleNo } : null,
        gateBlockedReason,
      });
    } catch (e) {
      return next(e);
    }
  },
);

dispatchRouter.post("/dispatches", requireAuth, requireRole(DISPATCH_WRITE_ROLES), async (req, res, next) => {
  try {
    const schema = z.object({
      soId: z.number().int(),
      itemId: z.number().int(),
      dispatchedQty: z.number().positive(),
      /** NO_QTY single-cycle / legacy: cycle chosen in UI. Ignored when autoAllocateAcrossCycles is true. */
      cycleId: z.number().int().positive().optional(),
      /** NO_QTY: allocate requested qty FIFO across all cycles (oldest first); creates/updates one draft per cycle slice. */
      autoAllocateAcrossCycles: z.boolean().optional(),
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
      let existingDraft = null;
      /** @type {null | { dispatches: import("@prisma/client").Dispatch[]; allocation: Array<{ cycleId: number; cycleNo: number; qty: number }> }} */
      let noQtyFifoResult = null;
      if (isNoQty) {
        const allCycles = await tx.salesOrderCycle.findMany({
          where: { salesOrderId: so.id },
          orderBy: { cycleNo: "asc" },
          select: { id: true, cycleNo: true },
        });
        const allCycleInputs = allCycles.map((c) => ({ id: so.id, currentCycleId: c.id }));
        const [qcMapAll, recheckMapAll, postCycleMapAll, batchPendingMapTx] = await Promise.all([
          loadNoQtyCycleQcAcceptedMap(tx, allCycleInputs),
          loadNoQtyDispositionUsableForDispatchPoolMap(tx, allCycleInputs),
          loadNoQtyPostCycleApprovalMapForInputs(tx, allCycleInputs),
          loadNoQtyCycleIdsWithBatchQcPendingBySalesOrderIds(tx, [so.id]),
        ]);
        const batchPendingSetTx = batchPendingMapTx.get(so.id) ?? new Set();
        const gate = findSequentialNoQtyGateCycle({
          so,
          cyclesSorted: allCycles,
          qcMap: qcMapAll,
          recheckMap: recheckMapAll,
          postCycleApprovalMap: postCycleMapAll,
          cycleIdsWithBatchQcPending: batchPendingSetTx,
        });

        if (body.autoAllocateAcrossCycles === true) {
          const fifo = computeNoQtyFifoPrepareSlicesForItem({
            so,
            itemId: body.itemId,
            requestedQty: body.dispatchedQty,
            cyclesSorted: allCycles,
            qcMap: qcMapAll,
            recheckMap: recheckMapAll,
            postCycleMap: postCycleMapAll,
          });
          if (fifo.totalAvailable + REPORT_QUEUE_EPS < body.dispatchedQty) {
            throw friendlyNoQtyDispatchError(
              "Dispatch exceeds total QC-backed quantity available across cycles.",
              400,
            );
          }
          if (fifo.slices.length === 0 || fifo.unallocated > REPORT_QUEUE_EPS) {
            throw friendlyNoQtyDispatchError("No QC-backed dispatch headroom for this item.", 409);
          }
          const firstSlice = fifo.slices[0];
          if (gate != null && firstSlice != null && firstSlice.cycleId !== gate.id) {
            throw friendlyNoQtyDispatchError(
              `Complete Cycle ${gate.cycleNo} dispatch before starting another cycle.`,
              409,
            );
          }
          /** @type {import("@prisma/client").Dispatch[]} */
          const dispatchesOut = [];
          for (const slice of fifo.slices) {
            const existingDraftSlice = await tx.dispatch.findFirst({
              where: {
                soId: so.id,
                itemId: body.itemId,
                cycleId: slice.cycleId,
                reversalOfId: null,
                workflowStatus: "UNLOCKED",
              },
              orderBy: { id: "desc" },
            });
            const hypNet = hypotheticalNoQtyCycleOperationalNetForItem(
              so.dispatch,
              slice.cycleId,
              body.itemId,
              existingDraftSlice?.id ?? null,
              slice.qty,
            );
            const qcKey = `${so.id}:${slice.cycleId}:${body.itemId}`;
            const qcTotal =
              num(qcMapAll.get(qcKey) ?? 0) +
              num(recheckMapAll.get(qcKey) ?? 0) +
              num(postCycleMapAll.get(qcKey) ?? 0);
            if (hypNet > qcTotal + REPORT_QUEUE_EPS) {
              throw friendlyNoQtyDispatchError("Dispatch exceeds QC-accepted quantity for this cycle.", 400);
            }
            const row = existingDraftSlice
              ? await tx.dispatch.update({
                  where: { id: existingDraftSlice.id },
                  data: { dispatchedQty: String(slice.qty) },
                })
              : await tx.dispatch.create({
                  data: {
                    docNo: await allocateDocNo(tx, { docType: DocType.DISPATCH, date: new Date() }),
                    soId: so.id,
                    itemId: body.itemId,
                    cycleId: slice.cycleId,
                    dispatchedQty: String(slice.qty),
                    reversalOfId: null,
                    workflowStatus: "UNLOCKED",
                  },
                });
            dispatchesOut.push(row);
          }
          const allocation = fifo.slices.map((s) => ({ cycleId: s.cycleId, cycleNo: s.cycleNo, qty: s.qty }));
          noQtyFifoResult = { dispatches: dispatchesOut, allocation };
        } else {
          const requested = normalizePositiveCycleId(body.cycleId ?? so.currentCycleId);
          if (requested == null) throw friendlyNoQtyDispatchError("No cycle available for dispatch.");
          const soCycleRow = await tx.salesOrderCycle.findFirst({
            where: { id: requested, salesOrderId: so.id },
            select: { id: true },
          });
          if (!soCycleRow) throw friendlyNoQtyDispatchError("Select a valid cycle for dispatch.");
          currentCycleId = soCycleRow.id;

          if (gate != null && currentCycleId !== gate.id) {
            throw friendlyNoQtyDispatchError(
              `Complete Cycle ${gate.cycleNo} dispatch before starting another cycle.`,
              409,
            );
          }

          existingDraft = await tx.dispatch.findFirst({
            where: {
              soId: so.id,
              itemId: body.itemId,
              cycleId: currentCycleId,
              reversalOfId: null,
              workflowStatus: "UNLOCKED",
            },
            orderBy: { id: "desc" },
          });

          const hypNet = hypotheticalNoQtyCycleOperationalNetForItem(
            so.dispatch,
            currentCycleId,
            body.itemId,
            existingDraft?.id ?? null,
            body.dispatchedQty,
          );

          const qcKey = `${so.id}:${currentCycleId}:${body.itemId}`;
          const qcAccepted = num(qcMapAll.get(qcKey) ?? 0);
          const recheckAccepted = num(recheckMapAll.get(qcKey) ?? 0);
          const postCycleAccepted = num(postCycleMapAll.get(qcKey) ?? 0);
          const qcTotal = qcAccepted + recheckAccepted + postCycleAccepted;

          if (hypNet > qcTotal + REPORT_QUEUE_EPS) {
            throw friendlyNoQtyDispatchError("Dispatch exceeds QC-accepted quantity for this cycle.", 400);
          }

          if (!(body.dispatchedQty > 0)) throw friendlyNoQtyDispatchError("Dispatch quantity must be greater than zero.", 400);
        }
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

      if (noQtyFifoResult != null) {
        const payload = {
          dispatches: noQtyFifoResult.dispatches,
          allocation: noQtyFifoResult.allocation,
          autoAllocated: true,
          dispatch: noQtyFifoResult.dispatches[0] ?? null,
        };
        await syncNoQtyOptionalStoreStockIntentForSalesOrderAfterDispatchChange(tx, so.id, null);
        await completeDispatchIdempotency(tx, {
          userId,
          routeKey: ROUTE_KEYS.POST_DISPATCHES,
          idempotencyKey,
          responseStatus: 201,
          body: payload,
        });
        return { status: 201, body: payload };
      }

      /** Draft row: UNLOCKED until POST /dispatches/:id/lock posts stock (DISPATCH) and sets LOCKED. */
      // UX guard: reuse/update existing draft for same SO + item instead of creating overlapping drafts.
      if (!isNoQty) {
        existingDraft = await tx.dispatch.findFirst({
          where: {
            soId: so.id,
            itemId: body.itemId,
            reversalOfId: null,
            workflowStatus: "UNLOCKED",
          },
          orderBy: { id: "desc" },
        });
      }

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

      if (isNoQty) {
        await syncNoQtyOptionalStoreStockIntentForSalesOrderAfterDispatchChange(tx, so.id, null);
      }

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
dispatchRouter.post("/dispatches/:id/lock", requireAuth, requireRole(DISPATCH_WRITE_ROLES), async (req, res, next) => {
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
        const soCycleLock = await tx.salesOrderCycle.findFirst({
          where: { id: dispatchCycleId, salesOrderId: so.id },
          select: { id: true },
        });
        if (!soCycleLock) {
          throw friendlyNoQtyDispatchError("This dispatch belongs to an unknown sales-order cycle.", 409);
        }
        currentCycleId = soCycleLock.id;

        const isDraftFinalize = existing.workflowStatus === "UNLOCKED" && existing.reversalOfId == null;
        if (!(qty > 0)) throw friendlyNoQtyDispatchError("Prepared dispatch quantity must be greater than 0.", 400);

        const allCyclesLock = await tx.salesOrderCycle.findMany({
          where: { salesOrderId: so.id },
          orderBy: { cycleNo: "asc" },
          select: { id: true, cycleNo: true },
        });
        const allCycleInputsLock = allCyclesLock.map((c) => ({ id: so.id, currentCycleId: c.id }));
        const [qcMapAllLock, recheckMapAllLock, postCycleMapAllLock] = await Promise.all([
          loadNoQtyCycleQcAcceptedMap(tx, allCycleInputsLock),
          loadNoQtyDispositionUsableForDispatchPoolMap(tx, allCycleInputsLock),
          loadNoQtyPostCycleApprovalMapForInputs(tx, allCycleInputsLock),
        ]);
        const cycleDispatchRecords = filterNoQtyDispatchRowsForActiveCycle(so.dispatch, currentCycleId);
        const netOp = num(
          netNoQtyCycleDispatchedByItemId(cycleDispatchRecords, DISPATCH_ALLOC_MODE.OPERATIONAL).get(Number(existing.itemId)) ?? 0,
        );

        const qcKey = `${so.id}:${currentCycleId}:${existing.itemId}`;
        const qcAccepted = num(qcMapAllLock.get(qcKey) ?? 0);
        const recheckAccepted = num(recheckMapAllLock.get(qcKey) ?? 0);
        const postCycleAccepted = num(postCycleMapAllLock.get(qcKey) ?? 0);
        const qcTotal = qcAccepted + recheckAccepted + postCycleAccepted;

        if (netOp > qcTotal + REPORT_QUEUE_EPS) {
          throw friendlyNoQtyDispatchError("Dispatch exceeds QC-accepted quantity for this cycle.", 400);
        }

        const finalDispatchableQty = computeNoQtyDispatchHeadroom({
          alreadyOpNet: netOp,
          qcAcceptedThisCycle: qcAccepted,
          recheckAcceptedThisCycle: recheckAccepted,
          postCycleApprovalQty: postCycleAccepted,
        });

        console.debug("[FINALIZE_CHECK]", {
          dispatchId: existing.id,
          qty,
          cycleOperationalNet: netOp,
          qcTotal,
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

      if (isNoQty) {
        await syncNoQtyOptionalStoreStockIntentForSalesOrderAfterDispatchChange(tx, so.id, null);
      }

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
  requireRole(DISPATCH_WRITE_ROLES),
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
          const soCycleFd = await tx.salesOrderCycle.findFirst({
            where: { id: dispatchCycleId, salesOrderId: so.id },
            select: { id: true },
          });
          if (!soCycleFd) {
            throw friendlyNoQtyDispatchError("This dispatch belongs to an unknown sales-order cycle.", 409);
          }
          const currentCycleId = soCycleFd.id;

          const allCyclesFd = await tx.salesOrderCycle.findMany({
            where: { salesOrderId: so.id },
            orderBy: { cycleNo: "asc" },
            select: { id: true, cycleNo: true },
          });
          const allCycleInputsFd = allCyclesFd.map((c) => ({ id: so.id, currentCycleId: c.id }));
          const [qcMapAllFd, recheckMapAllFd, postCycleMapAllFd] = await Promise.all([
            loadNoQtyCycleQcAcceptedMap(tx, allCycleInputsFd),
            loadNoQtyDispositionUsableForDispatchPoolMap(tx, allCycleInputsFd),
            loadNoQtyPostCycleApprovalMapForInputs(tx, allCycleInputsFd),
          ]);
          const cycleDispatchRecords = filterNoQtyDispatchRowsForActiveCycle(so.dispatch, currentCycleId);
          const netOp = num(
            netNoQtyCycleDispatchedByItemId(cycleDispatchRecords, DISPATCH_ALLOC_MODE.OPERATIONAL).get(Number(existing.itemId)) ??
              0,
          );

          const qcKey = `${so.id}:${currentCycleId}:${existing.itemId}`;
          const qcAccepted = num(qcMapAllFd.get(qcKey) ?? 0);
          const recheckAccepted = num(recheckMapAllFd.get(qcKey) ?? 0);
          const postCycleAccepted = num(postCycleMapAllFd.get(qcKey) ?? 0);
          const qcTotal = qcAccepted + recheckAccepted + postCycleAccepted;

          if (netOp > qcTotal + REPORT_QUEUE_EPS) {
            throw friendlyNoQtyDispatchError("Dispatch exceeds QC-accepted quantity for this cycle.", 400);
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

        if (so.orderType === "NO_QTY") {
          await syncNoQtyOptionalStoreStockIntentForSalesOrderAfterDispatchChange(tx, so.id, null);
        }

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
dispatchRouter.delete("/dispatches/:id", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
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
      if (so.orderType === "NO_QTY") {
        await syncNoQtyOptionalStoreStockIntentForSalesOrderAfterDispatchChange(tx, d.soId, null);
      }
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
      /** NO_QTY only: ADMIN acknowledgement for correcting a dispatch from a historical cycle. */
      confirmHistoricalCycleReversal: z.boolean().optional(),
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
        const isHistoricalCycleCorrection = active != null && forwardCycle != null && forwardCycle !== active;
        if (isHistoricalCycleCorrection && body.confirmHistoricalCycleReversal !== true) {
          const err = new Error(
            "Cannot reverse this dispatch: it belongs to a different cycle than the sales order's active cycle. Confirm historical-cycle reversal to proceed.",
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
        noQtyHistoricalCycleReversal:
          so.orderType === "NO_QTY"
            ? {
                confirmed: body.confirmHistoricalCycleReversal === true,
                salesOrderCurrentCycleId: normalizePositiveCycleId(so.currentCycleId),
                dispatchCycleId: normalizePositiveCycleId(original.cycleId),
              }
            : undefined,
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

module.exports = {
  dispatchRouter,
  loadNoQtyCycleQcAcceptedMap,
  loadNoQtyCycleRecheckAcceptedMap,
  loadNoQtyDispositionUsableForDispatchPoolMap,
  loadNoQtyPostCycleApprovalMapForInputs,
  computeNoQtyDispatchHeadroom,
  filterNoQtyDispatchRowsForActiveCycle,
  netNoQtyCycleDispatchedByItemId,
  /** Dashboard / reports: same NO_QTY per-cycle line stats as GET /api/dispatch/sales-orders. */
  buildNoQtyDispatchLineStatsForAllCycles,
  loadNoQtyCycleIdsWithBatchQcPendingBySalesOrderIds,
};
