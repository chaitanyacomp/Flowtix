/**
 * P6D — RM Planning vs Actual Received (read-only month-wise report).
 */

const { prisma } = require("../utils/prisma");
const { QUEUE_EPS, qtyToNumber } = require("./rmPurchaseHelpers");
const { round3 } = require("./bomExplosionService");
const { resolveRmSnapshotRevision, buildMonthlyPlanReleaseLabel } = require("./monthlyPlanningRmSnapshotService");
const { rmPoDisplayNo, grnDisplayNo } = require("./procurementTraceService");

const PROCUREMENT_SOURCES = Object.freeze({
  ALL: "ALL",
  MONTHLY_PLAN: "MONTHLY_PLAN",
  SALES_ORDER: "SALES_ORDER",
  STOCK_REPLENISHMENT: "STOCK_REPLENISHMENT",
});

const ROW_STATUSES = Object.freeze({
  SHORT_RECEIVED: "SHORT_RECEIVED",
  FULLY_RECEIVED: "FULLY_RECEIVED",
  OVER_RECEIVED: "OVER_RECEIVED",
  NO_PO: "NO_PO",
  NO_GRN: "NO_GRN",
});

const ROW_STATUS_LABELS = Object.freeze({
  SHORT_RECEIVED: "Short Received",
  FULLY_RECEIVED: "Fully Received",
  OVER_RECEIVED: "Over Received",
  NO_PO: "No PO",
  NO_GRN: "No GRN",
});

const SOURCE_TYPE_LABELS = Object.freeze({
  MONTHLY_PLAN: "Monthly Planning",
  SALES_ORDER: "Sales Order",
  STOCK_REPLENISHMENT: "Stock Replenishment",
  WORK_ORDER_PLANNING: "Work Order Planning",
  QUOTATION: "Quotation",
});

function n(v) {
  return round3(qtyToNumber(v));
}

function parsePositiveInt(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function parsePeriodKey(raw) {
  const key = String(raw || "").trim();
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const periodStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const periodEnd = new Date(year, month, 0, 23, 59, 59, 999);
  return { periodKey: key, periodStart, periodEnd, year, month };
}

function defaultPeriodKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function parseFilters(query = {}) {
  const periodKey = String(query.periodKey || query.month || "").trim() || defaultPeriodKey();
  const period = parsePeriodKey(periodKey);
  if (!period) {
    const err = new Error("Invalid periodKey. Use YYYY-MM format.");
    err.statusCode = 400;
    throw err;
  }

  const rawSource = String(query.procurementSource || query.sourceType || "ALL")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  let procurementSource = PROCUREMENT_SOURCES.ALL;
  if (rawSource === "MONTHLY_PLAN" || rawSource === "MONTHLY_PLANNING") {
    procurementSource = PROCUREMENT_SOURCES.MONTHLY_PLAN;
  } else if (rawSource === "SALES_ORDER") {
    procurementSource = PROCUREMENT_SOURCES.SALES_ORDER;
  } else if (rawSource === "STOCK_REPLENISHMENT") {
    procurementSource = PROCUREMENT_SOURCES.STOCK_REPLENISHMENT;
  }

  const rawStatus = String(query.status || "ALL").trim().toUpperCase().replace(/\s+/g, "_");
  const status =
    rawStatus === "SHORT_RECEIVED" ||
    rawStatus === "FULLY_RECEIVED" ||
    rawStatus === "OVER_RECEIVED" ||
    rawStatus === "NO_PO" ||
    rawStatus === "NO_GRN"
      ? rawStatus
      : "ALL";

  return {
    period,
    rmItemId: parsePositiveInt(query.rmItemId),
    procurementSource,
    supplierId: parsePositiveInt(query.supplierId),
    status,
    exportMode: String(query.export || "").toLowerCase(),
  };
}

function deriveRowStatus({ plannedQty, poQty, grnQty, releasedQty }) {
  if (poQty <= QUEUE_EPS) {
    if (plannedQty > QUEUE_EPS || releasedQty > QUEUE_EPS) return ROW_STATUSES.NO_PO;
    return ROW_STATUSES.NO_GRN;
  }
  if (grnQty <= QUEUE_EPS) return ROW_STATUSES.NO_GRN;
  const variance = grnQty - plannedQty;
  if (variance < -QUEUE_EPS) return ROW_STATUSES.SHORT_RECEIVED;
  if (variance > QUEUE_EPS) return ROW_STATUSES.OVER_RECEIVED;
  return ROW_STATUSES.FULLY_RECEIVED;
}

function variancePercent(plannedQty, varianceQty) {
  if (plannedQty <= QUEUE_EPS) return null;
  return round3((varianceQty / plannedQty) * 100);
}

function grnQtyForPoLine(rmPoLine) {
  let sum = 0;
  for (const gl of rmPoLine?.grnLines || []) {
    if (gl.grn?.reversedAt) continue;
    sum += qtyToNumber(gl.receivedQty);
  }
  return round3(sum);
}

function mapSourceTypeLabel(sourceType) {
  return SOURCE_TYPE_LABELS[sourceType] ?? sourceType ?? null;
}

function buildMrLineWhere(filters, planIds) {
  const { period, procurementSource } = filters;
  const branches = [];

  if (procurementSource === PROCUREMENT_SOURCES.ALL || procurementSource === PROCUREMENT_SOURCES.MONTHLY_PLAN) {
    if (planIds.length) {
      branches.push({
        materialRequirement: {
          reversedAt: null,
          sourceType: "MONTHLY_PLAN",
          monthlyProductionPlanId: { in: planIds },
        },
      });
    }
  }
  if (procurementSource === PROCUREMENT_SOURCES.ALL || procurementSource === PROCUREMENT_SOURCES.SALES_ORDER) {
    branches.push({
      materialRequirement: {
        reversedAt: null,
        sourceType: "SALES_ORDER",
        createdAt: { gte: period.periodStart, lte: period.periodEnd },
      },
    });
  }
  if (
    procurementSource === PROCUREMENT_SOURCES.ALL ||
    procurementSource === PROCUREMENT_SOURCES.STOCK_REPLENISHMENT
  ) {
    branches.push({
      materialRequirement: {
        reversedAt: null,
        sourceType: "STOCK_REPLENISHMENT",
        createdAt: { gte: period.periodStart, lte: period.periodEnd },
      },
    });
  }

  if (!branches.length) {
    return { id: -1 };
  }

  /** @type {import('@prisma/client').Prisma.MaterialRequirementLineWhereInput} */
  const where = branches.length === 1 ? branches[0] : { OR: branches };
  if (filters.rmItemId) where.rmItemId = filters.rmItemId;
  return where;
}

const MR_LINE_INCLUDE = {
  rmItem: { select: { id: true, itemName: true, unit: true } },
  materialRequirement: {
    include: {
      monthlyProductionPlan: {
        select: {
          id: true,
          docNo: true,
          periodKey: true,
          planSequenceNo: true,
          planKind: true,
          currentRevision: true,
          status: true,
        },
      },
    },
  },
  purchaseRequestSourceLinks: {
    include: {
      purchaseRequestLine: {
        include: {
          purchaseRequest: { select: { id: true, docNo: true } },
          poLinks: {
            include: {
              rmPoLine: {
                include: {
                  rmPo: { include: { supplier: { select: { id: true, name: true } } } },
                  grnLines: { include: { grn: { select: { id: true, date: true, reversedAt: true } } } },
                },
              },
            },
          },
        },
      },
    },
  },
  procurementLinks: {
    include: {
      rmPoLine: {
        include: {
          rmPo: { include: { supplier: { select: { id: true, name: true } } } },
          grnLines: { include: { grn: { select: { id: true, date: true, reversedAt: true } } } },
        },
      },
    },
  },
};

async function loadPlansForPeriod(db, periodKey) {
  return db.monthlyProductionPlan.findMany({
    where: {
      periodKey,
      status: { in: ["APPROVED", "LOCKED"] },
    },
    orderBy: [{ planSequenceNo: "asc" }, { id: "asc" }],
    select: {
      id: true,
      docNo: true,
      periodKey: true,
      planSequenceNo: true,
      planKind: true,
      currentRevision: true,
      status: true,
    },
  });
}

async function loadPlannedByItem(db, plans) {
  /** @type {Map<number, { rmItemId: number; itemName: string; unit: string; plannedQty: number; planningSources: object[] }>} */
  const byItem = new Map();

  for (const plan of plans) {
    const existingRmPlan = await db.rmPlan.findFirst({
      where: { planId: plan.id },
      orderBy: { revision: "desc" },
      select: { revision: true },
    });
    const revision = resolveRmSnapshotRevision(plan, existingRmPlan);
    if (revision == null || revision <= 0) continue;

    const rmPlan = await db.rmPlan.findUnique({
      where: { planId_revision: { planId: plan.id, revision } },
      include: {
        lines: {
          include: { rmItem: { select: { id: true, itemName: true, unit: true } } },
        },
      },
    });
    if (!rmPlan?.lines?.length) continue;

    const planLabel = buildMonthlyPlanReleaseLabel(plan, revision);
    for (const line of rmPlan.lines) {
      const rmItemId = line.rmItemId;
      const qty = n(line.netRequirementQty);
      const itemName = line.rmItem?.itemName ?? `Item #${rmItemId}`;
      const unit = line.unitSnapshot ?? line.rmItem?.unit ?? "";
      const prev = byItem.get(rmItemId) ?? {
        rmItemId,
        itemName,
        unit,
        plannedQty: 0,
        planningSources: [],
      };
      prev.plannedQty = round3(prev.plannedQty + qty);
      prev.planningSources.push({
        planId: plan.id,
        planDocNo: plan.docNo,
        planLabel,
        revision,
        periodKey: plan.periodKey,
        sourceType: "MONTHLY_PLAN",
        sourceTypeLabel: mapSourceTypeLabel("MONTHLY_PLAN"),
        plannedQty: qty,
      });
      byItem.set(rmItemId, prev);
    }
  }

  return byItem;
}

function collectPoTouchesFromMrLine(mrLine) {
  const touches = [];
  for (const sl of mrLine.purchaseRequestSourceLinks || []) {
    const prLine = sl.purchaseRequestLine;
    const pr = prLine?.purchaseRequest ?? null;
    for (const link of prLine?.poLinks || []) {
      if (!link.rmPoLine) continue;
      touches.push({
        mrLine,
        mr: mrLine.materialRequirement,
        pr,
        prLine,
        link,
        rmPoLine: link.rmPoLine,
      });
    }
  }
  for (const link of mrLine.procurementLinks || []) {
    if (!link.rmPoLine) continue;
    touches.push({
      mrLine,
      mr: mrLine.materialRequirement,
      pr: null,
      prLine: null,
      link,
      rmPoLine: link.rmPoLine,
    });
  }
  return touches;
}

function buildProcurementDetailRow(touch) {
  const { mr, mrLine, pr, rmPoLine, link } = touch;
  const rmPo = rmPoLine.rmPo;
  const supplier = rmPo?.supplier ?? null;
  const poQty = n(rmPoLine.qty);
  const grnEntries = [];
  for (const gl of rmPoLine.grnLines || []) {
    if (gl.grn?.reversedAt) continue;
    grnEntries.push({
      grnId: gl.grnId,
      grnNo: grnDisplayNo(gl.grnId),
      grnQty: n(gl.receivedQty),
      grnDate: gl.grn?.date ?? null,
    });
  }
  const grnQty = round3(grnEntries.reduce((a, g) => a + g.grnQty, 0));
  const plan = mr?.monthlyProductionPlan ?? null;
  return {
    sourceType: mr?.sourceType ?? null,
    sourceTypeLabel: mapSourceTypeLabel(mr?.sourceType),
    mrId: mr?.id ?? null,
    mrDocNo: mr?.docNo ?? null,
    prId: pr?.id ?? null,
    prDocNo: pr?.docNo ?? null,
    rmPoId: rmPo?.id ?? null,
    rmPoDisplayNo: rmPo?.id ? rmPoDisplayNo(rmPo.id) : null,
    supplierId: supplier?.id ?? null,
    supplierName: supplier?.name ?? null,
    poQty,
    allocatedQty: n(link.allocatedQty),
    grnQty,
    grnEntries,
    planId: plan?.id ?? null,
    planDocNo: plan?.docNo ?? null,
    periodKey: plan?.periodKey ?? null,
    planRevision: mr?.sourceRevision ?? null,
    releasedQty: n(mrLine.requiredQty),
  };
}

function aggregateProcurementFromMrLines(mrLines, filters, plannedByItem) {
  /** @type {Map<number, ReturnType<typeof mergeItemRow>>} */
  const rows = new Map();

  for (const [rmItemId, planned] of plannedByItem) {
    if (filters.rmItemId && rmItemId !== filters.rmItemId) continue;
    rows.set(rmItemId, {
      rmItemId,
      itemName: planned.itemName,
      unit: planned.unit,
      plannedQty: planned.plannedQty,
      releasedQty: 0,
      poQty: 0,
      grnQty: 0,
      planningSources: [...planned.planningSources],
      procurementDetails: [],
      poLineIds: new Set(),
    });
  }

  for (const mrLine of mrLines) {
    const rmItemId = mrLine.rmItemId;
    if (filters.rmItemId && rmItemId !== filters.rmItemId) continue;

    const itemName = mrLine.rmItem?.itemName ?? `Item #${rmItemId}`;
    const unit = mrLine.unitSnapshot ?? mrLine.rmItem?.unit ?? "";
    const releasedQty = n(mrLine.requiredQty);

    let row = rows.get(rmItemId) ?? {
      rmItemId,
      itemName,
      unit,
      plannedQty: 0,
      releasedQty: 0,
      poQty: 0,
      grnQty: 0,
      planningSources: [],
      procurementDetails: [],
      poLineIds: new Set(),
    };

    row.releasedQty = round3(row.releasedQty + releasedQty);

    const poLineIdsForRow = row.poLineIds;
    const touches = collectPoTouchesFromMrLine(mrLine);
    for (const touch of touches) {
      const supplierId = touch.rmPoLine?.rmPo?.supplier?.id ?? null;
      if (filters.supplierId && supplierId !== filters.supplierId) continue;

      const poLineId = touch.rmPoLine.id;
      const detail = buildProcurementDetailRow(touch);
      row.procurementDetails.push(detail);

      if (!poLineIdsForRow.has(poLineId)) {
        poLineIdsForRow.add(poLineId);
        row.poQty = round3(row.poQty + detail.poQty);
        row.grnQty = round3(row.grnQty + detail.grnQty);
      }
    }

    rows.set(rmItemId, row);
  }

  return rows;
}

function finalizeRow(raw) {
  const plannedQty = n(raw.plannedQty);
  const releasedQty = n(raw.releasedQty);
  const poQty = n(raw.poQty);
  const grnQty = n(raw.grnQty);
  const pendingGrnQty = round3(Math.max(0, poQty - grnQty));
  const varianceQty = round3(grnQty - plannedQty);
  const status = deriveRowStatus({ plannedQty, poQty, grnQty, releasedQty });
  return {
    rmItemId: raw.rmItemId,
    rmItemName: raw.itemName,
    unit: raw.unit,
    plannedRmQty: plannedQty,
    releasedProcurementQty: releasedQty,
    poQty,
    grnReceivedQty: grnQty,
    pendingGrnQty,
    varianceQty,
    variancePercent: variancePercent(plannedQty, varianceQty),
    status,
    statusLabel: ROW_STATUS_LABELS[status],
    planningSources: raw.planningSources ?? [],
    procurementDetails: raw.procurementDetails ?? [],
  };
}

function applyStatusFilter(rows, statusFilter) {
  if (statusFilter === "ALL") return rows;
  return rows.filter((r) => r.status === statusFilter);
}

function buildSummary(rows) {
  let totalPlanned = 0;
  let totalPo = 0;
  let totalReceived = 0;
  let totalPending = 0;
  let overReceivedItems = 0;
  let shortReceivedItems = 0;

  for (const r of rows) {
    totalPlanned = round3(totalPlanned + r.plannedRmQty);
    totalPo = round3(totalPo + r.poQty);
    totalReceived = round3(totalReceived + r.grnReceivedQty);
    totalPending = round3(totalPending + r.pendingGrnQty);
    if (r.status === ROW_STATUSES.OVER_RECEIVED) overReceivedItems += 1;
    if (r.status === ROW_STATUSES.SHORT_RECEIVED) shortReceivedItems += 1;
  }

  return {
    totalPlannedRmQty: totalPlanned,
    totalPoQty: totalPo,
    totalReceivedQty: totalReceived,
    totalPendingGrnQty: totalPending,
    overReceivedItems,
    shortReceivedItems,
  };
}

function deriveEmptyState({ plannedByItem, rows, mrLineCount, filters }) {
  const hasPlanning = plannedByItem.size > 0;
  const hasProcurementActivity = mrLineCount > 0 || rows.some((r) => r.releasedProcurementQty > QUEUE_EPS);
  const hasPo = rows.some((r) => r.poQty > QUEUE_EPS);
  const hasGrn = rows.some((r) => r.grnReceivedQty > QUEUE_EPS);

  if (!hasPlanning && !hasProcurementActivity) {
    return {
      code: "NO_PLANNING",
      message: "No RM planning records found for this period.",
    };
  }
  if (
    hasPlanning &&
    !hasPo &&
    (filters.procurementSource === PROCUREMENT_SOURCES.ALL ||
      filters.procurementSource === PROCUREMENT_SOURCES.MONTHLY_PLAN)
  ) {
    return {
      code: "PLANNED_NO_PROCUREMENT",
      message: "RM planned but procurement not released.",
    };
  }
  if (hasPo && !hasGrn) {
    return {
      code: "PO_PENDING_GRN",
      message: "PO created, GRN pending.",
    };
  }
  return null;
}

function rowsToCsv(rows) {
  const header = [
    "RM Item",
    "Unit",
    "Planned RM Qty",
    "Released Procurement Qty",
    "PO Qty",
    "GRN Received Qty",
    "Pending GRN Qty",
    "Variance Qty",
    "Variance %",
    "Status",
  ];
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = rows.map((r) =>
    [
      r.rmItemName,
      r.unit,
      r.plannedRmQty,
      r.releasedProcurementQty,
      r.poQty,
      r.grnReceivedQty,
      r.pendingGrnQty,
      r.varianceQty,
      r.variancePercent ?? "",
      r.statusLabel,
    ]
      .map(esc)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} [db]
 * @param {import('express').Request['query']} query
 */
async function buildRmPlanningVsReceivedReport(db = prisma, query = {}) {
  const filters = parseFilters(query);
  const plans = await loadPlansForPeriod(db, filters.period.periodKey);
  const planIds = plans.map((p) => p.id);

  const plannedByItem = await loadPlannedByItem(db, plans);

  const mrWhere = buildMrLineWhere(filters, planIds);
  const mrLines = await db.materialRequirementLine.findMany({
    where: mrWhere,
    include: MR_LINE_INCLUDE,
  });

  const aggregated = aggregateProcurementFromMrLines(mrLines, filters, plannedByItem);
  const allRows = [...aggregated.values()].map(finalizeRow).sort((a, b) => a.rmItemName.localeCompare(b.rmItemName));
  const emptyState = deriveEmptyState({
    plannedByItem,
    rows: allRows,
    mrLineCount: mrLines.length,
    filters,
  });
  const rows = applyStatusFilter(allRows, filters.status);
  const summary = buildSummary(rows);

  if (filters.exportMode === "csv") {
    return {
      export: "csv",
      csv: rowsToCsv(rows),
      rowCount: rows.length,
      filters: {
        periodKey: filters.period.periodKey,
        rmItemId: filters.rmItemId,
        procurementSource: filters.procurementSource,
        supplierId: filters.supplierId,
        status: filters.status,
      },
    };
  }

  return {
    periodKey: filters.period.periodKey,
    periodLabel: filters.period.periodKey,
    filters: {
      periodKey: filters.period.periodKey,
      rmItemId: filters.rmItemId,
      procurementSource: filters.procurementSource,
      supplierId: filters.supplierId,
      status: filters.status,
    },
    summary,
    emptyState,
    rows,
    plans: plans.map((p) => ({
      id: p.id,
      docNo: p.docNo,
      periodKey: p.periodKey,
      planSequenceNo: p.planSequenceNo,
      planKind: p.planKind,
      status: p.status,
    })),
  };
}

module.exports = {
  PROCUREMENT_SOURCES,
  ROW_STATUSES,
  ROW_STATUS_LABELS,
  parsePeriodKey,
  parseFilters,
  deriveRowStatus,
  variancePercent,
  grnQtyForPoLine,
  finalizeRow,
  applyStatusFilter,
  buildSummary,
  deriveEmptyState,
  rowsToCsv,
  buildRmPlanningVsReceivedReport,
};
