/**
 * Authoritative Production QC lifecycle projection.
 *
 * Stored QcEntry.acceptedQty / rejectedQty are first-pass snapshots and are never mutated by rework recheck.
 * Lifecycle totals (final usable, rework accepted, final unusable) are derived here for report, export,
 * and REGULAR SO QC dispatch pool (final usable = first-pass accepted + rework recheck USABLE transfers).
 *
 * NO_QTY cycle dispatch continues to add cycle-scoped recheck maps separately — do not fold recheck into
 * those cycle maps via this module.
 */

function roundQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 1000) / 1000;
}

const REWORK_DISPOSITION_STATUSES = new Set([
  "REWORK_PENDING_SUPERVISOR",
  "REWORK_APPROVED_PENDING_EXECUTION",
  "REWORK_READY_FOR_QC",
]);

function isReworkDispositionStatus(status) {
  return REWORK_DISPOSITION_STATUSES.has(String(status ?? ""));
}

/**
 * Classify disposition bucket for reporting (handles CLOSED rows).
 * @param {{ id: number; status: string }} d
 * @param {{ reworkDispIds: Set<number>; holdDispIds: Set<number> }} hints
 */
function dispositionReportBucket(d, hints) {
  const status = String(d.status ?? "");
  if (status === "SCRAP") return "scrap";
  if (status === "HOLD") return "hold";
  if (isReworkDispositionStatus(status)) return "rework";
  if (status === "CLOSED") {
    if (hints.reworkDispIds.has(d.id)) return "rework";
    if (hints.holdDispIds.has(d.id)) return "hold";
  }
  return "rework";
}

/**
 * Legacy single-route rows (no disposition children).
 * @param {{ rejectedQty?: unknown; rejectedRoute?: string | null; lossQty?: unknown }} q
 */
function splitRejectedBucketsLegacy(q) {
  const rej = Number(q.rejectedQty ?? 0);
  const route = q.rejectedRoute;
  const loss = Number(q.lossQty ?? 0);
  let rework = 0;
  let hold = 0;
  let scrap = 0;
  if (rej > 0 && route === "REWORK") rework = rej;
  else if (rej > 0 && route === "HOLD") hold = rej;
  else if (rej > 0 && route === "SCRAP") scrap = rej;
  else if (loss > 0) scrap = loss;
  return { reworkQty: roundQty(rework), holdQty: roundQty(hold), scrapQty: roundQty(scrap) };
}

/**
 * Shared Production QC lifecycle metrics for one QcEntry.
 *
 * Field meanings:
 * - initialAcceptedQty / firstPassAcceptedQty = QcEntry.acceptedQty (immutable first-pass)
 * - initialRejectedQty = QcEntry.rejectedQty (immutable first-pass reject posting — NOT "still rejected")
 * - reworkRoutedQty = qty sent to rework path
 * - reworkAcceptedQty = BUCKET_TRANSFER into USABLE owned by rework dispositions
 * - finalUsableQty = initialAccepted + reworkAccepted
 * - finalUnusableQty = terminal scrap only (direct + rework-final); excludes open rework/hold
 *
 * @param {{ acceptedQty?: unknown; rejectedQty?: unknown; lossQty?: unknown; rejectedRoute?: string | null }} q
 * @param {Array<{ id: number; status: string; qty?: unknown; remainingQty?: unknown }>} dispositions
 * @param {{ reworkDispIds: Set<number>; holdDispIds: Set<number> }} hints
 * @param {Map<number, number>} recheckAcceptedByDispId
 * @param {{ directScrapQty: number; reworkFinalScrapQty: number }} scrapParts
 */
function buildProductionQcLifecycleMetrics(q, dispositions, hints, recheckAcceptedByDispId, scrapParts) {
  const safeHints = hints && typeof hints === "object"
    ? {
        reworkDispIds: hints.reworkDispIds instanceof Set ? hints.reworkDispIds : new Set(),
        holdDispIds: hints.holdDispIds instanceof Set ? hints.holdDispIds : new Set(),
      }
    : { reworkDispIds: new Set(), holdDispIds: new Set() };
  const safeRecheck = recheckAcceptedByDispId instanceof Map ? recheckAcceptedByDispId : new Map();
  const safeScrapParts = {
    directScrapQty: roundQty(Number(scrapParts?.directScrapQty ?? 0)),
    reworkFinalScrapQty: roundQty(Number(scrapParts?.reworkFinalScrapQty ?? 0)),
  };
  const dispList = Array.isArray(dispositions) ? dispositions.filter(Boolean) : [];

  const initialAcceptedQty = roundQty(Number(q?.acceptedQty ?? 0));
  const initialRejectedQty = roundQty(Number(q?.rejectedQty ?? 0));
  const lossQty = roundQty(Number(q?.lossQty ?? 0));
  const inspectedQty = roundQty(initialAcceptedQty + initialRejectedQty);

  let reworkRoutedQty = 0;
  let holdQty = 0;
  let directScrapQty = 0;
  let pendingReworkQty = 0;
  let openHoldQty = 0;

  if (dispList.length > 0) {
    for (const d of dispList) {
      const qty = roundQty(Number(d.qty ?? 0));
      const remaining = roundQty(Number(d.remainingQty ?? 0));
      const bucket = dispositionReportBucket(d, safeHints);
      if (bucket === "rework") {
        reworkRoutedQty = roundQty(reworkRoutedQty + qty);
        pendingReworkQty = roundQty(pendingReworkQty + remaining);
      } else if (bucket === "hold") {
        holdQty = roundQty(holdQty + qty);
        if (String(d.status ?? "") === "HOLD") {
          openHoldQty = roundQty(openHoldQty + remaining);
        }
      } else if (bucket === "scrap") {
        directScrapQty = roundQty(directScrapQty + qty);
      }
    }
  } else {
    const legacy = splitRejectedBucketsLegacy(q || {});
    reworkRoutedQty = legacy.reworkQty;
    holdQty = legacy.holdQty;
    directScrapQty = legacy.scrapQty;
    if (directScrapQty <= 0 && safeScrapParts.directScrapQty > 0) {
      directScrapQty = safeScrapParts.directScrapQty;
    }
    if (directScrapQty <= 0 && lossQty > 0) {
      directScrapQty = lossQty;
    }
  }

  let reworkAcceptedQty = 0;
  for (const d of dispList) {
    if (dispositionReportBucket(d, safeHints) !== "rework") continue;
    const id = Number(d.id);
    reworkAcceptedQty = roundQty(reworkAcceptedQty + (safeRecheck.get(id) ?? 0));
  }

  const reworkFinalScrapQty = safeScrapParts.reworkFinalScrapQty;
  const totalScrapQty = roundQty(directScrapQty + reworkFinalScrapQty);
  const finalUsableQty = roundQty(initialAcceptedQty + reworkAcceptedQty);
  /** Terminal unusable only — open rework/hold are not "final unusable". */
  const finalUnusableQty = totalScrapQty;

  return {
    inspectedQty,
    /** @deprecated Prefer initialAcceptedQty / firstPassAcceptedQty */
    acceptedQtyFirstPass: initialAcceptedQty,
    firstPassAcceptedQty: initialAcceptedQty,
    initialAcceptedQty,
    /** First-pass reject posting (audit). Not remaining rejected after rework. */
    initialRejectedQty,
    /** @deprecated Prefer initialRejectedQty — historically mirrored QcEntry.rejectedQty */
    rejectedQty: initialRejectedQty,
    reworkRoutedQty,
    /** Alias used by existing report rows */
    reworkQty: reworkRoutedQty,
    holdQty,
    openHoldQty,
    directScrapQty,
    reworkFinalScrapQty,
    totalScrapQty,
    scrapQty: totalScrapQty,
    reworkAcceptedQty,
    pendingReworkQty,
    finalUsableQty,
    finalUnusableQty,
    lossQty,
  };
}

/**
 * Operator-facing status from lifecycle metrics.
 * @param {{ reversedAt?: Date | string | null; rejectedRoute?: string | null }} q
 * @param {ReturnType<typeof buildProductionQcLifecycleMetrics>} metrics
 */
function productionQcLifecycleStatusLabel(q, metrics) {
  if (q.reversedAt) return "Voided";
  const eps = 1e-9;
  const {
    initialAcceptedQty: acc,
    initialRejectedQty: rej,
    reworkQty,
    reworkAcceptedQty,
    pendingReworkQty,
    totalScrapQty,
    holdQty,
    openHoldQty,
    directScrapQty,
  } = metrics;

  if (reworkQty > eps) {
    if (pendingReworkQty > eps) return "Rework Pending";
    if (reworkAcceptedQty > eps || totalScrapQty > directScrapQty + eps) return "Disposition Completed";
    return "Sent for Rework";
  }
  if ((openHoldQty > eps || holdQty > eps) && pendingReworkQty <= eps) return "In Hold";
  if (rej <= eps && totalScrapQty <= eps) return "QC Completed";
  if (acc > eps && rej > eps) return "Partially Accepted";
  if (acc <= eps && rej > eps) {
    const route = q.rejectedRoute;
    if (route === "REWORK") return "Sent for Rework";
    if (route === "HOLD") return "In Hold";
    if (route === "SCRAP") return "Scrapped";
    if (route === "USABLE") return "Approved to Usable";
    return "Waiting QC";
  }
  if (totalScrapQty > eps) return "QC Completed";
  return "QC Completed";
}

/**
 * Trace copy helper when rework cleared initial rejection.
 * @param {ReturnType<typeof buildProductionQcLifecycleMetrics>} metrics
 */
function buildReworkClearedTraceNote(metrics) {
  const eps = 1e-9;
  if (metrics.initialRejectedQty <= eps) return null;
  if (metrics.reworkAcceptedQty <= eps) return null;
  if (metrics.pendingReworkQty > eps) return null;
  if (metrics.finalUnusableQty > eps) {
    return `${metrics.reworkAcceptedQty} of ${metrics.initialRejectedQty} initially rejected Nos were accepted after rework; ${metrics.finalUnusableQty} remain finally unusable.`;
  }
  return `${metrics.reworkAcceptedQty} initially rejected Nos were accepted after rework; no quantity remains finally rejected.`;
}

/**
 * Load disposition / recheck / scrap context for QC report + pool projections.
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number[]} qcEntryIds
 */
async function loadProductionQcLifecycleContext(db, qcEntryIds) {
  if (!qcEntryIds.length) {
    return {
      dispositionsByQcEntryId: new Map(),
      recheckAcceptedByDispId: new Map(),
      recheckAcceptedAtByDispId: new Map(),
      scrapPartsByQcEntryId: new Map(),
      dispositionHints: { reworkDispIds: new Set(), holdDispIds: new Set() },
    };
  }

  const dispositions = await db.qcRejectedDisposition.findMany({
    where: { sourceQcEntryId: { in: qcEntryIds }, voidedAt: null },
    select: {
      id: true,
      sourceQcEntryId: true,
      status: true,
      qty: true,
      remainingQty: true,
    },
  });

  const dispIds = dispositions.map((d) => d.id);
  const dispositionsByQcEntryId = new Map();
  for (const d of dispositions) {
    const list = dispositionsByQcEntryId.get(d.sourceQcEntryId) ?? [];
    list.push(d);
    dispositionsByQcEntryId.set(d.sourceQcEntryId, list);
  }

  /** @type {{ reworkDispIds: Set<number>; holdDispIds: Set<number> }} */
  const dispositionHints = { reworkDispIds: new Set(), holdDispIds: new Set() };
  const recheckAcceptedByDispId = new Map();
  /** @type {Map<number, Date>} earliest recheck USABLE transfer date per disposition */
  const recheckAcceptedAtByDispId = new Map();
  /** @type {Map<number, { directScrapQty: number; reworkFinalScrapQty: number }>} */
  const scrapPartsByQcEntryId = new Map();

  for (const id of qcEntryIds) {
    scrapPartsByQcEntryId.set(id, { directScrapQty: 0, reworkFinalScrapQty: 0 });
  }

  if (dispIds.length > 0) {
    const stockTxns = await db.stockTransaction.findMany({
      where: {
        qcRejectedDispositionId: { in: dispIds },
        reversedAt: null,
      },
      select: {
        qcRejectedDispositionId: true,
        stockBucket: true,
        transactionType: true,
        qtyIn: true,
        refId: true,
        date: true,
      },
    });

    for (const t of stockTxns) {
      const dispId = Number(t.qcRejectedDispositionId);
      if (!Number.isFinite(dispId) || dispId <= 0) continue;
      const qtyIn = Number(t.qtyIn ?? 0);
      if (t.stockBucket === "REWORK" && qtyIn > 0) dispositionHints.reworkDispIds.add(dispId);
      if (t.stockBucket === "QC_HOLD" && qtyIn > 0) dispositionHints.holdDispIds.add(dispId);
      if (
        t.transactionType === "BUCKET_TRANSFER" &&
        t.stockBucket === "USABLE" &&
        qtyIn > 0 &&
        Number(t.refId) === dispId
      ) {
        recheckAcceptedByDispId.set(dispId, roundQty((recheckAcceptedByDispId.get(dispId) ?? 0) + qtyIn));
        // StockTransaction has `date` only (no createdAt).
        const at = t.date instanceof Date ? t.date : t.date ? new Date(t.date) : null;
        if (at && !Number.isNaN(at.getTime())) {
          const prev = recheckAcceptedAtByDispId.get(dispId);
          if (!prev || at < prev) recheckAcceptedAtByDispId.set(dispId, at);
        }
      }
    }
  }

  const scrapRecords = await db.scrapRecord.findMany({
    where: { qcEntryId: { in: qcEntryIds } },
    select: { qcEntryId: true, rejectedQty: true, reason: true, date: true },
  });

  for (const sr of scrapRecords) {
    const qcId = Number(sr.qcEntryId);
    if (!Number.isFinite(qcId) || qcId <= 0) continue;
    const parts = scrapPartsByQcEntryId.get(qcId) ?? { directScrapQty: 0, reworkFinalScrapQty: 0 };
    const qty = roundQty(Number(sr.rejectedQty ?? 0));
    const reason = String(sr.reason ?? "");
    if (reason.includes("Rework final QC")) {
      parts.reworkFinalScrapQty = roundQty(parts.reworkFinalScrapQty + qty);
    } else {
      parts.directScrapQty = roundQty(parts.directScrapQty + qty);
    }
    scrapPartsByQcEntryId.set(qcId, parts);
  }

  return {
    dispositionsByQcEntryId,
    recheckAcceptedByDispId,
    recheckAcceptedAtByDispId,
    scrapPartsByQcEntryId,
    dispositionHints,
  };
}

/**
 * Sum rework-recheck USABLE qty for active production QC on an SO+FG (all cycles).
 * Used by REGULAR dispatch QC pool so final usable matches stock + report.
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number} salesOrderId
 * @param {number} itemId
 */
async function sumReworkRecheckAcceptedForSoItem(db, salesOrderId, itemId) {
  // Lightweight policy/unit-test adapters may not expose the optional QC read model.
  // No QC adapter means no rework-recheck quantity to add; the primary accepted-QC
  // calculation remains authoritative for those callers.
  if (!db.qcEntry?.findMany) return 0;
  const { QC_ENTRY_ACTIVE_WHERE } = require("./qcEntryConstants");
  const qcEntries = await db.qcEntry.findMany({
    where: {
      ...QC_ENTRY_ACTIVE_WHERE,
      production: {
        workOrderLine: {
          fgItemId: itemId,
          workOrder: { salesOrderId },
        },
      },
    },
    select: { id: true },
  });
  if (!qcEntries.length) return 0;
  const ctx = await loadProductionQcLifecycleContext(
    db,
    qcEntries.map((q) => q.id),
  );
  let sum = 0;
  for (const q of qcEntries) {
    const dispositions = ctx.dispositionsByQcEntryId.get(q.id) ?? [];
    for (const d of dispositions) {
      if (dispositionReportBucket(d, ctx.dispositionHints) !== "rework") continue;
      sum = roundQty(sum + (ctx.recheckAcceptedByDispId.get(d.id) ?? 0));
    }
  }
  return sum;
}

/**
 * Calendar-day production QC summary cards (date authority).
 * - First-pass accepted / initial rejected: QcEntry.date
 * - Rework accepted / final-usable addition from rework: stock transfer date
 * - Final unusable today: scrap records dated today (direct + rework-final)
 *
 * @param {import('@prisma/client').PrismaClient} db
 * @param {Date} todayStart
 * @param {Date} todayEnd
 */
async function aggregateProductionQcSummaryToday(db, todayStart, todayEnd) {
  const { QC_ENTRY_ACTIVE_WHERE } = require("./qcEntryConstants");

  const todayEntries = await db.qcEntry.findMany({
    where: { ...QC_ENTRY_ACTIVE_WHERE, date: { gte: todayStart, lte: todayEnd } },
    select: { id: true, acceptedQty: true, rejectedQty: true },
  });

  let firstPassAcceptedToday = 0;
  let initialRejectedToday = 0;
  for (const q of todayEntries) {
    firstPassAcceptedToday = roundQty(firstPassAcceptedToday + Number(q.acceptedQty ?? 0));
    initialRejectedToday = roundQty(initialRejectedToday + Number(q.rejectedQty ?? 0));
  }

  const reworkTransfers = await db.stockTransaction.findMany({
    where: {
      reversedAt: null,
      transactionType: "BUCKET_TRANSFER",
      stockBucket: "USABLE",
      date: { gte: todayStart, lte: todayEnd },
      qcRejectedDispositionId: { not: null },
    },
    select: {
      qtyIn: true,
      refId: true,
      qcRejectedDispositionId: true,
      qcRejectedDisposition: {
        select: {
          id: true,
          sourceQcEntryId: true,
          voidedAt: true,
          sourceQcEntry: { select: { reversedAt: true } },
        },
      },
    },
  });

  let reworkAcceptedToday = 0;
  for (const t of reworkTransfers) {
    const dispId = Number(t.qcRejectedDispositionId);
    if (!Number.isFinite(dispId) || Number(t.refId) !== dispId) continue;
    const disp = t.qcRejectedDisposition;
    if (!disp || disp.voidedAt != null) continue;
    if (disp.sourceQcEntry?.reversedAt != null) continue;
    reworkAcceptedToday = roundQty(reworkAcceptedToday + Number(t.qtyIn ?? 0));
  }

  const scrapToday = await db.scrapRecord.aggregate({
    where: {
      date: { gte: todayStart, lte: todayEnd },
      voidedAt: null,
      qcEntry: { reversedAt: null },
    },
    _sum: { rejectedQty: true },
  });
  const finalUnusableToday = roundQty(Number(scrapToday._sum.rejectedQty ?? 0));

  const finalUsableAcceptedToday = roundQty(firstPassAcceptedToday + reworkAcceptedToday);

  return {
    firstPassAcceptedToday,
    initialRejectedToday,
    reworkAcceptedToday,
    finalUsableAcceptedToday,
    finalUnusableToday,
    /** Back-compat aliases for older clients */
    productionQcAcceptedToday: finalUsableAcceptedToday,
    productionQcRejectedToday: initialRejectedToday,
  };
}

module.exports = {
  roundQty,
  REWORK_DISPOSITION_STATUSES,
  isReworkDispositionStatus,
  dispositionReportBucket,
  splitRejectedBucketsLegacy,
  buildProductionQcLifecycleMetrics,
  /** @deprecated alias */
  buildProductionQcReportMetrics: buildProductionQcLifecycleMetrics,
  productionQcLifecycleStatusLabel,
  buildReworkClearedTraceNote,
  loadProductionQcLifecycleContext,
  sumReworkRecheckAcceptedForSoItem,
  aggregateProductionQcSummaryToday,
};
