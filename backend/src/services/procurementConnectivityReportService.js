const {
  RM_PO_INCLUDE,
  assembleRmPoProcurementTrace,
  rmPoDisplayNo,
} = require("./procurementTraceService");
const { QUEUE_EPS, qtyToNumber } = require("./rmPurchaseHelpers");

const RECEIPT_STATUSES = Object.freeze({
  PENDING_RECEIPT: "PENDING_RECEIPT",
  PARTIALLY_RECEIVED: "PARTIALLY_RECEIVED",
  RECEIVED: "RECEIVED",
});

const BILL_STATUSES = Object.freeze({
  NOT_BILLED: "NOT_BILLED",
  BILLED: "BILLED",
});

const RECEIPT_STATUS_LABELS = Object.freeze({
  PENDING_RECEIPT: "Pending receipt",
  PARTIALLY_RECEIVED: "Partially received",
  RECEIVED: "Received",
});

const BILL_STATUS_LABELS = Object.freeze({
  NOT_BILLED: "Not billed",
  BILLED: "Billed",
});

const {
  formatDemandSourceLabel,
  LEGACY_HISTORICAL_DEMAND,
  SOURCE_CATEGORY_LABELS,
} = require("./procurementDemandSourcePresentation");

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseFilters(query = {}) {
  return {
    sourceType: query.sourceType ? String(query.sourceType).trim() : null,
    rmItemId: parsePositiveInt(query.rmItemId),
    supplierId: parsePositiveInt(query.supplierId),
    rmPoId: parsePositiveInt(query.rmPoId),
    mrId: parsePositiveInt(query.mrId),
    prId: parsePositiveInt(query.prId),
    status: query.status ? String(query.status).trim().toUpperCase() : null,
  };
}

function buildPoWhere(filters) {
  const where = {};
  if (filters.supplierId) where.supplierId = filters.supplierId;
  if (filters.rmPoId) where.id = filters.rmPoId;
  return where;
}

function deriveReceiptStatus(orderedQty, receivedQty, pendingQty) {
  if (receivedQty <= QUEUE_EPS) return RECEIPT_STATUSES.PENDING_RECEIPT;
  if (pendingQty > QUEUE_EPS) return RECEIPT_STATUSES.PARTIALLY_RECEIVED;
  return RECEIPT_STATUSES.RECEIVED;
}

function deriveBillStatus(purchaseBillLines) {
  const lines = purchaseBillLines || [];
  const hasFinalized = lines.some((bl) => bl.purchaseBill?.status === "FINALIZED");
  return hasFinalized ? BILL_STATUSES.BILLED : BILL_STATUSES.NOT_BILLED;
}

function demandSourceLabel(ds) {
  return formatDemandSourceLabel(ds);
}

function buildStockPostedSummary(grnLines) {
  const activeWithStock = (grnLines || []).filter(
    (gl) => !gl.isReversed && (gl.stockTransactions || []).length > 0,
  );
  if (!activeWithStock.length) {
    return { posted: false, label: "Not posted", locations: [] };
  }
  const locations = [];
  const seen = new Set();
  for (const gl of activeWithStock) {
    for (const st of gl.stockTransactions || []) {
      const loc = gl.location;
      const key = loc ? `${loc.id}` : `txn-${st.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      locations.push({
        locationId: loc?.id ?? st.locationId ?? null,
        locationName: loc?.name ?? null,
        locationCode: loc?.code ?? null,
        qtyIn: st.qtyIn,
        stockBucket: st.stockBucket,
      });
    }
  }
  const locLabels = locations
    .map((l) => l.locationName || l.locationCode || (l.locationId ? `Loc #${l.locationId}` : "Stock"))
    .filter(Boolean);
  return {
    posted: true,
    label: locLabels.length ? `Posted — ${locLabels.join(", ")}` : "Posted",
    locations,
  };
}

function buildGrnSummary(grnLines) {
  const lines = grnLines || [];
  const active = lines.filter((gl) => !gl.isReversed);
  const reversed = lines.filter((gl) => gl.isReversed);
  const activeNos = [...new Set(active.map((gl) => gl.grnNo))];
  const reversedNos = [...new Set(reversed.map((gl) => gl.grnNo))];
  let label = "Pending receipt";
  if (activeNos.length) {
    label = activeNos.join(", ");
    if (reversedNos.length) label += ` (+ reversed: ${reversedNos.join(", ")})`;
  } else if (reversedNos.length) {
    label = `Reversed: ${reversedNos.join(", ")}`;
  }
  return {
    label,
    activeGrnNos: activeNos,
    reversedGrnNos: reversedNos,
    activeCount: active.length,
    reversedCount: reversed.length,
  };
}

function buildTraceChainForDemand(demandSource, rmPoId, grnLines, stockTransactions, purchaseBillLines) {
  const labels = [];
  if (demandSource?.monthlyPlan?.label) labels.push(demandSource.monthlyPlan.label);
  else if (demandSource?.monthlyPlanRevision != null) {
    labels.push(`Monthly Plan Rev ${demandSource.monthlyPlanRevision}`);
  } else if (demandSource?.demandSourceType) {
    labels.push(demandSourceLabel(demandSource));
  }
  if (demandSource?.mr?.docNo) labels.push(demandSource.mr.docNo);
  if (demandSource?.pr?.docNo) labels.push(demandSource.pr.docNo);
  labels.push(rmPoDisplayNo(rmPoId));
  const activeGrnLines = (grnLines || []).filter((gl) => !gl.isReversed);
  for (const gl of activeGrnLines) {
    labels.push(gl.grnNo);
    if ((gl.stockTransactions || []).length) labels.push("Stock IN");
    for (const bl of gl.purchaseBillLines || []) {
      const billNo = bl.purchaseBill?.billNo;
      labels.push(billNo ? `Bill ${billNo}` : `Bill #${bl.purchaseBillId}`);
    }
  }
  if (!activeGrnLines.length && (stockTransactions || []).length) labels.push("Stock IN");
  if (!activeGrnLines.length) {
    for (const bl of purchaseBillLines || []) {
      const billNo = bl.purchaseBill?.billNo;
      labels.push(billNo ? `Bill ${billNo}` : `Bill #${bl.purchaseBillId}`);
    }
  }
  return labels;
}

/**
 * Flatten assembled PO trace into report rows (demand-source grain).
 * @param {ReturnType<typeof assembleRmPoProcurementTrace>} trace
 */
function flattenTraceToReportRows(trace) {
  const rows = [];
  for (const line of trace.lines || []) {
    const demandSources = line.demandSources?.length ? line.demandSources : [null];
    const receiptStatus = deriveReceiptStatus(line.orderedQty, line.receivedQty, line.pendingQty);
    const billStatus = deriveBillStatus(line.purchaseBillLines);
    const stockPosted = buildStockPostedSummary(line.grnLines);
    const grnSummary = buildGrnSummary(line.grnLines);

    demandSources.forEach((ds, idx) => {
      rows.push({
        rowKey: `${trace.rmPo.id}-${line.id}-${idx}`,
        rmPoId: trace.rmPo.id,
        rmPoLineId: line.id,
        rmPoDisplayNo: trace.rmPo.displayNo,
        rmPoStatus: trace.rmPo.status,
        supplier: trace.supplier,
        rmItem: line.item,
        orderedQty: line.orderedQty,
        receivedQty: line.receivedQty,
        pendingQty: line.pendingQty,
        receiptStatus,
        receiptStatusLabel: RECEIPT_STATUS_LABELS[receiptStatus],
        billStatus,
        billStatusLabel: BILL_STATUS_LABELS[billStatus],
        demandSourceType: ds?.demandSourceType ?? null,
        demandSourceLabel: demandSourceLabel(ds),
        monthlyPlanRevision: ds?.monthlyPlanRevision ?? null,
        monthlyPlan: ds?.monthlyPlan ?? null,
        mr: ds?.mr ?? null,
        pr: ds?.pr ?? null,
        workOrder: ds?.workOrder ?? null,
        salesOrder: ds?.salesOrder ?? null,
        quotation: ds?.quotation ?? null,
        grnSummary,
        grnLines: line.grnLines,
        stockPosted,
        purchaseBillLines: line.purchaseBillLines,
        traceChain: buildTraceChainForDemand(
          ds,
          trace.rmPo.id,
          line.grnLines,
          line.stockTransactions,
          line.purchaseBillLines,
        ),
      });
    });
  }
  return rows;
}

function applyRowFilters(rows, filters) {
  return rows.filter((row) => {
    if (filters.sourceType && row.demandSourceType !== filters.sourceType) return false;
    if (filters.rmItemId && row.rmItem?.id !== filters.rmItemId) return false;
    if (filters.mrId && row.mr?.materialRequirementId !== filters.mrId) return false;
    if (filters.prId && row.pr?.purchaseRequestId !== filters.prId) return false;
    if (filters.status && row.receiptStatus !== filters.status) return false;
    return true;
  });
}

async function loadStockAndBillsForPos(db, poRows) {
  const grnLineIds = [];
  const poLineIds = [];
  const poIds = poRows.map((p) => p.id);
  for (const po of poRows) {
    for (const ln of po.lines || []) poLineIds.push(ln.id);
    for (const g of po.grns || []) {
      for (const gl of g.lines || []) grnLineIds.push(gl.id);
    }
  }
  const uniqGrnLineIds = [...new Set(grnLineIds)];
  const uniqPoLineIds = [...new Set(poLineIds)];

  const stockTransactions =
    uniqGrnLineIds.length > 0
      ? await db.stockTransaction.findMany({
          where: { transactionType: "GRN", refId: { in: uniqGrnLineIds } },
          orderBy: [{ date: "asc" }, { id: "asc" }],
        })
      : [];

  const purchaseBillLines = await db.purchaseBillLine.findMany({
    where: {
      OR: [
        ...(uniqGrnLineIds.length ? [{ grnLineId: { in: uniqGrnLineIds } }] : []),
        ...(poIds.length ? [{ rmPoId: { in: poIds } }] : []),
        ...(uniqPoLineIds.length ? [{ rmPoLineId: { in: uniqPoLineIds } }] : []),
      ],
    },
    include: {
      purchaseBill: {
        select: { id: true, billNo: true, status: true, billDate: true },
      },
    },
    orderBy: { id: "asc" },
  });

  return { stockTransactions, purchaseBillLines };
}

function stockAndBillsForPo(poRow, stockTransactions, purchaseBillLines) {
  const grnLineIds = new Set();
  const poLineIds = new Set((poRow.lines || []).map((l) => l.id));
  for (const g of poRow.grns || []) {
    for (const gl of g.lines || []) grnLineIds.add(gl.id);
  }
  const stock = stockTransactions.filter((st) => grnLineIds.has(st.refId));
  const bills = purchaseBillLines.filter(
    (bl) =>
      bl.rmPoId === poRow.id ||
      (bl.rmPoLineId && poLineIds.has(bl.rmPoLineId)) ||
      (bl.grnLineId && grnLineIds.has(bl.grnLineId)),
  );
  return { stock, bills };
}

/**
 * Read-only RM procurement connectivity report.
 * @param {import('@prisma/client').PrismaClient} db
 * @param {object} [query]
 */
async function buildProcurementConnectivityReport(db, query = {}) {
  const filters = parseFilters(query);
  const where = buildPoWhere(filters);

  const poRows = await db.rmPurchaseOrder.findMany({
    where,
    include: RM_PO_INCLUDE,
    orderBy: { id: "desc" },
    take: filters.rmPoId ? 1 : 500,
  });

  const { stockTransactions, purchaseBillLines } = await loadStockAndBillsForPos(db, poRows);

  let rows = [];
  for (const poRow of poRows) {
    const { stock, bills } = stockAndBillsForPo(poRow, stockTransactions, purchaseBillLines);
    const trace = assembleRmPoProcurementTrace(poRow, stock, bills);
    rows.push(...flattenTraceToReportRows(trace));
  }

  rows = applyRowFilters(rows, filters);

  return {
    filters,
    total: rows.length,
    rows,
  };
}

module.exports = {
  BILL_STATUSES,
  BILL_STATUS_LABELS,
  RECEIPT_STATUSES,
  RECEIPT_STATUS_LABELS,
  SOURCE_TYPE_LABELS: SOURCE_CATEGORY_LABELS,
  LEGACY_HISTORICAL_DEMAND,
  applyRowFilters,
  buildGrnSummary,
  buildProcurementConnectivityReport,
  buildStockPostedSummary,
  deriveBillStatus,
  deriveReceiptStatus,
  demandSourceLabel,
  flattenTraceToReportRows,
  parseFilters,
};
