/**
 * SO → WO → Production → QC → Dispatch trace rows (read-only reporting).
 * Row drivers: active QC entries, production batches with no active QC, WO lines with no production.
 */

const { Prisma } = require("@prisma/client");
const {
  getProductionBatchQcPendingQty,
  sumActiveQcAcceptedQty,
  sumActiveQcRejectedQty,
} = require("./reportMetrics");
const { QC_ENTRY_ACTIVE_WHERE } = require("./qcEntryConstants");
const { netDispatchedByItemId, DISPATCH_ALLOC_MODE } = require("./salesOrderDispatchAllocation");

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/**
 * @param {string | number | undefined} raw
 * @returns {number | undefined}
 */
function parsePositiveInt(raw) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

/**
 * @param {string | undefined} raw
 * @returns {Date | undefined}
 */
function parseDateStart(raw) {
  if (!raw || String(raw).trim() === "") return undefined;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return undefined;
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * @param {string | undefined} raw
 * @returns {Date | undefined}
 */
function parseDateEnd(raw) {
  if (!raw || String(raw).trim() === "") return undefined;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return undefined;
  d.setHours(23, 59, 59, 999);
  return d;
}

function fmtDoc(prefix, id) {
  const n = Number(id);
  if (!Number.isFinite(n)) return `${prefix}-?`;
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

/** Prefer persisted docNo; else legacy id-based label for pre-migration rows. */
function displayDocNo(docNo, prefix, id) {
  const s = docNo != null && String(docNo).trim() !== "" ? String(docNo).trim() : "";
  if (s) return s;
  return fmtDoc(prefix, id);
}

/** @param {unknown} n */
function fmtQty(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const r = Math.round(x * 1000) / 1000;
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
  return String(r);
}

/**
 * Sum ordered qty on the sales order for this FG item (all matching SO lines).
 * @param {{ lines?: { itemId: number; qty: unknown }[] } | null | undefined} so
 * @param {number} fgItemId
 */
function sumSoOrderedQtyForFg(so, fgItemId) {
  let s = 0;
  for (const sl of so?.lines ?? []) {
    if (sl.itemId === fgItemId) s += Number(sl.qty);
  }
  return s;
}

/**
 * @param {string | null} label
 * @param {Date | string | null | undefined} date
 * @param {string[]} [detailLines]
 */
function cell(label, date, detailLines) {
  return {
    label,
    date: date ? new Date(date).toISOString() : null,
    detailLines: (detailLines || []).filter((x) => x != null && String(x).trim() !== ""),
  };
}

/** @param {unknown} n */
function roundReportQty(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 1000) / 1000;
}

/**
 * Distinct (SO, FG item) pairs for the same filtered trace scope as the main union.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {import('@prisma/client').Prisma.Sql} fq
 * @param {import('@prisma/client').Prisma.Sql} fpe
 * @param {import('@prisma/client').Prisma.Sql} fwol
 */
async function loadTraceScopePairs(prisma, fq, fpe, fwol) {
  const pairsSql = Prisma.sql`
    (SELECT DISTINCT wo.salesOrderId AS so_id, wol.fgItemId AS item_id
     FROM QcEntry q
     INNER JOIN ProductionEntry pe ON pe.id = q.productionId
     INNER JOIN WorkOrderLine wol ON wol.id = pe.workOrderLineId
     INNER JOIN WorkOrder wo ON wo.id = wol.workOrderId
     WHERE q.reversedAt IS NULL ${fq})
    UNION
    (SELECT DISTINCT wo.salesOrderId AS so_id, wol.fgItemId AS item_id
     FROM ProductionEntry pe
     INNER JOIN WorkOrderLine wol ON wol.id = pe.workOrderLineId
     INNER JOIN WorkOrder wo ON wo.id = wol.workOrderId
     WHERE NOT EXISTS (
       SELECT 1 FROM QcEntry q2 WHERE q2.productionId = pe.id AND q2.reversedAt IS NULL
     ) ${fpe})
    UNION
    (SELECT DISTINCT wo.salesOrderId AS so_id, wol.fgItemId AS item_id
     FROM WorkOrderLine wol
     INNER JOIN WorkOrder wo ON wo.id = wol.workOrderId
     WHERE NOT EXISTS (
       SELECT 1 FROM ProductionEntry pe2 WHERE pe2.workOrderLineId = wol.id
     ) ${fwol})
  `;

  /** @type {{ so_id: number | bigint; item_id: number | bigint }[]} */
  return prisma.$queryRaw`
    SELECT so_id, item_id FROM (${pairsSql}) AS trace_scope_pairs
  `;
}

/**
 * Per–sales order totals for the filtered trace scope (sums over distinct SO+FG pairs in scope).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {import('@prisma/client').Prisma.Sql} fq
 * @param {import('@prisma/client').Prisma.Sql} fpe
 * @param {import('@prisma/client').Prisma.Sql} fwol
 * @returns {Promise<{ salesOrderId: number; salesOrderNo: string; orderType: string | null; cycleNo: number | null; soQty: number | null; dispatchQty: number; balanceQty: number | null }[]>}
 */
async function computeSoSummariesForTraceScope(prisma, fq, fpe, fwol) {
  const pairRows = await loadTraceScopePairs(prisma, fq, fpe, fwol);

  if (!pairRows.length) {
    return [];
  }

  const soIds = [...new Set(pairRows.map((p) => Number(p.so_id)))];
  const salesOrders = await prisma.salesOrder.findMany({
    where: { id: { in: soIds } },
    include: { lines: true, currentCycle: { select: { cycleNo: true } } },
  });
  const soById = new Map(salesOrders.map((s) => [s.id, s]));

  const dispatches = await prisma.dispatch.findMany({
    where: { soId: { in: soIds } },
  });
  /** @type {Map<number, typeof dispatches>} */
  const dispBySo = new Map();
  for (const d of dispatches) {
    if (!dispBySo.has(d.soId)) dispBySo.set(d.soId, []);
    dispBySo.get(d.soId).push(d);
  }

  /** @type {Map<number, { soQty: number; dispatchQty: number }>} */
  const aggBySo = new Map();
  for (const p of pairRows) {
    const soId = Number(p.so_id);
    const itemId = Number(p.item_id);
    const so = soById.get(soId);
    const netByItem = netDispatchedByItemId(
      dispBySo.get(soId) ?? [],
      DISPATCH_ALLOC_MODE.OPERATIONAL,
    );
    if (!aggBySo.has(soId)) {
      aggBySo.set(soId, { soQty: 0, dispatchQty: 0 });
    }
    const bucket = aggBySo.get(soId);
    bucket.soQty += sumSoOrderedQtyForFg(so, itemId);
    bucket.dispatchQty += netByItem.get(itemId) ?? 0;
  }

  const soSummaries = [...aggBySo.entries()]
    .map(([salesOrderId, v]) => {
      const so = soById.get(salesOrderId) ?? null;
      const orderType = so?.orderType ?? null;
      const isNoQty = orderType === "NO_QTY";

      const soQty = isNoQty ? null : roundReportQty(v.soQty);
      const dispatchQty = roundReportQty(v.dispatchQty);
      const cycleNo =
        orderType === "NO_QTY" && so?.currentCycle?.cycleNo != null && Number.isFinite(Number(so.currentCycle.cycleNo))
          ? Number(so.currentCycle.cycleNo)
          : null;
      return {
        salesOrderId,
        salesOrderNo: displayDocNo(so?.docNo, "SO", salesOrderId),
        orderType,
        cycleNo,
        soQty,
        dispatchQty,
        balanceQty: isNoQty || soQty == null ? null : roundReportQty(soQty - dispatchQty),
      };
    })
    .sort((a, b) => a.salesOrderId - b.salesOrderId);

  return soSummaries;
}

/**
 * @param {{
 *   soSearch?: string;
 *   itemId?: number;
 *   dateFrom?: Date;
 *   dateTo?: Date;
 * }} filters
 * @param {'qc'|'pe'|'wol'} branch
 * @returns {Prisma.Sql}
 */
function buildBranchFilters(filters, branch) {
  const parts = [];
  const soSearch = filters.soSearch?.trim();
  if (soSearch) {
    const digits = soSearch.replace(/\D/g, "");
    if (digits) {
      parts.push(Prisma.sql`AND wo.salesOrderId = ${Number(digits)}`);
    } else {
      parts.push(Prisma.sql`AND 1=0`);
    }
  }
  if (filters.itemId != null && Number.isFinite(filters.itemId)) {
    parts.push(Prisma.sql`AND wol.fgItemId = ${filters.itemId}`);
  }
  if (filters.dateFrom) {
    if (branch === "qc") parts.push(Prisma.sql`AND q.date >= ${filters.dateFrom}`);
    else if (branch === "pe") parts.push(Prisma.sql`AND pe.date >= ${filters.dateFrom}`);
    else parts.push(Prisma.sql`AND wo.createdAt >= ${filters.dateFrom}`);
  }
  if (filters.dateTo) {
    if (branch === "qc") parts.push(Prisma.sql`AND q.date <= ${filters.dateTo}`);
    else if (branch === "pe") parts.push(Prisma.sql`AND pe.date <= ${filters.dateTo}`);
    else parts.push(Prisma.sql`AND wo.createdAt <= ${filters.dateTo}`);
  }
  if (parts.length === 0) return Prisma.empty;
  return Prisma.join(parts, " ");
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ page?: number; pageSize?: number; soSearch?: string; itemId?: number; dateFrom?: Date; dateTo?: Date }} query
 */
async function getSoDispatchTraceReport(prisma, query) {
  const page = Math.max(1, parsePositiveInt(query.page) ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parsePositiveInt(query.pageSize) ?? DEFAULT_PAGE_SIZE));
  const skip = (page - 1) * pageSize;

  const filters = {
    soSearch: query.soSearch,
    itemId: query.itemId,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
  };

  const fq = buildBranchFilters(filters, "qc");
  const fpe = buildBranchFilters(filters, "pe");
  const fwol = buildBranchFilters(filters, "wol");

  const soSummaries = await computeSoSummariesForTraceScope(prisma, fq, fpe, fwol);

  const unionSql = Prisma.sql`
    (SELECT 'qc' AS row_kind, q.id AS anchor_id, q.date AS sort_date
     FROM QcEntry q
     INNER JOIN ProductionEntry pe ON pe.id = q.productionId
     INNER JOIN WorkOrderLine wol ON wol.id = pe.workOrderLineId
     INNER JOIN WorkOrder wo ON wo.id = wol.workOrderId
     WHERE q.reversedAt IS NULL ${fq})
    UNION ALL
    (SELECT 'pe' AS row_kind, pe.id AS anchor_id, pe.date AS sort_date
     FROM ProductionEntry pe
     INNER JOIN WorkOrderLine wol ON wol.id = pe.workOrderLineId
     INNER JOIN WorkOrder wo ON wo.id = wol.workOrderId
     WHERE NOT EXISTS (
       SELECT 1 FROM QcEntry q2 WHERE q2.productionId = pe.id AND q2.reversedAt IS NULL
     ) ${fpe})
    UNION ALL
    (SELECT 'wol' AS row_kind, wol.id AS anchor_id, wo.createdAt AS sort_date
     FROM WorkOrderLine wol
     INNER JOIN WorkOrder wo ON wo.id = wol.workOrderId
     WHERE NOT EXISTS (
       SELECT 1 FROM ProductionEntry pe2 WHERE pe2.workOrderLineId = wol.id
     ) ${fwol})
  `;

  /** @type {{ c: bigint }[]} */
  const countRows = await prisma.$queryRaw`
    SELECT COUNT(*) AS c FROM (${unionSql}) AS trace_union
  `;
  const total = Number(countRows[0]?.c ?? 0);

  /** @type {{ row_kind: string; anchor_id: number; sort_date: Date }[]} */
  const pageRows = await prisma.$queryRaw`
    SELECT row_kind, anchor_id, sort_date FROM (${unionSql}) AS trace_union
    ORDER BY sort_date DESC, anchor_id DESC
    LIMIT ${pageSize} OFFSET ${skip}
  `;

  const qcIds = pageRows.filter((r) => r.row_kind === "qc").map((r) => r.anchor_id);
  const peIds = pageRows.filter((r) => r.row_kind === "pe").map((r) => r.anchor_id);
  const wolIds = pageRows.filter((r) => r.row_kind === "wol").map((r) => r.anchor_id);

  const salesOrderInclude = { include: { lines: true, currentCycle: { select: { cycleNo: true } } } };

  const qcMap = new Map();
  if (qcIds.length) {
    const qcs = await prisma.qcEntry.findMany({
      where: { id: { in: qcIds } },
      include: {
        production: {
          include: {
            qcEntries: { where: QC_ENTRY_ACTIVE_WHERE },
            workOrderLine: {
              include: {
                workOrder: { include: { salesOrder: salesOrderInclude } },
                fgItem: true,
              },
            },
          },
        },
      },
    });
    for (const q of qcs) qcMap.set(q.id, q);
  }

  const peMap = new Map();
  if (peIds.length) {
    const pes = await prisma.productionEntry.findMany({
      where: { id: { in: peIds } },
      include: {
        workOrderLine: {
          include: {
            workOrder: { include: { salesOrder: salesOrderInclude } },
            fgItem: true,
          },
        },
      },
    });
    for (const p of pes) peMap.set(p.id, p);
  }

  const wolMap = new Map();
  if (wolIds.length) {
    const wols = await prisma.workOrderLine.findMany({
      where: { id: { in: wolIds } },
      include: {
        workOrder: { include: { salesOrder: salesOrderInclude } },
        fgItem: true,
      },
    });
    for (const w of wols) wolMap.set(w.id, w);
  }

  /** Forward dispatch rows only, for matching SO + FG item */
  const soItemKeys = new Set();
  for (const r of pageRows) {
    if (r.row_kind === "qc") {
      const q = qcMap.get(r.anchor_id);
      if (q?.production?.workOrderLine) {
        soItemKeys.add(`${q.production.workOrderLine.workOrder.salesOrderId}:${q.production.workOrderLine.fgItemId}`);
      }
    } else if (r.row_kind === "pe") {
      const pe = peMap.get(r.anchor_id);
      if (pe?.workOrderLine) {
        soItemKeys.add(`${pe.workOrderLine.workOrder.salesOrderId}:${pe.workOrderLine.fgItemId}`);
      }
    }
  }

  const dispatchBySoItem = new Map();
  if (soItemKeys.size) {
    const pairs = [...soItemKeys].map((k) => {
      const [soId, itemId] = k.split(":").map(Number);
      return { soId, itemId };
    });
    const soIds = [...new Set(pairs.map((p) => p.soId))];
    const dispatches = await prisma.dispatch.findMany({
      where: {
        soId: { in: soIds },
        reversalOfId: null,
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });
    for (const d of dispatches) {
      const key = `${d.soId}:${d.itemId}`;
      if (!dispatchBySoItem.has(key)) dispatchBySoItem.set(key, []);
      dispatchBySoItem.get(key).push(d);
    }
  }

  function pickDispatch(soId, fgItemId, refDate) {
    const list = dispatchBySoItem.get(`${soId}:${fgItemId}`);
    if (!list?.length) return null;
    const ref = refDate ? new Date(refDate).getTime() : null;
    if (ref != null && !Number.isNaN(ref)) {
      const after = list.filter((d) => new Date(d.date).getTime() >= ref - 1000);
      if (after.length) return after[0];
    }
    return list[list.length - 1];
  }

  const rows = [];
  for (const pr of pageRows) {
    if (pr.row_kind === "qc") {
      const q = qcMap.get(pr.anchor_id);
      if (!q?.production?.workOrderLine?.workOrder) continue;
      const pe = q.production;
      const wol = pe.workOrderLine;
      const wo = wol.workOrder;
      const soId = wo.salesOrderId;
      const so = wo.salesOrder;
      const fgItemId = wol.fgItemId;
      const soOrdered = sumSoOrderedQtyForFg(so, fgItemId);
      const woLineQty = Number(wol.qty);
      const produced = Number(pe.producedQty);
      const acc = Number(q.acceptedQty);
      const rej = Number(q.rejectedQty);
      const qcEntries = pe.qcEntries || [];
      const accSum = sumActiveQcAcceptedQty(qcEntries);
      const rejSum = sumActiveQcRejectedQty(qcEntries);
      const qcBatchPending = getProductionBatchQcPendingQty(produced, accSum, rejSum);
      const disp = pickDispatch(soId, fgItemId, q.date);
      const qcDetail = [
        `Accepted: ${fmtQty(acc)} · Rejected: ${fmtQty(rej)}`,
        qcBatchPending > 1e-6 ? `QC pending (batch): ${fmtQty(qcBatchPending)}` : null,
      ].filter((x) => x != null);
      rows.push({
        rowKey: `qc-${q.id}`,
        salesOrder: cell(displayDocNo(so?.docNo, "SO", soId), so?.createdAt ?? wo.createdAt, [`Ordered (FG): ${fmtQty(soOrdered)}`]),
        workOrder: cell(displayDocNo(wo.docNo, "WO", wo.id), wo.createdAt, [`Line qty: ${fmtQty(woLineQty)}`]),
        production: cell(displayDocNo(pe.docNo, "PE", pe.id), pe.date, [`Produced: ${fmtQty(produced)}`]),
        qc: cell(displayDocNo(q.docNo, "QC", q.id), q.date, qcDetail),
        dispatch: disp ? cell(displayDocNo(disp.docNo, "D", disp.id), disp.date) : cell(null, null),
      });
      continue;
    }
    if (pr.row_kind === "pe") {
      const pe = peMap.get(pr.anchor_id);
      if (!pe?.workOrderLine?.workOrder) continue;
      const wol = pe.workOrderLine;
      const wo = wol.workOrder;
      const soId = wo.salesOrderId;
      const so = wo.salesOrder;
      const fgItemId = wol.fgItemId;
      const soOrdered = sumSoOrderedQtyForFg(so, fgItemId);
      const woLineQty = Number(wol.qty);
      const produced = Number(pe.producedQty);
      const disp = pickDispatch(soId, fgItemId, pe.date);
      rows.push({
        rowKey: `pe-${pe.id}`,
        salesOrder: cell(displayDocNo(so?.docNo, "SO", soId), so?.createdAt ?? wo.createdAt, [`Ordered (FG): ${fmtQty(soOrdered)}`]),
        workOrder: cell(displayDocNo(wo.docNo, "WO", wo.id), wo.createdAt, [`Line qty: ${fmtQty(woLineQty)}`]),
        production: cell(displayDocNo(pe.docNo, "PE", pe.id), pe.date, [`Produced: ${fmtQty(produced)}`]),
        qc: cell(null, null),
        dispatch: disp ? cell(displayDocNo(disp.docNo, "D", disp.id), disp.date) : cell(null, null),
      });
      continue;
    }
    if (pr.row_kind === "wol") {
      const wol = wolMap.get(pr.anchor_id);
      if (!wol?.workOrder) continue;
      const wo = wol.workOrder;
      const soId = wo.salesOrderId;
      const so = wo.salesOrder;
      const fgItemId = wol.fgItemId;
      const soOrdered = sumSoOrderedQtyForFg(so, fgItemId);
      const woLineQty = Number(wol.qty);
      rows.push({
        rowKey: `wol-${wol.id}`,
        salesOrder: cell(displayDocNo(so?.docNo, "SO", soId), so?.createdAt ?? wo.createdAt, [`Ordered (FG): ${fmtQty(soOrdered)}`]),
        workOrder: cell(displayDocNo(wo.docNo, "WO", wo.id), wo.createdAt, [`Line qty: ${fmtQty(woLineQty)}`]),
        production: cell(null, null),
        qc: cell(null, null),
        dispatch: cell(null, null),
      });
    }
  }

  return {
    rows,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    soSummaries,
  };
}

module.exports = {
  getSoDispatchTraceReport,
  parsePositiveInt,
  parseDateStart,
  parseDateEnd,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
};
