/**
 * Batch 3E — NO_QTY Recovery / Closure analytics & read models.
 *
 * Consumes assessNoQtySoClosure() and getRecoverySummary() / getRecoverySummariesBatch().
 * Does not create recovery, allocate RS, post stock, or close SOs.
 */

const { prisma } = require("../utils/prisma");
const { displaySalesOrderNo } = require("../utils/docNoLabels");
const {
  getRecoverySummariesBatch,
  emptyRecoveryTotals,
  computeAvailableQty,
  sumActiveAllocatedQty,
} = require("./noQtyRecoveryService");
const { assessNoQtySoClosure, CLOSURE_MODES } = require("./noQtySoClosureService");

const EPS = 1e-6;

const OPEN_SO_STATUSES = Object.freeze([
  "DRAFT",
  "OPEN",
  "APPROVED",
  "IN_PROCESS",
]);

const AGE_BUCKETS = Object.freeze([
  { key: "0_30", label: "0–30 days", minDays: 0, maxDays: 30 },
  { key: "31_60", label: "31–60 days", minDays: 31, maxDays: 60 },
  { key: "61_90", label: "61–90 days", minDays: 61, maxDays: 90 },
  { key: "90_PLUS", label: "90+ days", minDays: 91, maxDays: null },
]);

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function ageDaysFrom(date, now = new Date()) {
  if (!date) return 0;
  const t = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / (24 * 60 * 60 * 1000)));
}

function ageBucketKey(days) {
  if (days <= 30) return "0_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "90_PLUS";
}

function emptyAgeBucket() {
  return { qty: 0, itemIds: new Set(), sourceCount: 0, uomSamples: new Set() };
}

function finalizeAgeBuckets(raw) {
  return AGE_BUCKETS.map((b) => {
    const cur = raw[b.key] || emptyAgeBucket();
    const uoms = [...cur.uomSamples].filter(Boolean);
    return {
      key: b.key,
      label: b.label,
      qty: round3(cur.qty),
      itemCount: cur.itemIds.size,
      sourceCount: cur.sourceCount,
      uom: uoms.length === 1 ? uoms[0] : uoms.length > 1 ? "MIXED" : null,
    };
  });
}

function reconciliationOk(source) {
  const expected = round3(n(source.sourceQty));
  const parts = round3(
    n(source.activeAllocatedQty) + n(source.waivedQty) + n(source.availableQty),
  );
  return Math.abs(expected - parts) <= EPS;
}

/**
 * Assess many SOs via SSOT (bounded concurrency). Avoids unbounded parallel DB storms.
 */
async function assessNoQtySoClosureMany(db, salesOrderIds, { concurrency = 4 } = {}) {
  const ids = [...new Set((salesOrderIds || []).map(Number).filter((id) => id > 0))];
  /** @type {Map<number, Awaited<ReturnType<typeof assessNoQtySoClosure>>>} */
  const out = new Map();
  let i = 0;
  async function worker() {
    while (i < ids.length) {
      const idx = i++;
      const id = ids[idx];
      out.set(id, await assessNoQtySoClosure(db, id));
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, ids.length)) }, () => worker());
  await Promise.all(workers);
  return out;
}

async function loadOpenNoQtySalesOrders(db) {
  return db.salesOrder.findMany({
    where: {
      orderType: "NO_QTY",
      internalStatus: { in: [...OPEN_SO_STATUSES] },
    },
    select: { id: true, docNo: true, internalStatus: true, currentCycleId: true },
    orderBy: { id: "asc" },
  });
}

/**
 * Dashboard snapshot — aggregated; uses getRecoverySummariesBatch + assessNoQtySoClosureMany.
 */
async function getNoQtyRecoveryDashboardSnapshot(db = prisma, opts = {}) {
  const role = String(opts.userRole ?? "").trim().toUpperCase();
  const now = new Date();

  const [openSos, closedWithWaiverCount, waiverRows] = await Promise.all([
    loadOpenNoQtySalesOrders(db),
    db.salesOrder.count({
      where: { orderType: "NO_QTY", internalStatus: "CLOSED_WITH_WAIVER" },
    }),
    db.noQtySoWaiver.findMany({
      where: { salesOrder: { orderType: "NO_QTY" } },
      select: {
        id: true,
        salesOrderId: true,
        reasonCode: true,
        createdAt: true,
        salesOrder: { select: { docNo: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const soIds = openSos.map((s) => s.id);
  const soById = new Map(openSos.map((s) => [s.id, s]));

  const [summaries, assessments] = await Promise.all([
    getRecoverySummariesBatch(db, soIds),
    assessNoQtySoClosureMany(db, soIds),
  ]);

  const totals = emptyRecoveryTotals();
  const ageRaw = {
    "0_30": emptyAgeBucket(),
    "31_60": emptyAgeBucket(),
    "61_90": emptyAgeBucket(),
    "90_PLUS": emptyAgeBucket(),
  };
  let recoveryWaitingForRsQty = 0;
  let recoveryWaitingForRsItemIds = new Set();
  let productionShortfallPendingQty = 0;
  let qcRecoveryAvailableQty = 0;
  let productionShortfallItemIds = new Set();
  let qcRecoveryItemIds = new Set();

  for (const soId of soIds) {
    const summary = summaries.get(soId) || buildEmptySummary(soId);
    for (const s of summary.sources) {
      if (s.recoveryStatus === "CANCELLED") continue;
      if (s.recoveryType === "PRODUCTION_SHORTFALL") {
        totals.productionShortfallSourceQty = round3(
          totals.productionShortfallSourceQty + s.sourceQty,
        );
        totals.productionShortfallAvailableQty = round3(
          totals.productionShortfallAvailableQty + s.availableQty,
        );
      } else if (s.recoveryType === "QC_FINAL_REJECTION") {
        totals.qcFinalRejectionSourceQty = round3(totals.qcFinalRejectionSourceQty + s.sourceQty);
        totals.qcFinalRejectionAvailableQty = round3(
          totals.qcFinalRejectionAvailableQty + s.availableQty,
        );
      }
      totals.waivedQty = round3(totals.waivedQty + s.waivedQty);
      totals.activeAllocatedQty = round3(totals.activeAllocatedQty + s.activeAllocatedQty);

      if (s.availableQty > EPS) {
        if (s.recoveryType === "PRODUCTION_SHORTFALL") {
          productionShortfallPendingQty = round3(productionShortfallPendingQty + s.availableQty);
          productionShortfallItemIds.add(s.itemId);
        } else if (s.recoveryType === "QC_FINAL_REJECTION") {
          qcRecoveryAvailableQty = round3(qcRecoveryAvailableQty + s.availableQty);
          qcRecoveryItemIds.add(s.itemId);
        }
        recoveryWaitingForRsQty = round3(recoveryWaitingForRsQty + s.availableQty);
        recoveryWaitingForRsItemIds.add(s.itemId);

        const days = ageDaysFrom(s.createdAt, now);
        const key = ageBucketKey(days);
        const bucket = ageRaw[key];
        bucket.qty = round3(bucket.qty + s.availableQty);
        bucket.itemIds.add(s.itemId);
        bucket.sourceCount += 1;
        if (s.uom) bucket.uomSamples.add(s.uom);
      }
    }
  }

  let soWaitingForWaiver = 0;
  let acceptedFgDispositionPending = 0;
  let blockedClosures = 0;
  const blockedSamples = [];
  const waiverSamples = [];
  const fgSamples = [];

  for (const soId of soIds) {
    const a = assessments.get(soId);
    if (!a) continue;
    const so = soById.get(soId);
    const docNo = displaySalesOrderNo(soId, so?.docNo);
    if (a.mode === CLOSURE_MODES.WAIVER_REQUIRED) {
      soWaitingForWaiver += 1;
      if (waiverSamples.length < 8) {
        waiverSamples.push({
          salesOrderId: soId,
          documentNo: docNo,
          proposedWaiverQty: a.proposedWaiverQty,
          href: `/sales-orders?focusSalesOrderId=${soId}`,
        });
      }
    } else if (a.mode === CLOSURE_MODES.BLOCKED) {
      blockedClosures += 1;
      if (blockedSamples.length < 8) {
        blockedSamples.push({
          salesOrderId: soId,
          documentNo: docNo,
          blockers: a.blockers.slice(0, 3),
          href: `/sales-orders?focusSalesOrderId=${soId}`,
        });
      }
    }
    if (a.acceptedFgPendingDispositionQty > EPS) {
      acceptedFgDispositionPending += 1;
      if (fgSamples.length < 8) {
        fgSamples.push({
          salesOrderId: soId,
          documentNo: docNo,
          pendingQty: a.acceptedFgPendingDispositionQty,
          href: `/sales-orders?focusSalesOrderId=${soId}`,
        });
      }
    }
  }

  const storePlanning = {
    productionShortfallPending: {
      qty: productionShortfallPendingQty,
      itemCount: productionShortfallItemIds.size,
    },
    qcRecoveryAvailable: {
      qty: qcRecoveryAvailableQty,
      itemCount: qcRecoveryItemIds.size,
    },
    recoveryWaitingForRs: {
      qty: recoveryWaitingForRsQty,
      itemCount: recoveryWaitingForRsItemIds.size,
    },
    recoveryAgeing: finalizeAgeBuckets(ageRaw),
  };

  const admin = {
    soWaitingForWaiver,
    acceptedFgDispositionPending,
    blockedNoQtySoClosures: blockedClosures,
    closedWithWaiver: closedWithWaiverCount,
    samples: {
      waiver: waiverSamples,
      fgDisposition: fgSamples,
      blocked: blockedSamples,
      recentWaivers: waiverRows.map((w) => ({
        waiverId: w.id,
        salesOrderId: w.salesOrderId,
        documentNo: displaySalesOrderNo(w.salesOrderId, w.salesOrder?.docNo),
        reasonCode: w.reasonCode,
        closedAt: w.createdAt,
        href: `/sales-orders?focusSalesOrderId=${w.salesOrderId}`,
      })),
    },
  };

  return {
    generatedAt: now.toISOString(),
    role: role || null,
    openNoQtySoCount: openSos.length,
    totals,
    storePlanning,
    admin,
    /** Convenience flat KPIs for compact widgets */
    kpis: {
      productionShortfallPendingQty,
      qcRecoveryAvailableQty,
      recoveryWaitingForRsQty,
      soWaitingForWaiver,
      acceptedFgDispositionPending,
      blockedNoQtySoClosures: blockedClosures,
      closedWithWaiver: closedWithWaiverCount,
    },
  };
}

function buildEmptySummary(soId) {
  return { salesOrderId: soId, sources: [], totals: emptyRecoveryTotals() };
}

/**
 * Pending actions for recovery / closure (deduped by source or SO+action type).
 */
async function fetchNoQtyRecoveryPendingActions(db = prisma, { role = null } = {}) {
  const r = String(role ?? "").trim().toUpperCase();
  const openSos = await loadOpenNoQtySalesOrders(db);
  if (!openSos.length) return [];

  const soIds = openSos.map((s) => s.id);
  const soById = new Map(openSos.map((s) => [s.id, s]));
  const [summaries, assessments] = await Promise.all([
    getRecoverySummariesBatch(db, soIds),
    assessNoQtySoClosureMany(db, soIds),
  ]);

  const now = new Date();
  /** @type {object[]} */
  const actions = [];
  const seen = new Set();

  function push(action) {
    const key = String(action.id);
    if (seen.has(key)) return;
    seen.add(key);
    actions.push(action);
  }

  for (const soId of soIds) {
    const so = soById.get(soId);
    const docNo = displaySalesOrderNo(soId, so?.docNo);
    const summary = summaries.get(soId) || buildEmptySummary(soId);
    const assessment = assessments.get(soId);

    for (const src of summary.sources) {
      if (src.availableQty <= EPS) continue;
      if (src.recoveryStatus === "CANCELLED" || src.recoveryStatus === "WAIVED") continue;

      const ageHours = Math.floor(ageDaysFrom(src.createdAt, now) * 24);
      const isPs = src.recoveryType === "PRODUCTION_SHORTFALL";
      const actionLabel = isPs
        ? "Production shortfall awaiting next RS"
        : "QC recovery available for allocation";
      const ownerRole = "STORE";
      if (r && r !== "ADMIN" && r !== ownerRole) continue;

      push({
        id: `noqty-recovery:${src.recoverySourceId}`,
        priority: ageHours >= 24 * 31 ? "HIGH" : "MEDIUM",
        action: actionLabel,
        documentNo: docNo,
        ownerRole,
        ageHours,
        href: `/sales-orders/${soId}/requirement-sheets?source=no_qty_so&from=pending-actions`,
        itemId: src.itemId,
        itemName: src.itemName,
        qty: src.availableQty,
        uom: src.uom,
        recoveryType: src.recoveryType,
        reason: isPs ? "PRODUCTION_SHORTFALL_AVAILABLE" : "QC_RECOVERY_AVAILABLE",
        salesOrderId: soId,
      });
    }

    if (!assessment) continue;

    if (assessment.acceptedFgPendingDispositionQty > EPS) {
      if (!r || r === "ADMIN" || r === "STORE") {
        push({
          id: `noqty-fg-disp:${soId}`,
          priority: "HIGH",
          action: "Accepted FG disposition required",
          documentNo: docNo,
          ownerRole: "ADMIN",
          ageHours: null,
          href: `/sales-orders?focusSalesOrderId=${soId}`,
          qty: assessment.acceptedFgPendingDispositionQty,
          uom: null,
          recoveryType: null,
          reason: "FG_DISPOSITION_REQUIRED",
          salesOrderId: soId,
        });
      }
    }

    if (assessment.mode === CLOSURE_MODES.WAIVER_REQUIRED) {
      if (!r || r === "ADMIN") {
        push({
          id: `noqty-waiver-close:${soId}`,
          priority: "MEDIUM",
          action: "NO_QTY SO eligible for waiver closure",
          documentNo: docNo,
          ownerRole: "ADMIN",
          ageHours: null,
          href: `/sales-orders?focusSalesOrderId=${soId}`,
          qty: assessment.proposedWaiverQty,
          uom: null,
          recoveryType: null,
          reason: "WAIVER_REQUIRED",
          salesOrderId: soId,
        });
      }
    } else if (assessment.mode === CLOSURE_MODES.BLOCKED) {
      const first = assessment.blockers[0];
      // Skip FG-only if already emitted FG action; still emit if other blockers
      const nonFgBlockers = assessment.blockers.filter((b) => b.code !== "FG_DISPOSITION_REQUIRED");
      if (nonFgBlockers.length && (!r || r === "ADMIN" || r === "STORE")) {
        push({
          id: `noqty-close-blocked:${soId}`,
          priority: "LOW",
          action: "NO_QTY SO blocked by unresolved downstream work",
          documentNo: docNo,
          ownerRole: "ADMIN",
          ageHours: null,
          href: `/sales-orders?focusSalesOrderId=${soId}`,
          qty: null,
          uom: null,
          recoveryType: null,
          reason: first?.code || "BLOCKED",
          reasonMessage: first?.message || null,
          salesOrderId: soId,
        });
      }
    }
  }

  return actions;
}

/**
 * Control Tower monitoring enrichment (read-only).
 */
async function getNoQtyRecoveryControlTowerSlice(db = prisma) {
  const openSos = await loadOpenNoQtySalesOrders(db);
  const soIds = openSos.map((s) => s.id);
  const [summaries, assessments, closedWithWaiver] = await Promise.all([
    getRecoverySummariesBatch(db, soIds),
    assessNoQtySoClosureMany(db, soIds),
    db.salesOrder.count({
      where: { orderType: "NO_QTY", internalStatus: "CLOSED_WITH_WAIVER" },
    }),
  ]);

  const now = new Date();
  /** @type {object[]} */
  const monitoringRows = [];

  for (const so of openSos) {
    const summary = summaries.get(so.id) || buildEmptySummary(so.id);
    const assessment = assessments.get(so.id);
    for (const src of summary.sources) {
      if (src.recoveryStatus === "CANCELLED") continue;
      const activeAlloc = (src.allocations || []).find((a) =>
        ["RESERVED", "COMMITTED"].includes(String(a.status)),
      );
      monitoringRows.push({
        salesOrderId: so.id,
        documentNo: displaySalesOrderNo(so.id, so.docNo),
        recoverySourceId: src.recoverySourceId,
        recoveryType: src.recoveryType,
        recoveryStatus: src.recoveryStatus,
        originCycleId: src.cycleId,
        allocationCycleId: null,
        allocationRequirementSheetId: activeAlloc?.requirementSheetId ?? null,
        pendingQty: src.availableQty,
        waivedQty: src.waivedQty,
        allocatedQty: src.activeAllocatedQty,
        sourceQty: src.sourceQty,
        recoveryAgeDays: ageDaysFrom(src.createdAt, now),
        soCloseMode: assessment?.mode ?? null,
        closureBlockers: assessment?.blockers?.map((b) => b.code) ?? [],
        itemId: src.itemId,
        itemName: src.itemName,
        uom: src.uom,
        reconciliationOk: reconciliationOk(src),
      });
    }
  }

  let waitingWaiver = 0;
  let blocked = 0;
  let fgPending = 0;
  for (const a of assessments.values()) {
    if (a.mode === CLOSURE_MODES.WAIVER_REQUIRED) waitingWaiver += 1;
    if (a.mode === CLOSURE_MODES.BLOCKED) blocked += 1;
    if (a.acceptedFgPendingDispositionQty > EPS) fgPending += 1;
  }

  return {
    generatedAt: now.toISOString(),
    metrics: {
      openRecoverySources: monitoringRows.filter((r) => r.pendingQty > EPS).length,
      soWaitingForWaiver: waitingWaiver,
      blockedClosures: blocked,
      acceptedFgDispositionPending: fgPending,
      closedWithWaiver,
    },
    rows: monitoringRows,
  };
}

/**
 * Enrich SO ids with recovery + closure fields for reports (batched).
 */
async function enrichSalesOrdersWithRecoveryClosure(db, salesOrderIds) {
  const ids = [...new Set((salesOrderIds || []).map(Number).filter((id) => id > 0))];
  /** @type {Map<number, object>} */
  const out = new Map();
  if (!ids.length) return out;

  const [summaries, assessments, waivers, sos] = await Promise.all([
    getRecoverySummariesBatch(db, ids),
    assessNoQtySoClosureMany(db, ids),
    db.noQtySoWaiver.findMany({
      where: { salesOrderId: { in: ids } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        salesOrderId: true,
        reasonCode: true,
        remarks: true,
        createdAt: true,
      },
    }),
    db.salesOrder.findMany({
      where: { id: { in: ids } },
      select: { id: true, internalStatus: true, orderType: true },
    }),
  ]);

  /** @type {Map<number, object>} */
  const latestWaiverBySo = new Map();
  for (const w of waivers) {
    if (!latestWaiverBySo.has(w.salesOrderId)) latestWaiverBySo.set(w.salesOrderId, w);
  }
  const soById = new Map(sos.map((s) => [s.id, s]));

  for (const id of ids) {
    const summary = summaries.get(id) || buildEmptySummary(id);
    const assessment = assessments.get(id);
    const waiver = latestWaiverBySo.get(id) || null;
    const so = soById.get(id);
    let closureMode = assessment?.mode ?? null;
    if (so?.internalStatus === "CLOSED_WITH_WAIVER" || so?.internalStatus === "MANUALLY_CLOSED") {
      closureMode = "CLOSED_WITH_WAIVER";
    } else if (so?.internalStatus === "COMPLETED") {
      closureMode = "COMPLETE";
    } else if (so?.internalStatus === "CLOSED") {
      closureMode = "CLOSED";
    }
    out.set(id, {
      productionShortfallPendingQty: summary.totals.productionShortfallAvailableQty,
      qcFinalRejectionPendingQty: summary.totals.qcFinalRejectionAvailableQty,
      recoveryAllocatedQty: summary.totals.activeAllocatedQty,
      recoveryWaivedQty: summary.totals.waivedQty,
      productionShortfallSourceQty: summary.totals.productionShortfallSourceQty,
      qcFinalRejectionSourceQty: summary.totals.qcFinalRejectionSourceQty,
      closureMode,
      closureStatus: so?.internalStatus ?? null,
      closureBlockers: assessment?.blockers ?? [],
      closedWithWaiverAt: waiver?.createdAt ?? null,
      waiverReasonCode: waiver?.reasonCode ?? null,
      waiverRemarks: waiver?.remarks ?? null,
      acceptedFgPendingDispositionQty: assessment?.acceptedFgPendingDispositionQty ?? 0,
      recoverySummary: summary,
      assessment,
    });
  }
  return out;
}

/**
 * Recovery Trace Report — item-wise lineage.
 */
async function buildNoQtyRecoveryTraceReport(db = prisma, query = {}) {
  const soIdFilter =
    query.salesOrderId != null && Number(query.salesOrderId) > 0 ? Number(query.salesOrderId) : null;
  const itemIdFilter =
    query.itemId != null && Number(query.itemId) > 0 ? Number(query.itemId) : null;
  const recoveryTypeFilter = query.recoveryType
    ? String(query.recoveryType).trim().toUpperCase()
    : null;

  /** @type {import("@prisma/client").Prisma.CarryForwardPendingWhereInput} */
  const where = {
    salesOrder: { orderType: "NO_QTY" },
  };
  if (soIdFilter) where.salesOrderId = soIdFilter;
  if (itemIdFilter) where.itemId = itemIdFilter;
  if (recoveryTypeFilter) where.recoveryType = recoveryTypeFilter;

  const rows = await db.carryForwardPending.findMany({
    where,
    include: {
      allocations: {
        include: {
          requirementSheet: {
            select: { id: true, docNo: true, cycleId: true, status: true },
          },
        },
      },
      item: { select: { id: true, itemName: true, unit: true } },
      salesOrder: { select: { id: true, docNo: true, internalStatus: true } },
    },
    orderBy: [{ salesOrderId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: 5000,
  });

  const now = new Date();
  const outRows = [];
  let reconciliationExceptions = 0;

  for (const r of rows) {
    if (String(r.recoveryStatus) === "CANCELLED") continue;
    const activeAllocatedQty = sumActiveAllocatedQty(r.allocations);
    const availableQty = computeAvailableQty(r, r.allocations);
    const sourceQty = round3(n(r.sourceQty));
    const waivedQty = round3(n(r.waivedQty));
    const ok = Math.abs(sourceQty - round3(activeAllocatedQty + waivedQty + availableQty)) <= EPS;
    if (!ok) reconciliationExceptions += 1;

    const activeAllocs = (r.allocations || []).filter((a) =>
      ["RESERVED", "COMMITTED"].includes(String(a.status)),
    );
    const primaryAlloc = activeAllocs[0] || null;
    const rs = primaryAlloc?.requirementSheet || null;

    outRows.push({
      recoverySourceId: r.id,
      salesOrderId: r.salesOrderId,
      salesOrderNo: displaySalesOrderNo(r.salesOrderId, r.salesOrder?.docNo),
      soInternalStatus: r.salesOrder?.internalStatus ?? null,
      itemId: r.itemId,
      itemName: r.item?.itemName ?? null,
      uom: r.item?.unit ?? null,
      originDocumentType: r.sourceDocumentType,
      originDocumentId: r.sourceDocumentId,
      originCycleId: r.cycleId,
      recoveryType: r.recoveryType,
      sourceQty,
      allocatedQty: activeAllocatedQty,
      availableQty,
      waivedQty,
      requirementSheetId: rs?.id ?? null,
      requirementSheetNo: rs?.docNo ?? (rs?.id != null ? `RS-${rs.id}` : null),
      allocatedCycleId: rs?.cycleId ?? null,
      recoveryStatus: r.recoveryStatus,
      ageDays: ageDaysFrom(r.createdAt, now),
      reconciliationOk: ok,
      createdAt: r.createdAt,
    });
  }

  return {
    meta: {
      generatedAt: now.toISOString(),
      salesOrderId: soIdFilter,
      itemId: itemIdFilter,
      recoveryType: recoveryTypeFilter,
      rowCount: outRows.length,
      reconciliationExceptions,
      identity:
        "Source Qty = Active Allocated Qty + Waived Qty + Available Qty (exceptions flagged)",
    },
    rows: outRows,
  };
}

/**
 * RS component totals for requirement sheet report rows (from persisted line components).
 */
function sumRequirementSheetComponentTotals(sheet) {
  const lines = sheet?.lines || [];
  let baseDemandQty = 0;
  let productionShortfallQty = 0;
  let qcRejectionRecoveryQty = 0;
  let approvedManualAdjustmentQty = 0;
  let totalRsQty = 0;
  for (const ln of lines) {
    baseDemandQty = round3(baseDemandQty + n(ln.baseDemandQty));
    productionShortfallQty = round3(productionShortfallQty + n(ln.productionShortfallQty));
    qcRejectionRecoveryQty = round3(qcRejectionRecoveryQty + n(ln.qcRejectionRecoveryQty));
    approvedManualAdjustmentQty = round3(
      approvedManualAdjustmentQty + n(ln.approvedManualAdjustmentQty),
    );
    totalRsQty = round3(totalRsQty + n(ln.totalRsQty || ln.requirementQty));
  }
  return {
    baseDemandQty,
    productionShortfallQty,
    qcRejectionRecoveryQty,
    approvedManualAdjustmentQty,
    totalRsQty,
  };
}

module.exports = {
  AGE_BUCKETS,
  OPEN_SO_STATUSES,
  ageDaysFrom,
  ageBucketKey,
  reconciliationOk,
  assessNoQtySoClosureMany,
  getNoQtyRecoveryDashboardSnapshot,
  fetchNoQtyRecoveryPendingActions,
  getNoQtyRecoveryControlTowerSlice,
  enrichSalesOrdersWithRecoveryClosure,
  buildNoQtyRecoveryTraceReport,
  sumRequirementSheetComponentTotals,
};
