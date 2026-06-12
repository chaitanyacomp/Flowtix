/**
 * Purchase execution workspace — operational procurement stages after MR is raised.
 * Composes existing pool / purchase-request / PO / GRN data (no stock or WO logic changes).
 */

const { prisma } = require("../utils/prisma");
const { QUEUE_EPS, qtyToNumber, sumReceivedByRmPoLineFromGrns } = require("./rmPurchaseHelpers");
const {
  loadPendingRequestAllocByMrLineId,
  remainingAfterPurchaseRequests,
  listPendingPurchaseRequests,
  purchaseRequestStatusLabel,
} = require("./purchaseRequestService");
const { buildProcurementPool, buildAllProcurementDemandPools } = require("./procurementPlanningService");
const {
  PROCUREMENT_DEMAND_POOL,
  normalizeDemandPoolKey,
  sourceTypesForDemandPool,
  filterMrsByDemandPool,
  resolveDemandPoolForSourceType,
} = require("./procurementDemandPoolService");
const { computeFgGapLinesForSalesOrder } = require("./rmCheckService");
const { isMaterialRequirementFullyReceived } = require("./procurementLifecycleService");
const {
  RM_REQUISITION_PURCHASE_VISIBLE_STATUSES,
  RM_REQUISITION_PURCHASE_REQUEST_ALLOWED_STATUSES,
} = require("./rmRequisitionLifecycle");
const { buildPlanDisplayLabel } = require("./monthlyPlanningPlanLifecycleService");

function isApprovedPlanDocument(plan) {
  return String(plan?.status ?? "") === "APPROVED";
}

function monthlyPlanDocumentLabel(plan) {
  if (!plan) return null;
  if (isApprovedPlanDocument(plan) || Number(plan.currentRevision ?? 0) === 0) {
    return buildPlanDisplayLabel(plan);
  }
  return null;
}

function procurementBlockerReasonForOperationalKey(key) {
  if (key === "REOPEN_REQUIRED") return "RM Requisition closed while shortage remains";
  if (key === "GRN_PENDING" || key === "SUPPLIER_PENDING") return "PO created, GRN pending";
  if (key === "PR_PENDING_PO") return "RM Requisition sent, PR/PO pending";
  if (key === "RM_READY") return "RM received — issue to Production";
  return "RM Requisition approved, PR/PO pending";
}

function procurementRecommendedActionForOperationalKey(key) {
  if (key === "REOPEN_REQUIRED") return "Open RM Control Center";
  if (key === "GRN_PENDING" || key === "SUPPLIER_PENDING") return "Wait for GRN";
  if (key === "PR_PENDING_PO") return "Follow up Purchase Order";
  if (key === "RM_READY") return "Open Material Issue Workspace";
  return "Create Purchase Request";
}

const OPEN_PO_STATUSES = ["PENDING", "PARTIAL"];

function primaryFgNameForSalesOrder(so) {
  if (!so?.lines?.length) return null;
  const fg = so.lines.find((l) => l.item?.itemType === "FG");
  return fg?.item?.itemName ?? null;
}

function sourceRefForMr(mr) {
  if (mr?.sourceType === "MONTHLY_PLAN") {
    const planLabel = monthlyPlanDocumentLabel(mr?.monthlyProductionPlan);
    if (planLabel) return planLabel;
    if (mr?.sourceRevision != null) return `Monthly Plan Rev ${mr.sourceRevision}`;
    if (mr?.monthlyProductionPlan?.periodKey) return mr.monthlyProductionPlan.periodKey;
  }
  if (mr?.sourceType === "STOCK_REPLENISHMENT") return "Stock Replenishment";
  if (mr.salesOrder?.docNo) return mr.salesOrder.docNo;
  if (mr.salesOrderId) return `SO-${mr.salesOrderId}`;
  if (mr.quotation?.quotationNo) return mr.quotation.quotationNo;
  return mr.docNo || `MR-${mr.id}`;
}

function sourceContextForMr(mr) {
  if (mr?.sourceType === "STOCK_REPLENISHMENT") return "RM minimum stock";
  return primaryFgNameForSalesOrder(mr.salesOrder);
}

/**
 * Procurement source descriptor for the Purchase team (visibility only).
 * For MONTHLY_PLAN it surfaces the plan period + released revision.
 */
function mrSourceDescriptor(mr) {
  const type = mr?.sourceType ?? null;
  if (type === "MONTHLY_PLAN") {
    const plan = mr?.monthlyProductionPlan ?? null;
    const planDocumentLabel = monthlyPlanDocumentLabel(plan);
    return {
      type,
      label: planDocumentLabel ?? "Monthly Plan",
      planDocumentLabel,
      monthlyProductionPlanId: mr?.monthlyProductionPlanId ?? null,
      periodKey: plan?.periodKey ?? null,
      sourceRevision: mr?.sourceRevision ?? null,
    };
  }
  const labelByType = {
    STOCK_REPLENISHMENT: "Stock Replenishment",
    WORK_ORDER_PLANNING: "Work Order",
    SALES_ORDER: "Sales Order",
    QUOTATION: "Quotation",
  };
  return {
    type,
    label: labelByType[type] ?? (type || "Material Requirement"),
    monthlyProductionPlanId: null,
    periodKey: null,
    sourceRevision: mr?.sourceRevision ?? null,
  };
}

/**
 * Map rmItemId → Set(sourceType) across the given active MRs. Used to flag RM items
 * that have demand from more than one procurement source (read-only warning; no netting).
 */
function buildSourceTypesByRmItem(mrs) {
  const map = new Map();
  for (const mr of mrs || []) {
    for (const line of mr.lines || []) {
      if (line.rmItemId == null) continue;
      if (!map.has(line.rmItemId)) map.set(line.rmItemId, new Set());
      map.get(line.rmItemId).add(mr.sourceType);
    }
  }
  return map;
}

function mrLifecycleRank(status) {
  switch (String(status || "")) {
    case "PENDING_APPROVAL":
      return 5;
    case "APPROVED":
      return 4;
    case "SENT_TO_PURCHASE":
      return 3;
    case "PROCUREMENT_IN_PROGRESS":
      return 2;
    case "PARTIALLY_PROCURED":
      return 1;
    case "FULLY_PROCURED":
      return 0;
    case "CLOSED":
      return -1;
    case "CANCELLED":
      return -2;
    default:
      return -3;
  }
}

function toCaseKeyParts({ salesOrderId, fgItemId, plannedProductionQty }) {
  return `${Number(salesOrderId ?? 0)}:${Number(fgItemId ?? 0)}:${Number(plannedProductionQty ?? 0).toFixed(3)}`;
}

async function deriveRegularSoCaseKeyForMr(mr, db, soCache) {
  const soId = Number(mr?.salesOrderId ?? 0) || 0;
  if (!soId) {
    return toCaseKeyParts({ salesOrderId: 0, fgItemId: mr?.fgItemId ?? 0, plannedProductionQty: mr?.plannedProductionQty ?? 0 });
  }
  if (!soCache.has(soId)) {
    let fgItemId = Number(mr?.fgItemId ?? 0) || 0;
    let plannedProductionQty = Number(mr?.plannedProductionQty ?? 0) || 0;
    if (mr.salesOrder?.lines?.length) {
      const { fgLines } = await computeFgGapLinesForSalesOrder(mr.salesOrder, db);
      const primary =
        fgLines.find((f) => !f.note && Number(f.plannedProductionQty ?? 0) > 0) ??
        fgLines.find((f) => !f.note) ??
        null;
      if (primary) {
        fgItemId = Number(primary.fgItemId ?? fgItemId) || fgItemId;
        plannedProductionQty = Number(primary.plannedProductionQty ?? primary.rmPlanningQty ?? plannedProductionQty) || plannedProductionQty;
      }
    }
    soCache.set(soId, { fgItemId, plannedProductionQty });
  }
  const cached = soCache.get(soId) || {};
  return toCaseKeyParts({ salesOrderId: soId, fgItemId: cached.fgItemId ?? 0, plannedProductionQty: cached.plannedProductionQty ?? 0 });
}

async function groupMaterialRequirementsByCase(mrs, db = prisma) {
  const soCache = new Map();
  const groups = new Map();
  for (const mr of mrs || []) {
    const key =
      mr?.sourceType === "STOCK_REPLENISHMENT"
        ? `STOCK:${mr.id}`
        : mr?.sourceType === "MONTHLY_PLAN"
          ? // Each monthly plan is its own procurement case (June, July, … stay separate).
            `MONTHLY_PLAN:${mr.monthlyProductionPlanId ?? mr.id}`
          : await deriveRegularSoCaseKeyForMr(mr, db, soCache);
    const group = groups.get(key) || { key, items: [], canonical: null, archived: [] };
    const item = {
      ...mr,
      caseKey: key,
    };
    group.items.push(item);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const ranked = [...group.items].sort((a, b) => {
      const rankDelta = mrLifecycleRank(b.status) - mrLifecycleRank(a.status);
      if (rankDelta !== 0) return rankDelta;
      const at = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bt = new Date(b.updatedAt || b.createdAt || 0).getTime();
      if (at !== bt) return bt - at;
      return b.id - a.id;
    });
    group.canonical = ranked[0] || null;
    group.archived = ranked.slice(1);
  }
  return [...groups.values()];
}

/**
 * Derive header-level procurement operational status from MR lines + linkages.
 * @param {object} mr — includes lines[]
 * @param {Map<number, number>} pendingByMr
 * @param {{ hasOpenPo: boolean, hasGrnPending: boolean, prPendingCount: number }} linkage
 */
function deriveMrProcurementOperationalStatus(mr, pendingByMr, linkage) {
  const lines = mr.lines || [];
  let shortageLineCount = 0;
  let unresolvedShortage = false;
  for (const line of lines) {
    const shortage = qtyToNumber(line.shortageQty);
    if (shortage > QUEUE_EPS) {
      shortageLineCount += 1;
      const rem = remainingAfterPurchaseRequests(line, pendingByMr);
      if (rem > QUEUE_EPS) unresolvedShortage = true;
    }
  }

  if (String(mr.status || "") === "CLOSED" && unresolvedShortage && !linkage.hasOpenPo && linkage.prPendingCount === 0 && !linkage.hasGrnPending) {
    return {
      key: "REOPEN_REQUIRED",
      label: "Reopen Required",
      pendingPoStatus: "No PO",
      pendingGrnStatus: "No GRN",
      supplierPendingStatus: "Reopen RM Requisition",
    };
  }

  if (linkage.hasGrnPending) {
    return {
      key: "GRN_PENDING",
      label: "GRN Pending",
      pendingPoStatus: linkage.hasOpenPo ? "PO open" : "—",
      pendingGrnStatus: "Receipt pending",
      supplierPendingStatus: linkage.prPendingCount > 0 ? "PR + PO" : "PO placed",
    };
  }
  if (linkage.hasOpenPo) {
    return {
      key: "SUPPLIER_PENDING",
      label: "Supplier Pending",
      pendingPoStatus: "PO open",
      pendingGrnStatus: "Awaiting GRN",
      supplierPendingStatus: "Follow supplier",
    };
  }
  if (linkage.prPendingCount > 0) {
    return {
      key: "PR_PENDING_PO",
      label: "PO pending",
      pendingPoStatus: "No PO yet",
      pendingGrnStatus: "—",
      supplierPendingStatus: `${linkage.prPendingCount} PR line(s) awaiting PO`,
    };
  }

  if (shortageLineCount > 0) {
    let allShortageProcured = true;
    for (const line of lines) {
      const shortage = qtyToNumber(line.shortageQty);
      if (shortage <= QUEUE_EPS) continue;
      const procured = qtyToNumber(line.procuredQty);
      if (procured + QUEUE_EPS < shortage) {
        allShortageProcured = false;
        break;
      }
    }
    if (allShortageProcured) {
      return {
        key: "RM_READY",
        label: "RM Ready",
        pendingPoStatus: "Complete",
        pendingGrnStatus: "Complete",
        supplierPendingStatus: "Complete",
      };
    }
  }

  return {
    key: "PROCUREMENT_PENDING",
    label: "Procurement Pending",
    pendingPoStatus: "No PO",
    pendingGrnStatus: "No GRN",
    supplierPendingStatus: "Awaiting purchase action",
  };
}

async function loadProcurementLinkageForMrLineIds(mrLineIds, db = prisma) {
  const ids = (mrLineIds || []).filter((id) => Number.isFinite(id) && id > 0);
  const empty = { hasOpenPo: false, hasGrnPending: false, prPendingCount: 0, poIds: [], pendingGrnQty: 0 };
  if (!ids.length) return empty;

  /** Dedupe PO-line pending GRN so multi-MR-line links do not double-count. */
  const pendingGrnByPoLineId = new Map();

  const sourceLinks = await db.purchaseRequestLineSourceLink.findMany({
    where: { materialRequirementLineId: { in: ids } },
    include: {
      purchaseRequestLine: {
        include: {
          purchaseRequest: { select: { id: true, status: true, docNo: true } },
          poLinks: {
            include: {
              rmPoLine: {
                include: {
                  rmPo: { select: { id: true, status: true } },
                  grnLines: { include: { grn: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const prLineIds = new Set();
  const poIds = new Set();
  let hasOpenPo = false;
  let hasGrnPending = false;
  let prPendingCount = 0;

  for (const sl of sourceLinks) {
    const prLine = sl.purchaseRequestLine;
    if (!prLine) continue;
    prLineIds.add(prLine.id);
    const pendingQty = Math.max(0, qtyToNumber(prLine.netRequiredQty) - qtyToNumber(prLine.orderedQty));
    if (pendingQty > QUEUE_EPS) prPendingCount += 1;

    for (const link of prLine.poLinks || []) {
      const poLine = link.rmPoLine;
      if (!poLine?.rmPo) continue;
      const po = poLine.rmPo;
      poIds.add(po.id);
      if (OPEN_PO_STATUSES.includes(po.status)) hasOpenPo = true;
      const ordered = qtyToNumber(poLine.qty);
      let received = 0;
      for (const gl of poLine.grnLines || []) {
        if (gl.grn?.reversedAt) continue;
        received += qtyToNumber(gl.receivedQty);
      }
      const pending = Math.max(0, ordered - received);
      if (pending > QUEUE_EPS) {
        hasGrnPending = true;
        pendingGrnByPoLineId.set(poLine.id, pending);
      }
    }
  }

  const legacyPoLinks = await db.rmPoLineProcurementLink.findMany({
    where: { materialRequirementLineId: { in: ids } },
    include: {
      rmPoLine: {
        include: {
          rmPo: true,
          grnLines: { include: { grn: true } },
        },
      },
    },
  });
  for (const lk of legacyPoLinks) {
    const po = lk.rmPoLine?.rmPo;
    if (!po) continue;
    poIds.add(po.id);
    if (OPEN_PO_STATUSES.includes(po.status)) hasOpenPo = true;
    const ordered = qtyToNumber(lk.rmPoLine.qty);
    let received = 0;
    for (const gl of lk.rmPoLine.grnLines || []) {
      if (gl.grn?.reversedAt) continue;
      received += qtyToNumber(gl.receivedQty);
    }
    const pending = Math.max(0, ordered - received);
    if (pending > QUEUE_EPS) {
      hasGrnPending = true;
      pendingGrnByPoLineId.set(lk.rmPoLine.id, pending);
    }
  }

  let pendingGrnQty = 0;
  for (const q of pendingGrnByPoLineId.values()) pendingGrnQty += q;

  return { hasOpenPo, hasGrnPending, prPendingCount, poIds: [...poIds], pendingGrnQty };
}

async function summarizeMaterialRequirement(mr, pendingByMr, db = prisma) {
  const lineIds = (mr.lines || []).map((l) => l.id);
  const linkage = await loadProcurementLinkageForMrLineIds(lineIds, db);
  const op = deriveMrProcurementOperationalStatus(mr, pendingByMr, linkage);

  let totalShortageQty = 0;
  let totalRemainingQty = 0;
  let shortageRmLineCount = 0;
  for (const line of mr.lines || []) {
    const shortage = qtyToNumber(line.shortageQty);
    const rem = remainingAfterPurchaseRequests(line, pendingByMr);
    totalShortageQty += shortage;
    totalRemainingQty += rem;
    if (shortage > QUEUE_EPS) shortageRmLineCount += 1;
  }

  const primaryPoId = linkage.poIds.length ? linkage.poIds[0] : null;

  let customerCommittedQty = null;
  let productionBufferPercent = null;
  let plannedProductionQty = null;
  let rmPlanningQty = null;
  const orderType = mr.salesOrder?.orderType ?? "NORMAL";
  if (mr.salesOrderId && mr.salesOrder && orderType !== "NO_QTY") {
    try {
      const { fgLines } = await computeFgGapLinesForSalesOrder(mr.salesOrder, db);
      const primary =
        fgLines.find((f) => !f.note && Number(f.rmPlanningQty ?? f.toProduce) > 0) ??
        fgLines.find((f) => !f.note) ??
        null;
      if (primary) {
        customerCommittedQty = Number(primary.customerCommittedQty ?? primary.orderQty);
        productionBufferPercent = Number(primary.productionBufferPercent ?? 0);
        plannedProductionQty = Number(primary.plannedProductionQty ?? 0);
        rmPlanningQty = Number(primary.rmPlanningQty ?? primary.toProduce ?? 0);
      }
    } catch {
      /* planning context optional */
    }
  }

  const lines = (mr.lines || []).map((line) => {
    const rem = remainingAfterPurchaseRequests(line, pendingByMr);
    const shortage = qtyToNumber(line.shortageQty);
    return {
      lineId: line.id,
      rmItemId: line.rmItemId,
      itemName: line.rmItem?.itemName ?? "",
      unit: line.rmItem?.unit ?? "",
      requiredQty: qtyToNumber(line.requiredQty),
      shortageQty: shortage,
      remainingQty: rem,
      planningStatus: rem > QUEUE_EPS ? "Awaiting purchase request" : "Allocated to PR/PO",
    };
  });

  return {
    materialRequirementId: mr.id,
    docNo: mr.docNo,
    sourceType: mr.sourceType,
    source: mrSourceDescriptor(mr),
    sourceRef: sourceRefForMr(mr),
    fgItemId: mr.fgItemId ?? null,
    plannedProductionQty: mr.plannedProductionQty ?? null,
    workOrderId: mr.workOrderId ?? mr.workOrder?.id ?? null,
    workOrderNo: mr.workOrder?.docNo ?? (mr.workOrderId ? `WO-${mr.workOrderId}` : null),
    salesOrderId: mr.salesOrderId,
    salesOrderDocNo: mr.salesOrder?.docNo ?? null,
    customerName: mr.salesOrder?.customer?.name ?? null,
    primaryFgName: sourceContextForMr(mr),
    customerCommittedQty,
    productionBufferPercent,
    plannedProductionQty,
    rmPlanningQty,
    shortageRmLineCount,
    totalShortageQty,
    totalRemainingQty,
    pendingGrnQty: linkage.pendingGrnQty ?? 0,
    procurementStage: op.label,
    createdAt: mr.createdAt?.toISOString?.() ?? null,
    createdByName: mr.createdBy?.name ?? mr.createdBy?.email ?? null,
    status: mr.status,
    operationalKey: op.key,
    operationalLabel: op.label,
    blockerReason: procurementBlockerReasonForOperationalKey(op.key),
    recommendedAction: procurementRecommendedActionForOperationalKey(op.key),
    pendingPoStatus: op.pendingPoStatus,
    pendingGrnStatus: op.pendingGrnStatus,
    supplierPendingStatus: op.supplierPendingStatus,
    primaryPoId,
    lines,
    canCreatePurchaseRequest: RM_REQUISITION_PURCHASE_REQUEST_ALLOWED_STATUSES.includes(String(mr.status || "")),
    nextActionKey:
      op.key === "PR_PENDING_PO"
        ? "CREATE_PO"
        : op.key === "GRN_PENDING"
          ? "OPEN_GRN"
          : op.key === "SUPPLIER_PENDING"
            ? "OPEN_PO"
            : RM_REQUISITION_PURCHASE_REQUEST_ALLOWED_STATUSES.includes(String(mr.status || ""))
              ? "CREATE_PR"
              : "TRACK_IN_RM_CONTROL",
  };
}

async function loadOpenMaterialRequirements(db = prisma, { salesOrderId = null, sourceType = null, sourceTypes = null } = {}) {
  /**
   * Purchase execution workspace should only include requisitions that are
   * operationally visible to Purchase (Store-approved or later).
   *
   * CLOSED/CANCELLED are terminal and must not remain in active procurement loops.
   */
  const where = { status: { in: RM_REQUISITION_PURCHASE_VISIBLE_STATUSES } };
  if (Array.isArray(sourceTypes) && sourceTypes.length) {
    where.sourceType = { in: sourceTypes };
  } else if (sourceType) {
    where.sourceType = sourceType;
  }
  if (salesOrderId != null && Number(salesOrderId) > 0) where.salesOrderId = Number(salesOrderId);

  return db.materialRequirement.findMany({
    where,
    include: {
      salesOrder: {
        include: {
          customer: { select: { name: true } },
          lines: { include: { item: { select: { itemName: true, itemType: true } } } },
        },
      },
      workOrder: { select: { id: true, docNo: true } },
      quotation: { select: { id: true, quotationNo: true } },
      monthlyProductionPlan: {
        select: {
          id: true,
          periodKey: true,
          status: true,
          planSequenceNo: true,
          planKind: true,
          currentRevision: true,
        },
      },
      createdBy: { select: { name: true, email: true } },
      lines: { include: { rmItem: { select: { id: true, itemName: true, unit: true } } } },
    },
    orderBy: { id: "desc" },
    take: 150,
  });
}

/**
 * Dashboard + workspace: MR-centric procurement pending rows (WO planning SOs).
 */
async function buildProcurementPendingQueue(db = prisma, opts = {}) {
  const regularSoOnly = Boolean(opts.regularSoProcurementOnly || opts.woPlanningOnly);
  const mrs = await loadOpenMaterialRequirements(db, {
    salesOrderId: opts.salesOrderId,
    sourceType: regularSoOnly ? null : opts.sourceType ?? null,
    sourceTypes: regularSoOnly ? sourceTypesForDemandPool(PROCUREMENT_DEMAND_POOL.REGULAR_SO) : null,
  });
  const pendingByMr = await loadPendingRequestAllocByMrLineId(db);
  const rows = [];
  const grouped = await groupMaterialRequirementsByCase(mrs, db);
  for (const group of grouped) {
    const mr = group.canonical;
    if (!mr) continue;
    const hasShortage = (mr.lines || []).some((l) => qtyToNumber(l.shortageQty) > QUEUE_EPS);
    if (!hasShortage) continue;
    const summary = await summarizeMaterialRequirement(mr, pendingByMr, db);
    if (summary.totalRemainingQty <= QUEUE_EPS && summary.operationalKey === "RM_READY") continue;

    rows.push({
      ...summary,
      duplicateCount: group.archived.length,
      archivedMaterialRequirements: group.archived.map((dup) => ({
        materialRequirementId: dup.id,
        docNo: dup.docNo,
        status: dup.status,
        sourceRef: sourceRefForMr(dup),
      })),
    });
  }
  return rows;
}

async function buildGrnPendingSection(db = prisma) {
  const pos = await db.rmPurchaseOrder.findMany({
    where: { status: { in: OPEN_PO_STATUSES } },
    include: {
      supplier: { select: { name: true } },
      grns: { include: { lines: true } },
      lines: { include: { item: true } },
    },
    orderBy: { id: "desc" },
    take: 80,
  });

  const rows = [];
  for (const po of pos) {
    const receivedByLine = sumReceivedByRmPoLineFromGrns(po.grns || []);
    for (const line of po.lines || []) {
      const ordered = qtyToNumber(line.qty);
      const received = receivedByLine.get(line.id) || 0;
      const pending = Math.max(0, ordered - received);
      if (pending <= QUEUE_EPS) continue;
      rows.push({
        purchaseOrderId: po.id,
        purchaseOrderDocNo: po.docNo || `RMPO-${po.id}`,
        supplierName: po.supplier?.name ?? "—",
        rmItemId: line.itemId,
        itemName: line.item?.itemName ?? "",
        orderedQty: ordered,
        receivedQty: received,
        pendingQty: pending,
        poStatus: po.status,
        nextActionKey: "OPEN_GRN",
      });
    }
  }
  return rows;
}

async function buildProcurementCompletedSection(db = prisma) {
  const closed = await db.materialRequirement.findMany({
    where: { status: { in: ["FULLY_PROCURED", "CLOSED"] } },
    include: {
      salesOrder: { select: { id: true, docNo: true } },
      lines: { select: { id: true, shortageQty: true, procuredQty: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });
  const grouped = await groupMaterialRequirementsByCase(closed, db);
  const rows = [];
  for (const group of grouped) {
    const mr = group.canonical;
    if (!mr || !isMaterialRequirementFullyReceived(mr)) continue;
    rows.push({
      materialRequirementId: mr.id,
      docNo: mr.docNo,
      sourceRef: sourceRefForMr(mr),
      salesOrderDocNo: mr.salesOrder?.docNo ?? null,
      operationalLabel: "Procurement Completed",
      lineCount: (mr.lines || []).length,
      duplicateCount: group.archived.length,
    });
  }
  return rows;
}

const PROCUREMENT_QUEUE_SOURCE_TYPES = Object.freeze([
  "MONTHLY_PLAN",
  "SALES_ORDER",
  "WORK_ORDER_PLANNING",
  "STOCK_REPLENISHMENT",
]);

const DEMAND_POOL_QUEUE_KEYS = Object.freeze(Object.values(PROCUREMENT_DEMAND_POOL));

function computeQueueCounts(pendingMrs) {
  const counts = {
    all: pendingMrs.length,
    monthlyPlan: 0,
    woShortage: 0,
    regularSo: 0,
    minStock: 0,
    byDemandPool: {
      [PROCUREMENT_DEMAND_POOL.REGULAR_SO]: 0,
      [PROCUREMENT_DEMAND_POOL.MPRS]: 0,
      [PROCUREMENT_DEMAND_POOL.STOCK_REPLENISHMENT]: 0,
    },
  };
  for (const mr of pendingMrs) {
    const pool = resolveDemandPoolForSourceType(mr.sourceType);
    if (pool) counts.byDemandPool[pool] = (counts.byDemandPool[pool] || 0) + 1;
    switch (mr.sourceType) {
      case "MONTHLY_PLAN":
        counts.monthlyPlan += 1;
        break;
      case "SALES_ORDER":
        counts.regularSo += 1;
        counts.woShortage += 1;
        break;
      case "WORK_ORDER_PLANNING":
        counts.woShortage += 1;
        break;
      case "STOCK_REPLENISHMENT":
        counts.minStock += 1;
        break;
      default:
        break;
    }
  }
  return counts;
}

function filterPendingMrsByDemandPool(pendingMrs, demandPool) {
  const key = normalizeDemandPoolKey(demandPool);
  if (!key) return pendingMrs;
  return filterMrsByDemandPool(pendingMrs, key);
}

function filterPendingMrsBySourceType(pendingMrs, sourceType) {
  if (!sourceType || !PROCUREMENT_QUEUE_SOURCE_TYPES.includes(sourceType)) return pendingMrs;
  return pendingMrs.filter((mr) => mr.sourceType === sourceType);
}

async function buildPendingMaterialRequirementSummaries(db, mrs) {
  const pendingByMr = await loadPendingRequestAllocByMrLineId(db);
  const sourceTypesByRmItem = buildSourceTypesByRmItem(mrs);
  const out = [];
  for (const mr of mrs) {
    const summary = await summarizeMaterialRequirement(mr, pendingByMr, db);
    const multiSourceItemIds = [];
    summary.lines = (summary.lines || []).map((line) => {
      const types = sourceTypesByRmItem.get(line.rmItemId);
      const multiSourceDemand = (types?.size ?? 0) > 1;
      if (multiSourceDemand) multiSourceItemIds.push(line.rmItemId);
      return {
        ...line,
        multiSourceDemand,
        demandSourceTypes: types ? [...types] : [line.sourceType ?? summary.sourceType].filter(Boolean),
      };
    });
    summary.hasMultiSourceDemand = multiSourceItemIds.length > 0;
    summary.multiSourceRmItemCount = multiSourceItemIds.length;
    out.push(summary);
  }
  return out;
}

/**
 * Full Purchase execution workspace payload.
 */
async function buildProcurementWorkspace(db = prisma, opts = {}) {
  const salesOrderId = opts.salesOrderId != null ? Number(opts.salesOrderId) : null;
  const demandPoolFilter = normalizeDemandPoolKey(opts.demandPool ?? opts.sourceType);
  const sourceTypeFilter =
    !demandPoolFilter &&
    opts.sourceType &&
    PROCUREMENT_QUEUE_SOURCE_TYPES.includes(String(opts.sourceType))
      ? String(opts.sourceType)
      : null;

  const [allPools, pendingMrsAll, pendingPrs, grnPending, completed] = await Promise.all([
    buildAllProcurementDemandPools(db),
    (async () => {
      const poolTypes = demandPoolFilter ? sourceTypesForDemandPool(demandPoolFilter) : null;
      const mrs = await loadOpenMaterialRequirements(db, {
        salesOrderId,
        sourceTypes: poolTypes,
      });
      return buildPendingMaterialRequirementSummaries(db, mrs);
    })(),
    listPendingPurchaseRequests(db),
    buildGrnPendingSection(db),
    buildProcurementCompletedSection(db),
  ]);

  const activePool = demandPoolFilter
    ? allPools[demandPoolFilter]
    : { demandPool: null, items: [], summary: { itemCount: 0, originCount: 0, totalNetRequired: 0, totalNetToBuy: 0, itemsNeedingPurchase: 0 } };

  const queueCounts = computeQueueCounts(pendingMrsAll);
  const pendingMrs = demandPoolFilter
    ? filterPendingMrsByDemandPool(pendingMrsAll, demandPoolFilter)
    : filterPendingMrsBySourceType(pendingMrsAll, sourceTypeFilter);

  const supplierAllocationPending = (activePool.items || [])
    .filter((i) => i.purchaseRequired && i.netRequiredQty > QUEUE_EPS)
    .map((i) => {
      const shortageQty = (i.origins || []).reduce((s, o) => s + qtyToNumber(o.shortageQty), 0);
      return {
        rmItemId: i.rmItemId,
        itemName: i.itemName,
        unit: i.unit,
        requiredQty: qtyToNumber(i.requiredQty),
        shortageQty,
        netRequiredQty: i.netRequiredQty,
        originCount: (i.origins || []).length,
        planningStatus: "Use MR action above",
        origins: i.origins,
      };
    });

  const poPending = await (async () => {
    const pos = await db.rmPurchaseOrder.findMany({
      where: { status: { in: OPEN_PO_STATUSES } },
      include: { supplier: { select: { name: true } }, lines: true },
      orderBy: { id: "desc" },
      take: 60,
    });
    return pos.map((po) => ({
      purchaseOrderId: po.id,
      docNo: po.docNo || `RMPO-${po.id}`,
      supplierName: po.supplier?.name ?? "—",
      status: po.status,
      lineCount: (po.lines || []).length,
      nextActionKey: "OPEN_PO",
    }));
  })();

  const procurementPendingDashboard = await buildProcurementPendingQueue(db, {
    salesOrderId,
    woPlanningOnly: false,
  });
  const procurementPendingFiltered = filterPendingMrsBySourceType(
    procurementPendingDashboard,
    sourceTypeFilter,
  );

  return {
    demandPool: demandPoolFilter,
    pool: activePool,
    pools: allPools,
    summary: {
      /** Open MRs still awaiting first purchase request (not PR/PO/GRN in flight). */
      pendingMrCount: pendingMrsAll.filter((m) => m.operationalKey === "PROCUREMENT_PENDING").length,
      openMrCount: pendingMrsAll.length,
      queueCounts,
      supplierAllocationItemCount: supplierAllocationPending.length,
      purchaseRequestCount: pendingPrs.length,
      poPendingCount: poPending.length,
      grnPendingLineCount: grnPending.length,
      completedCount: completed.length,
      procurementPendingCount: procurementPendingFiltered.length,
    },
    sections: {
      pendingMaterialRequirements: pendingMrs,
      supplierAllocationPending,
      purchaseRequestPending: pendingPrs,
      poPending,
      grnPending,
      procurementCompleted: completed,
      archivedMaterialRequirements: pendingMrs.flatMap((row) => row.archivedMaterialRequirements || []),
    },
    procurementPending: procurementPendingFiltered,
  };
}

module.exports = {
  deriveMrProcurementOperationalStatus,
  procurementBlockerReasonForOperationalKey,
  procurementRecommendedActionForOperationalKey,
  summarizeMaterialRequirement,
  buildProcurementPendingQueue,
  buildProcurementWorkspace,
  buildGrnPendingSection,
  groupMaterialRequirementsByCase,
  mrSourceDescriptor,
  sourceRefForMr,
  buildSourceTypesByRmItem,
  computeQueueCounts,
  filterPendingMrsBySourceType,
  filterPendingMrsByDemandPool,
  DEMAND_POOL_QUEUE_KEYS,
  PROCUREMENT_QUEUE_SOURCE_TYPES,
};
