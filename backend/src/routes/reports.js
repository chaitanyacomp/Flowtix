const express = require("express");
const { AuditAction } = require("../prismaClientPackage");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { netDispatchedByItemId, DISPATCH_ALLOC_MODE } = require("../services/salesOrderDispatchAllocation");
const {
  loadNoQtyCycleQcAcceptedMap,
  loadNoQtyDispositionUsableForDispatchPoolMap,
  loadNoQtyPostCycleApprovalMapForInputs,
  computeNoQtyDispatchHeadroom,
  filterNoQtyDispatchRowsForActiveCycle,
  netNoQtyCycleDispatchedByItemId,
} = require("./dispatch");
const {
  aggregateSoOrderedQtyByItemId,
  allocateDispatchFifoAcrossWorkOrderLines,
  deriveWoTrackingOperationalStatus,
  getWoTrackingDispatchPendingQty,
  getWoTrackingProductionPendingQty,
  getWoTrackingQcPendingQty,
  REPORT_QUEUE_EPS,
  METRIC_DEFINITIONS,
  METRIC_CONTEXT,
  computeWorkOrderTrackingSummaryFromRows,
  sumActiveQcAcceptedQty,
  sumActiveQcRejectedQty,
} = require("../services/reportMetrics");
const { buildOperationsExceptionReportPayload } = require("../services/operationsExceptionReport");
const { QC_ENTRY_ACTIVE_WHERE } = require("../services/qcEntryConstants");
const {
  getSoDispatchTraceReport,
  parseDateStart,
  parseDateEnd,
} = require("../services/soDispatchTraceReport");
const { buildCustomerSoRsReport } = require("../services/customerSoRsReportService");
const { buildProductionRmVarianceReport } = require("../services/productionRmVarianceReportService");

const WORK_ORDER_TRACKING_ACCESS_DENIED =
  "Access denied. Only administrators and production staff can view the work order tracking report.";
const OPERATIONS_EXCEPTIONS_ACCESS_DENIED =
  "Access denied. Only administrators can view the operations exceptions report.";

const workOrderTrackingRoles = requireRole(["ADMIN", "PRODUCTION"], WORK_ORDER_TRACKING_ACCESS_DENIED);
const operationsExceptionsRoles = requireRole(["ADMIN"], OPERATIONS_EXCEPTIONS_ACCESS_DENIED);

const SO_DISPATCH_TRACE_ACCESS_DENIED =
  "Access denied. This report is available to admin, sales, store, production, and QC roles.";

const soDispatchTraceRoles = requireRole(
  ["ADMIN", "STORE", "PURCHASE", "PRODUCTION", "QA"],
  SO_DISPATCH_TRACE_ACCESS_DENIED,
);

const STOCK_RECON_ACCESS_DENIED =
  "Access denied. Only administrators, store, and production roles can view the stock reconciliation report.";
const stockReconRoles = requireRole(["ADMIN", "STORE", "PRODUCTION"], STOCK_RECON_ACCESS_DENIED);

const PURCHASE_MATCH_ACCESS_DENIED =
  "Access denied. Only administrators and store roles can view the purchase matching report.";
const purchaseMatchRoles = requireRole(["ADMIN", "PURCHASE"], PURCHASE_MATCH_ACCESS_DENIED);

const SALES_MATCH_ACCESS_DENIED =
  "Access denied. This report is available to admin, sales, store, production, and QC roles.";
const salesMatchRoles = requireRole(["ADMIN", "STORE", "PURCHASE", "PRODUCTION", "QA"], SALES_MATCH_ACCESS_DENIED);

const CUSTOMER_SO_RS_ACCESS_DENIED =
  "Access denied. This report is available to admin, sales, store, production, and QC roles.";
const customerSoRsRoles = requireRole(["ADMIN", "STORE", "PURCHASE", "PRODUCTION", "QA"], CUSTOMER_SO_RS_ACCESS_DENIED);

const BATCH_TRACE_ACCESS_DENIED =
  "Access denied. This report is available to admin, sales, store, production, and QC roles.";
const batchTraceRoles = requireRole(["ADMIN", "STORE", "PURCHASE", "PRODUCTION", "QA"], BATCH_TRACE_ACCESS_DENIED);

const DISPATCH_SUMMARY_ACCESS_DENIED =
  "Access denied. This report is available to admin, sales, and store roles.";
const dispatchSummaryRoles = requireRole(["ADMIN", "STORE", "PURCHASE"], DISPATCH_SUMMARY_ACCESS_DENIED);

const ACTIVITY_LOG_ACCESS_DENIED = "Access denied. Only administrators can view the audit activity log.";
const activityLogRoles = requireRole(["ADMIN"], ACTIVITY_LOG_ACCESS_DENIED);

const PRODUCTION_RM_VARIANCE_ACCESS_DENIED =
  "Access denied. This report is available to admin, store, and production roles.";
const productionRmVarianceRoles = requireRole(
  ["ADMIN", "STORE", "PRODUCTION"],
  PRODUCTION_RM_VARIANCE_ACCESS_DENIED,
);

const reportsRouter = express.Router();

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * GET /api/reports/dispatch-summary
 *
 * Dispatched history + KPI aggregates (LOCKED dispatch rows only).
 * Pending/ready-to-ship is intentionally sourced from GET /api/dispatch/sales-orders on the frontend
 * to guarantee alignment with dispatch operational logic (including NO_QTY cycle rules).
 *
 * Query:
 * - fromDate? (YYYY-MM-DD) — filters Dispatch.date
 * - toDate?   (YYYY-MM-DD) — filters Dispatch.date
 * - customerId? (number)
 * - itemId? (number)
 */
reportsRouter.get("/dispatch-summary", requireAuth, dispatchSummaryRoles, async (req, res, next) => {
  try {
    const fromDate = parseDateStart(req.query.fromDate);
    const toDate = parseDateEnd(req.query.toDate);
    const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const from = fromDate || defaultFrom;
    const to = toDate || new Date();
    if (from.getTime() > to.getTime()) {
      const err = new Error("fromDate cannot be after toDate.");
      err.statusCode = 400;
      throw err;
    }

    const customerIdRaw = req.query.customerId ?? req.query.customer;
    const customerId =
      customerIdRaw != null && String(customerIdRaw).trim() !== "" ? Number(customerIdRaw) : null;
    const itemIdRaw = req.query.itemId ?? req.query.item;
    const itemId = itemIdRaw != null && String(itemIdRaw).trim() !== "" ? Number(itemIdRaw) : null;

    /** @type {import('@prisma/client').Prisma.DispatchWhereInput} */
    const whereBase = {
      workflowStatus: "LOCKED",
      date: { gte: from, lte: to },
    };
    if (itemId != null && Number.isFinite(itemId) && itemId > 0) whereBase.itemId = itemId;
    if (customerId != null && Number.isFinite(customerId) && customerId > 0) {
      whereBase.salesOrder = { customerId };
    }

    const [historyRows, todayAgg, monthAgg] = await Promise.all([
      prisma.dispatch.findMany({
        where: whereBase,
        orderBy: [{ date: "desc" }, { id: "desc" }],
        take: 500,
        include: {
          salesOrder: { include: { customer: true } },
          item: true,
        },
      }),
      prisma.dispatch.aggregate({
        where: { ...whereBase, date: { gte: startOfToday(), lte: new Date() } },
        _sum: { dispatchedQty: true },
      }),
      prisma.dispatch.aggregate({
        where: { ...whereBase, date: { gte: startOfMonth(), lte: new Date() } },
        _sum: { dispatchedQty: true },
      }),
    ]);

    return res.json({
      kpis: {
        dispatchTodayQty: Number(todayAgg._sum.dispatchedQty || 0),
        dispatchMonthQty: Number(monthAgg._sum.dispatchedQty || 0),
      },
      history: historyRows.map((d) => ({
        id: d.id,
        date: d.date,
        soId: d.soId,
        soNo: d.salesOrder?.docNo ?? null,
        customerName: d.salesOrder?.customer?.name ?? null,
        itemId: d.itemId,
        itemName: d.item?.itemName ?? null,
        qty: Number(d.dispatchedQty || 0),
        reversalOfId: d.reversalOfId,
      })),
    });
  } catch (e) {
    return next(e);
  }
});

function normalizeAuditModule(input) {
  const s = String(input || "").trim().toUpperCase();
  if (!s) return null;
  const allowed = new Set(["ADMIN", "PURCHASE", "STOCK", "PRODUCTION", "QA", "STORE", "REPORTS", "SETTINGS", "SESSION", "ADMIN"]);
  return allowed.has(s) ? s : null;
}

function normalizeRefType(input) {
  const s = String(input || "").trim().toUpperCase();
  if (!s) return null;
  // Intentionally human/business-friendly; not tied to prisma enums.
  const allowed = new Set([
    "SO",
    "WO",
    "PRODUCTION",
    "QA",
    "STORE",
    "RM_PO",
    "GRN",
    "PURCHASE_BILL",
    "SALES_BILL",
    "STOCK_ADJUSTMENT",
    "TALLY_EXPORT",
    "EXPORT_HISTORY",
    "SETTINGS",
    "USER_SESSION",
  ]);
  return allowed.has(s) ? s : null;
}

function scalarStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function extractStatusTransition(payload) {
  if (!payload || typeof payload !== "object") return null;
  const p = payload;
  if (p.status && typeof p.status === "object" && p.status) {
    const from = scalarStr(p.status.from);
    const to = scalarStr(p.status.to);
    if (from || to) return { from: from || null, to: to || null };
  }
  // Backward compatible: some rows store changes as { field: { from, to } }
  const ch = p.changes;
  if (ch && typeof ch === "object" && !Array.isArray(ch)) {
    for (const key of ["status", "workflowStatus", "internalStatus", "billingStatus"]) {
      const v = ch[key];
      if (v && typeof v === "object" && v && "from" in v && "to" in v) {
        const from = scalarStr(v.from);
        const to = scalarStr(v.to);
        if (from || to) return { from: from || null, to: to || null };
      }
    }
  }
  return null;
}

function extractRef(payload, row) {
  /** @type {{ refType: string | null, refId: string | null, refNo: string | null }} */
  const out = { refType: null, refId: null, refNo: null };
  if (payload && typeof payload === "object") {
    const p = payload;
    if (p.ref && typeof p.ref === "object" && p.ref) {
      out.refType = normalizeRefType(p.ref.type);
      out.refId = scalarStr(p.ref.id);
      out.refNo = scalarStr(p.ref.no);
      return out;
    }
  }
  // Fallback: use entityType + entityId as least-worst.
  out.refType = row?.entityType ? String(row.entityType) : null;
  out.refId = row?.entityId != null ? String(row.entityId) : null;
  out.refNo = out.refId;
  return out;
}

/**
 * GET /api/reports/purchase-matching
 *
 * RM Purchase → GRN receipt → Purchase Bill matching (audit view).
 *
 * Row grain: one row per RM Purchase Order line (rmPoLineId).
 *
 * Query:
 * - fromDate (YYYY-MM-DD) required (filters RM PO createdAt)
 * - toDate (YYYY-MM-DD) required (filters RM PO createdAt)
 * - supplierId? (number)
 * - itemId? (number)
 * - status? (string)
 * - mismatchesOnly? (true|false)
 */
reportsRouter.get("/purchase-matching", requireAuth, purchaseMatchRoles, async (req, res, next) => {
  try {
    const fromDate = parseDateStart(req.query.fromDate);
    const toDate = parseDateEnd(req.query.toDate);
    if (!fromDate || !toDate) {
      const err = new Error("fromDate and toDate are required (YYYY-MM-DD).");
      err.statusCode = 400;
      throw err;
    }
    if (fromDate.getTime() > toDate.getTime()) {
      const err = new Error("fromDate cannot be after toDate.");
      err.statusCode = 400;
      throw err;
    }

    const supplierIdRaw = req.query.supplierId ?? req.query.supplier;
    const supplierId =
      supplierIdRaw != null && String(supplierIdRaw).trim() !== "" ? Number(supplierIdRaw) : null;

    const itemIdRaw = req.query.itemId ?? req.query.item;
    const itemId = itemIdRaw != null && String(itemIdRaw).trim() !== "" ? Number(itemIdRaw) : null;

    const statusFilter = String(req.query.status || "ALL").trim();
    const mismatchesOnly = String(req.query.mismatchesOnly || "").toLowerCase() === "true";

    /** @type {import('@prisma/client').Prisma.RmPurchaseOrderWhereInput} */
    const where = {
      createdAt: { gte: fromDate, lte: toDate },
    };
    if (supplierId != null && Number.isFinite(supplierId) && supplierId > 0) where.supplierId = supplierId;
    if (itemId != null && Number.isFinite(itemId) && itemId > 0) where.lines = { some: { itemId } };

    const rmPos = await prisma.rmPurchaseOrder.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        supplier: true,
        lines: { include: { item: true }, orderBy: { id: "asc" } },
        grns: {
          orderBy: [{ date: "desc" }, { id: "desc" }],
          include: {
            lines: true,
            purchaseBill: { include: { lines: true } },
          },
        },
      },
    });

    const EPS = 1e-6;

    // Precompute GRN receipts per rmPoLineId and latest GRN per line.
    /** @type {Map<number, number>} */
    const receivedByLineId = new Map();
    /** @type {Map<number, { grnId: number, grnDate: Date }>} */
    const latestGrnByLineId = new Map();

    // Precompute billed qty per (grnId,itemId) from FINALIZED bill only.
    /** @type {Map<string, number>} */
    const billedByGrnItemKey = new Map();
    /** @type {Map<number, { billId: number, billNo: string | null, status: string, billDate: Date }>} */
    const billMetaByGrnId = new Map();

    for (const po of rmPos) {
      for (const g of po.grns) {
        if (g.reversedAt) continue;

        // Latest GRN per line
        for (const gl of g.lines) {
          const lid = gl.rmPoLineId;
          const prev = latestGrnByLineId.get(lid);
          if (!prev || g.date > prev.grnDate || (g.date.getTime() === prev.grnDate.getTime() && g.id > prev.grnId)) {
            latestGrnByLineId.set(lid, { grnId: g.id, grnDate: g.date });
          }
          const cur = receivedByLineId.get(lid) || 0;
          receivedByLineId.set(lid, cur + Number(gl.receivedQty || 0));
        }

        const pb = g.purchaseBill;
        if (pb) {
          billMetaByGrnId.set(g.id, {
            billId: pb.id,
            billNo: pb.billNo ?? null,
            status: pb.status,
            billDate: pb.billDate,
          });
        }

        if (pb && pb.status === "FINALIZED") {
          for (const ln of pb.lines || []) {
            const key = `${g.id}-${ln.itemId}`;
            const cur = billedByGrnItemKey.get(key) || 0;
            billedByGrnItemKey.set(key, cur + Number(ln.qty || 0));
          }
        }
      }
    }

    // Allocate billed qty (per GRN+item) to RM PO lines deterministically by receipt share
    // within that GRN for that itemId (handles duplicate item across lines).
    /** @type {Map<number, number>} */
    const billedByLineId = new Map();

    for (const po of rmPos) {
      for (const g of po.grns) {
        if (g.reversedAt) continue;

        /** @type {Map<number, Array<{ rmPoLineId: number, receivedQty: number }>>} */
        const receiptsByItemId = new Map();
        for (const gl of g.lines) {
          const line = po.lines.find((l) => l.id === gl.rmPoLineId);
          const itId = line ? line.itemId : null;
          if (!itId) continue;
          if (!receiptsByItemId.has(itId)) receiptsByItemId.set(itId, []);
          receiptsByItemId.get(itId).push({ rmPoLineId: gl.rmPoLineId, receivedQty: Number(gl.receivedQty || 0) });
        }

        for (const [itId, parts] of receiptsByItemId.entries()) {
          const billedKey = `${g.id}-${itId}`;
          const billedTotal = billedByGrnItemKey.get(billedKey) || 0;
          if (billedTotal <= EPS) continue;
          const receivedTotal = parts.reduce((s, p) => s + (Number(p.receivedQty) || 0), 0);
          if (receivedTotal <= EPS) continue;

          // Proportional allocation by receipt share; last line gets rounding remainder to keep sum exact.
          let allocated = 0;
          for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            const share = (Number(p.receivedQty) || 0) / receivedTotal;
            const raw = i === parts.length - 1 ? billedTotal - allocated : billedTotal * share;
            const qty = Number.isFinite(raw) ? raw : 0;
            allocated += qty;
            const cur = billedByLineId.get(p.rmPoLineId) || 0;
            billedByLineId.set(p.rmPoLineId, cur + qty);
          }
        }
      }
    }

    function statusForRow({ orderedQty, receivedQty, billedQty, poStatus }) {
      const pendingReceipt = Math.max(0, orderedQty - receivedQty);
      const excessReceipt = Math.max(0, receivedQty - orderedQty);
      const pendingBill = Math.max(0, receivedQty - billedQty);
      const excessBill = Math.max(0, billedQty - receivedQty);

      const anyMismatch = excessReceipt > EPS || excessBill > EPS;
      if (anyMismatch) return "Mismatch";

      if (receivedQty <= EPS) return "Pending Receipt";
      if (pendingReceipt > EPS) return "Partly Received";
      if (pendingBill > EPS) return "Pending Billing";
      if (pendingReceipt <= EPS && pendingBill <= EPS) {
        if (poStatus === "COMPLETED") return "Closed";
        return "Fully Billed";
      }
      return "Pending Receipt";
    }

    const rows = [];
    for (const po of rmPos) {
      for (const ln of po.lines) {
        if (itemId != null && Number.isFinite(itemId) && itemId > 0 && ln.itemId !== itemId) continue;

        const orderedQty = Number(ln.qty || 0);
        const receivedQty = Number(receivedByLineId.get(ln.id) || 0);
        const billedQty = Number(billedByLineId.get(ln.id) || 0);

        const pendingReceiptQty = Math.max(0, orderedQty - receivedQty);
        const excessReceiptQty = Math.max(0, receivedQty - orderedQty);

        const pendingBillQty = Math.max(0, receivedQty - billedQty);
        const excessBillQty = Math.max(0, billedQty - receivedQty);

        const latestGrn = latestGrnByLineId.get(ln.id) || null;
        const latestGrnId = latestGrn ? latestGrn.grnId : null;
        const latestBill = latestGrnId ? billMetaByGrnId.get(latestGrnId) || null : null;

        const status = statusForRow({ orderedQty, receivedQty, billedQty, poStatus: po.status });
        const mismatch = excessReceiptQty > EPS || excessBillQty > EPS;
        if (mismatchesOnly && !mismatch) continue;
        if (statusFilter && statusFilter !== "ALL" && status !== statusFilter) continue;

        rows.push({
          rmPoId: po.id,
          purchaseRef: `RMPO-${po.id}`,
          purchaseDate: po.createdAt,
          supplierId: po.supplierId,
          supplierName: po.supplier?.name ?? "",
          itemId: ln.itemId,
          itemName: ln.item?.itemName ?? "",
          unit: ln.item?.unitRef?.unitName ?? ln.item?.unit ?? "",
          orderedQty,
          receivedQty,
          billedQty,
          pendingReceiptQty,
          pendingBillQty,
          excessReceiptQty,
          excessBillQty,
          latestGrnId,
          latestGrnDate: latestGrn ? latestGrn.grnDate : null,
          latestPurchaseBillId: latestBill ? latestBill.billId : null,
          latestPurchaseBillNo: latestBill ? latestBill.billNo : null,
          latestPurchaseBillStatus: latestBill ? latestBill.status : null,
          status,
        });
      }
    }

    rows.sort((a, b) => {
      const ad = new Date(a.purchaseDate).getTime();
      const bd = new Date(b.purchaseDate).getTime();
      if (bd !== ad) return bd - ad;
      if (a.rmPoId !== b.rmPoId) return b.rmPoId - a.rmPoId;
      return String(a.itemName).localeCompare(String(b.itemName), undefined, { sensitivity: "base" });
    });

    const summary = rows.reduce(
      (s, r) => {
        s.totalRows += 1;
        if (r.status === "Mismatch") s.mismatchRows += 1;
        s.totalOrderedQty += Number(r.orderedQty || 0);
        s.totalReceivedQty += Number(r.receivedQty || 0);
        s.totalBilledQty += Number(r.billedQty || 0);
        return s;
      },
      { totalRows: 0, mismatchRows: 0, totalOrderedQty: 0, totalReceivedQty: 0, totalBilledQty: 0 },
    );

    return res.json({
      meta: {
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
        supplierId: supplierId ?? null,
        itemId: itemId ?? null,
        status: statusFilter || "ALL",
        mismatchesOnly,
      },
      summary,
      rows,
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * GET /api/reports/sales-matching
 *
 * Sales Order → Dispatch → Sales Bill matching (audit view).
 *
 * Row grain: one row per Sales Order + Item (SO dispatch is stored at SO+item granularity).
 *
 * Query:
 * - fromDate (YYYY-MM-DD) required (filters SalesOrder.createdAt)
 * - toDate (YYYY-MM-DD) required (filters SalesOrder.createdAt)
 * - customerId? (number)
 * - itemId? (number)
 * - soType? (NORMAL|NO_QTY)
 * - status? (string)
 * - mismatchesOnly? (true|false)
 */
reportsRouter.get("/sales-matching", requireAuth, salesMatchRoles, async (req, res, next) => {
  try {
    const fromDate = parseDateStart(req.query.fromDate);
    const toDate = parseDateEnd(req.query.toDate);
    if (!fromDate || !toDate) {
      const err = new Error("fromDate and toDate are required (YYYY-MM-DD).");
      err.statusCode = 400;
      throw err;
    }
    if (fromDate.getTime() > toDate.getTime()) {
      const err = new Error("fromDate cannot be after toDate.");
      err.statusCode = 400;
      throw err;
    }

    const customerIdRaw = req.query.customerId ?? req.query.customer;
    const customerId =
      customerIdRaw != null && String(customerIdRaw).trim() !== "" ? Number(customerIdRaw) : null;

    const itemIdRaw = req.query.itemId ?? req.query.item;
    const itemId = itemIdRaw != null && String(itemIdRaw).trim() !== "" ? Number(itemIdRaw) : null;

    const soTypeRaw = req.query.soType != null ? String(req.query.soType).trim().toUpperCase() : "";
    const soType = soTypeRaw === "NO_QTY" ? "NO_QTY" : soTypeRaw === "NORMAL" ? "NORMAL" : null;

    const statusFilter = String(req.query.status || "ALL").trim();
    const mismatchesOnly = String(req.query.mismatchesOnly || "").toLowerCase() === "true";

    /** @type {import('@prisma/client').Prisma.SalesOrderWhereInput} */
    const where = {
      createdAt: { gte: fromDate, lte: toDate },
    };
    if (customerId != null && Number.isFinite(customerId) && customerId > 0) where.customerId = customerId;
    if (soType) where.orderType = soType;
    if (itemId != null && Number.isFinite(itemId) && itemId > 0) where.lines = { some: { itemId } };

    const salesOrders = await prisma.salesOrder.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        customer: true,
        po: { include: { customer: true } },
        lines: { include: { item: { include: { unitRef: { select: { id: true, unitName: true } } } } }, orderBy: { id: "asc" } },
        dispatch: true,
        currentCycle: true,
      },
    });

    const EPS = 1e-6;

    /** NO_QTY: per-cycle QC pool + same-cycle operational dispatch (aligned with dashboard / dispatch list). */
    const noQtyOrdersAll = salesOrders.filter((so) => so.orderType === "NO_QTY");
    const noQtySoIds = noQtyOrdersAll.map((so) => so.id);
    const allNoQtyCyclesRows =
      noQtySoIds.length > 0
        ? await prisma.salesOrderCycle.findMany({
            where: { salesOrderId: { in: noQtySoIds } },
            select: { id: true, salesOrderId: true, cycleNo: true },
            orderBy: [{ salesOrderId: "asc" }, { cycleNo: "asc" }],
          })
        : [];
    /** @type {Map<number, { id: number; cycleNo: number }[]>} */
    const noQtyAllCyclesBySoId = new Map();
    for (const r of allNoQtyCyclesRows) {
      const arr = noQtyAllCyclesBySoId.get(r.salesOrderId) ?? [];
      arr.push({ id: r.id, cycleNo: Number(r.cycleNo) });
      noQtyAllCyclesBySoId.set(r.salesOrderId, arr);
    }
    const noQtyCycleInputsForMaps = allNoQtyCyclesRows.map((r) => ({ id: r.salesOrderId, currentCycleId: r.id }));
    let noQtyQcMapRep = new Map();
    let noQtyRecheckMapRep = new Map();
    let noQtyPostMapRep = new Map();
    if (noQtyCycleInputsForMaps.length) {
      const trip = await Promise.all([
        loadNoQtyCycleQcAcceptedMap(prisma, noQtyCycleInputsForMaps),
        loadNoQtyDispositionUsableForDispatchPoolMap(prisma, noQtyCycleInputsForMaps),
        loadNoQtyPostCycleApprovalMapForInputs(prisma, noQtyCycleInputsForMaps),
      ]);
      noQtyQcMapRep = trip[0];
      noQtyRecheckMapRep = trip[1];
      noQtyPostMapRep = trip[2];
    }

    function collectNoQtyItemIdsFromMaps(soIdL) {
      const cycles = noQtyAllCyclesBySoId.get(soIdL) || [];
      const out = new Set();
      const maps = [noQtyQcMapRep, noQtyRecheckMapRep, noQtyPostMapRep];
      for (const cy of cycles) {
        const pref = `${soIdL}:${cy.id}:`;
        for (const m of maps) {
          for (const k of m.keys()) {
            if (!String(k).startsWith(pref)) continue;
            const parts = String(k).split(":");
            const iid = Number(parts[2]);
            if (Number.isFinite(iid) && iid > 0) out.add(iid);
          }
        }
      }
      return out;
    }

    function computeNoQtyMatchingMetrics(soIdL, itIdL, dispatchRecords) {
      const cycles = noQtyAllCyclesBySoId.get(soIdL) || [];
      let pendingSum = 0;
      let dispatchedOpSum = 0;
      let grossSum = 0;
      for (const cy of cycles) {
        const qcKey = `${soIdL}:${cy.id}:${itIdL}`;
        const qc = Number(noQtyQcMapRep.get(qcKey) ?? 0);
        const recheck = Number(noQtyRecheckMapRep.get(qcKey) ?? 0);
        const post = Number(noQtyPostMapRep.get(qcKey) ?? 0);
        grossSum += qc + recheck + post;
        const recs = filterNoQtyDispatchRowsForActiveCycle(dispatchRecords, cy.id);
        const net = Number(netNoQtyCycleDispatchedByItemId(recs, DISPATCH_ALLOC_MODE.OPERATIONAL).get(itIdL) ?? 0);
        dispatchedOpSum += net;
        pendingSum += computeNoQtyDispatchHeadroom({
          alreadyOpNet: net,
          qcAcceptedThisCycle: qc,
          recheckAcceptedThisCycle: recheck,
          postCycleApprovalQty: post,
        });
      }
      return { pendingSum, dispatchedOpSum, grossSum };
    }

    // Preload finalized sales bills for relevant dispatches; sum invoiced by (soId,itemId) via bill lines.
    const allDispatchIds = salesOrders.flatMap((so) => (so.dispatch || []).map((d) => d.id));
    const finalizedBills = allDispatchIds.length
      ? await prisma.salesBill.findMany({
          where: { dispatchId: { in: allDispatchIds }, status: "FINALIZED" },
          include: { dispatch: true, lines: true },
          orderBy: [{ billDate: "desc" }, { id: "desc" }],
        })
      : [];

    /** @type {Map<string, number>} */
    const invoicedBySoItemKey = new Map();
    /** @type {Map<string, { billId: number, billNo: string | null, billDate: Date }>} */
    const latestBillBySoItemKey = new Map();

    for (const b of finalizedBills) {
      const soId = b.dispatch?.soId ?? null;
      if (!soId) continue;
      for (const ln of b.lines || []) {
        const key = `${soId}-${ln.itemId}`;
        const cur = invoicedBySoItemKey.get(key) || 0;
        invoicedBySoItemKey.set(key, cur + Number(ln.qty || 0));
        if (!latestBillBySoItemKey.has(key)) {
          latestBillBySoItemKey.set(key, { billId: b.id, billNo: b.billNo ?? null, billDate: b.billDate });
        }
      }
    }

    /** @type {Map<string, { dispatchId: number, date: Date }>} */
    const latestDispatchBySoItemKey = new Map();

    for (const so of salesOrders) {
      for (const d of so.dispatch || []) {
        if (d.reversalOfId != null) continue;
        if (d.workflowStatus !== "LOCKED") continue;
        const key = `${so.id}-${d.itemId}`;
        const prev = latestDispatchBySoItemKey.get(key);
        if (!prev || d.date > prev.date || (d.date.getTime() === prev.date.getTime() && d.id > prev.dispatchId)) {
          latestDispatchBySoItemKey.set(key, { dispatchId: d.id, date: d.date });
        }
      }
    }

    function customerNameForSo(so) {
      const direct = so.customer?.name?.trim();
      if (direct) return direct;
      const fromPo = so.po?.customer?.name?.trim();
      if (fromPo) return fromPo;
      return "Unknown Customer";
    }

    function statusForRow({
      operationalQty,
      dispatchedQty,
      invoicedQty,
      soInternalStatus,
      soOrderType,
      hasDispatchBasis,
      pendingDispatchOverride,
    }) {
      const pendingDispatchQty =
        pendingDispatchOverride != null
          ? pendingDispatchOverride
          : operationalQty != null
            ? Math.max(0, operationalQty - dispatchedQty)
            : null;
      const excessDispatchQty = operationalQty != null ? Math.max(0, dispatchedQty - operationalQty) : 0;
      const pendingInvoiceQty = Math.max(0, dispatchedQty - invoicedQty);
      const excessInvoiceQty = Math.max(0, invoicedQty - dispatchedQty);

      const mismatch =
        (operationalQty != null && excessDispatchQty > EPS) || excessInvoiceQty > EPS;
      if (mismatch) return "Mismatch";

      if (soInternalStatus === "COMPLETED") return "Closed";

      if (soOrderType === "NO_QTY" && !hasDispatchBasis) return "Open";

      if (dispatchedQty <= EPS) return "Open";
      if (pendingDispatchQty != null && pendingDispatchQty > EPS) return "Partly Dispatched";
      if (pendingInvoiceQty > EPS) return "Pending Billing";
      if (pendingInvoiceQty <= EPS) return "Fully Billed";
      return "Open";
    }

    const rows = [];
    for (const so of salesOrders) {
      const soId = so.id;
      const orderType = so.orderType;

      /** @type {Map<number, { itemName: string, unit: string, plannedQty: number, customerPoQty: number, bufferPercent: number }>} */
      const soItemAgg = new Map();
      for (const ln of so.lines || []) {
        if (itemId != null && Number.isFinite(itemId) && itemId > 0 && ln.itemId !== itemId) continue;
        const cur = soItemAgg.get(ln.itemId) || {
          itemName: ln.item?.itemName ?? "",
          unit: ln.item?.unitRef?.unitName ?? ln.item?.unit ?? "",
          plannedQty: 0,
          customerPoQty: 0,
          bufferPercent: 0,
        };
        const planned = Number(ln.qty || 0);
        const cust = orderType === "NORMAL" ? Number(ln.customerPoQty ?? ln.qty) : planned;
        cur.plannedQty += planned;
        cur.customerPoQty += cust;
        if (orderType === "NORMAL") {
          cur.bufferPercent = Number(ln.bufferPercent ?? 0);
        }
        soItemAgg.set(ln.itemId, cur);
      }

      if (orderType === "NO_QTY") {
        for (const ii of collectNoQtyItemIdsFromMaps(soId)) {
          if (itemId != null && Number.isFinite(itemId) && itemId > 0 && Number(ii) !== Number(itemId)) continue;
          if (soItemAgg.has(ii)) continue;
          soItemAgg.set(ii, {
            itemName: `Item #${ii}`,
            unit: "",
            plannedQty: 0,
            customerPoQty: 0,
            bufferPercent: 0,
          });
        }
        const lineItemIdSet = new Set((so.lines || []).map((l) => l.itemId));
        const needNames = [...soItemAgg.keys()].filter((id) => !lineItemIdSet.has(id));
        if (needNames.length) {
          const items = await prisma.item.findMany({
            where: { id: { in: needNames } },
            include: { unitRef: { select: { id: true, unitName: true } } },
          });
          for (const it of items) {
            const cur = soItemAgg.get(it.id);
            if (!cur) continue;
            soItemAgg.set(it.id, {
              ...cur,
              itemName: it.itemName ?? cur.itemName,
              unit: it.unitRef?.unitName ?? it.unit ?? cur.unit,
            });
          }
        }
      }

      const dispatchRecords = so.dispatch || [];
      const netDispatchedConfirmed = netDispatchedByItemId(dispatchRecords, DISPATCH_ALLOC_MODE.CONFIRMED);

      for (const [itId, meta] of soItemAgg.entries()) {
        const key = `${soId}-${itId}`;
        let dispatchedQty;
        let operationalQty;
        let pendingDispatchQty;
        let excessDispatchQty;
        let hasDispatchBasis;

        if (orderType === "NO_QTY") {
          const m = computeNoQtyMatchingMetrics(soId, itId, dispatchRecords);
          operationalQty = m.grossSum;
          dispatchedQty = m.dispatchedOpSum;
          pendingDispatchQty = m.pendingSum;
          excessDispatchQty = Math.max(0, dispatchedQty - operationalQty);
          hasDispatchBasis = m.grossSum > EPS || m.dispatchedOpSum > EPS || m.pendingSum > EPS;
        } else {
          dispatchedQty = Number(netDispatchedConfirmed.get(itId) ?? 0);
          operationalQty =
            orderType === "NORMAL" ? meta.customerPoQty : meta.plannedQty;
          pendingDispatchQty = operationalQty != null ? Math.max(0, operationalQty - dispatchedQty) : null;
          excessDispatchQty = operationalQty != null ? Math.max(0, dispatchedQty - operationalQty) : null;
          hasDispatchBasis = true;
        }

        const invoicedQty = Number(invoicedBySoItemKey.get(key) ?? 0);

        const status = statusForRow({
          operationalQty,
          dispatchedQty,
          invoicedQty,
          soInternalStatus: so.internalStatus,
          soOrderType: orderType,
          hasDispatchBasis,
          pendingDispatchOverride: orderType === "NO_QTY" ? pendingDispatchQty : null,
        });

        const pendingInvoiceQty = Math.max(0, dispatchedQty - invoicedQty);
        const excessInvoiceQty = Math.max(0, invoicedQty - dispatchedQty);

        const mismatch =
          (operationalQty != null && excessDispatchQty != null && excessDispatchQty > EPS) ||
          (excessInvoiceQty > EPS);
        if (mismatchesOnly && !mismatch) continue;
        if (statusFilter && statusFilter !== "ALL" && status !== statusFilter) continue;

        const latestDispatch = latestDispatchBySoItemKey.get(key) || null;
        const latestBill = latestBillBySoItemKey.get(key) || null;

        rows.push({
          soId,
          salesOrderNo: `SO-${soId}`,
          salesOrderDate: so.createdAt,
          customerName: customerNameForSo(so),
          itemId: itId,
          itemName: meta.itemName,
          unit: meta.unit,
          soType: orderType,
          orderedQty: orderType === "NO_QTY" ? null : orderType === "NORMAL" ? meta.customerPoQty : meta.plannedQty,
          plannedQty: orderType === "NORMAL" ? meta.plannedQty : null,
          customerPoQty: orderType === "NORMAL" ? meta.customerPoQty : null,
          bufferPercent: orderType === "NORMAL" ? meta.bufferPercent : null,
          operationalQty,
          dispatchedQty,
          invoicedQty,
          pendingDispatchQty,
          pendingInvoiceQty,
          excessDispatchQty: excessDispatchQty ?? null,
          excessInvoiceQty,
          latestDispatchId: latestDispatch ? latestDispatch.dispatchId : null,
          latestDispatchDate: latestDispatch ? latestDispatch.date : null,
          latestSalesBillId: latestBill ? latestBill.billId : null,
          latestSalesBillNo: latestBill ? latestBill.billNo : null,
          latestSalesBillDate: latestBill ? latestBill.billDate : null,
          status,
        });
      }
    }

    rows.sort((a, b) => {
      const ad = new Date(a.salesOrderDate).getTime();
      const bd = new Date(b.salesOrderDate).getTime();
      if (bd !== ad) return bd - ad;
      if (a.soId !== b.soId) return b.soId - a.soId;
      return String(a.itemName).localeCompare(String(b.itemName), undefined, { sensitivity: "base" });
    });

    const summary = rows.reduce(
      (s, r) => {
        s.totalRows += 1;
        if (r.status === "Mismatch") s.mismatchRows += 1;
        s.totalOperationalQty += Number(r.operationalQty ?? 0);
        s.totalDispatchedQty += Number(r.dispatchedQty ?? 0);
        s.totalInvoicedQty += Number(r.invoicedQty ?? 0);
        return s;
      },
      { totalRows: 0, mismatchRows: 0, totalOperationalQty: 0, totalDispatchedQty: 0, totalInvoicedQty: 0 },
    );

    return res.json({
      meta: {
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
        customerId: customerId ?? null,
        itemId: itemId ?? null,
        soType: soType ?? null,
        status: statusFilter || "ALL",
        mismatchesOnly,
      },
      summary,
      rows,
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * GET /api/reports/batch-traceability
 *
 * Production batch traceability report (ISO-style).
 *
 * Supported traceability level (current model):
 * - Strong: ProductionEntry (batch) → QC entries (per batch) → WorkOrderLine → WorkOrder → SalesOrder → Customer
 * - Limited: Dispatch/Billing are stored per (SalesOrder, Item). There is no persistent per-batch shipment allocation.
 *   Therefore dispatch + sales bill fields are shown as a summary for that SO+FG, not batch-specific.
 *
 * Query:
 * - fromDate (YYYY-MM-DD) required (filters ProductionEntry.date)
 * - toDate (YYYY-MM-DD) required (filters ProductionEntry.date)
 * - productionId? (number)
 * - fgItemId? (number)
 * - customerId? (number)
 * - salesOrderId? (number)
 * - dispatchId? (number) backward-trace helper: constrains to the dispatch's SO+item
 * - qcStatus? (PENDING_QC|PARTIAL_QC|COMPLETED_QC|ALL)
 */
reportsRouter.get("/batch-traceability", requireAuth, batchTraceRoles, async (req, res, next) => {
  try {
    const fromDate = parseDateStart(req.query.fromDate);
    const toDate = parseDateEnd(req.query.toDate);
    if (!fromDate || !toDate) {
      const err = new Error("fromDate and toDate are required (YYYY-MM-DD).");
      err.statusCode = 400;
      throw err;
    }
    if (fromDate.getTime() > toDate.getTime()) {
      const err = new Error("fromDate cannot be after toDate.");
      err.statusCode = 400;
      throw err;
    }

    const productionIdRaw = req.query.productionId ?? req.query.productionBatch ?? req.query.batch;
    const productionId =
      productionIdRaw != null && String(productionIdRaw).trim() !== "" ? Number(productionIdRaw) : null;

    const fgItemIdRaw = req.query.fgItemId ?? req.query.itemId ?? req.query.item;
    const fgItemId = fgItemIdRaw != null && String(fgItemIdRaw).trim() !== "" ? Number(fgItemIdRaw) : null;

    const customerIdRaw = req.query.customerId ?? req.query.customer;
    const customerId =
      customerIdRaw != null && String(customerIdRaw).trim() !== "" ? Number(customerIdRaw) : null;

    const salesOrderIdRaw = req.query.salesOrderId ?? req.query.soId ?? req.query.so;
    const salesOrderId =
      salesOrderIdRaw != null && String(salesOrderIdRaw).trim() !== "" ? Number(salesOrderIdRaw) : null;

    const dispatchIdRaw = req.query.dispatchId ?? req.query.dispatch;
    const dispatchId =
      dispatchIdRaw != null && String(dispatchIdRaw).trim() !== "" ? Number(dispatchIdRaw) : null;

    const qcStatusRaw = String(req.query.qcStatus || "ALL").trim().toUpperCase();
    const qcStatus = ["ALL", "PENDING_QC", "PARTIAL_QC", "COMPLETED_QC"].includes(qcStatusRaw) ? qcStatusRaw : "ALL";

    // Backward-trace helper: resolve dispatch → (soId,itemId)
    let dispatchConstraint = null;
    if (dispatchId != null && Number.isFinite(dispatchId) && dispatchId > 0) {
      const d = await prisma.dispatch.findUnique({ where: { id: dispatchId }, select: { id: true, soId: true, itemId: true } });
      if (!d) {
        const err = new Error("Dispatch not found");
        err.statusCode = 404;
        throw err;
      }
      dispatchConstraint = { soId: d.soId, itemId: d.itemId };
    }

    /** @type {import('@prisma/client').Prisma.ProductionEntryWhereInput} */
    const where = {
      date: { gte: fromDate, lte: toDate },
    };
    if (productionId != null && Number.isFinite(productionId) && productionId > 0) where.id = productionId;

    /** @type {import('@prisma/client').Prisma.WorkOrderLineWhereInput} */
    const wolWhere = {};
    /** @type {import('@prisma/client').Prisma.WorkOrderWhereInput} */
    const woWhere = {};
    /** @type {import('@prisma/client').Prisma.SalesOrderWhereInput} */
    const soWhere = {};

    if (fgItemId != null && Number.isFinite(fgItemId) && fgItemId > 0) wolWhere.fgItemId = fgItemId;
    if (dispatchConstraint) wolWhere.fgItemId = dispatchConstraint.itemId;

    if (salesOrderId != null && Number.isFinite(salesOrderId) && salesOrderId > 0) woWhere.salesOrderId = salesOrderId;
    if (dispatchConstraint) woWhere.salesOrderId = dispatchConstraint.soId;

    if (customerId != null && Number.isFinite(customerId) && customerId > 0) soWhere.customerId = customerId;

    const hasSoWhere = Object.keys(soWhere).length > 0;
    const hasWoWhere = Object.keys(woWhere).length > 0 || hasSoWhere;
    const hasWolWhere = Object.keys(wolWhere).length > 0 || hasWoWhere;

    if (hasWolWhere) {
      where.workOrderLine = { ...wolWhere };
      if (hasWoWhere) {
        where.workOrderLine.workOrder = { ...woWhere };
        if (hasSoWhere) where.workOrderLine.workOrder.salesOrder = { ...soWhere };
      }
    }

    const batches = await prisma.productionEntry.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      include: {
        qcEntries: { where: QC_ENTRY_ACTIVE_WHERE },
        workOrderLine: {
          include: {
            fgItem: { include: { unitRef: { select: { id: true, unitName: true } } } },
            workOrder: {
              include: {
                salesOrder: {
                  include: {
                    customer: true,
                    po: { include: { customer: true } },
                    dispatch: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Load finalized sales bills for dispatches referenced by the above sales orders.
    const dispatchIds = Array.from(
      new Set(
        batches.flatMap((b) => (b.workOrderLine?.workOrder?.salesOrder?.dispatch || []).map((d) => d.id)),
      ),
    );
    const finalizedBills = dispatchIds.length
      ? await prisma.salesBill.findMany({
          where: { dispatchId: { in: dispatchIds }, status: "FINALIZED" },
          include: { dispatch: true, lines: true },
          orderBy: [{ billDate: "desc" }, { id: "desc" }],
        })
      : [];

    /** @type {Map<string, { billId: number, billNo: string | null, billDate: Date }>} */
    const latestBillBySoItemKey = new Map();
    for (const b of finalizedBills) {
      const soId = b.dispatch?.soId ?? null;
      if (!soId) continue;
      for (const ln of b.lines || []) {
        const key = `${soId}-${ln.itemId}`;
        if (!latestBillBySoItemKey.has(key)) {
          latestBillBySoItemKey.set(key, { billId: b.id, billNo: b.billNo ?? null, billDate: b.billDate });
        }
      }
    }

    function customerNameForSo(so) {
      const direct = so.customer?.name?.trim();
      if (direct) return direct;
      const fromPo = so.po?.customer?.name?.trim();
      if (fromPo) return fromPo;
      return "Unknown Customer";
    }

    function qcStatusForBatch({ producedQty, qcEntries }) {
      const acc = sumActiveQcAcceptedQty(qcEntries);
      const rej = sumActiveQcRejectedQty(qcEntries);
      const processed = acc + rej;
      if ((qcEntries || []).length === 0) return "PENDING_QC";
      if (processed + 1e-6 < Number(producedQty)) return "PARTIAL_QC";
      return "COMPLETED_QC";
    }

    /** @type {Map<string, { dispatchId: number, date: Date }>} */
    const latestDispatchBySoItemKey = new Map();
    for (const b of batches) {
      const so = b.workOrderLine?.workOrder?.salesOrder;
      if (!so) continue;
      const itemId = b.workOrderLine?.fgItemId;
      if (!itemId) continue;
      const key = `${so.id}-${itemId}`;
      for (const d of so.dispatch || []) {
        if (d.itemId !== itemId) continue;
        if (d.reversalOfId != null) continue;
        if (d.workflowStatus !== "LOCKED") continue;
        const prev = latestDispatchBySoItemKey.get(key);
        if (!prev || d.date > prev.date || (d.date.getTime() === prev.date.getTime() && d.id > prev.dispatchId)) {
          latestDispatchBySoItemKey.set(key, { dispatchId: d.id, date: d.date });
        }
      }
    }

    const rows = [];
    for (const b of batches) {
      const wol = b.workOrderLine;
      const wo = wol?.workOrder;
      const so = wo?.salesOrder;
      if (!wol || !wo || !so) continue;

      const fg = wol.fgItem;
      const soId = so.id;
      const itemId = wol.fgItemId;

      const qcEntries = b.qcEntries || [];
      const acceptedQty = sumActiveQcAcceptedQty(qcEntries);
      const rejectedQty = sumActiveQcRejectedQty(qcEntries);
      const qcStatusLabel = qcStatusForBatch({ producedQty: b.producedQty, qcEntries });
      if (qcStatus !== "ALL" && qcStatusLabel !== qcStatus) continue;

      const reworkQtyApprox = qcEntries
        .filter((q) => q.rejectedStockBucket === "REWORK")
        .reduce((s, q) => s + Number(q.rejectedQty || 0), 0);

      const key = `${soId}-${itemId}`;
      const latestDispatch = latestDispatchBySoItemKey.get(key) || null;
      const latestBill = latestBillBySoItemKey.get(key) || null;

      rows.push({
        productionId: b.id,
        productionRef: `PROD-${b.id}`,
        productionDate: b.date,
        workOrderId: wo.id,
        workOrderNo: `WO-${wo.id}`,
        salesOrderId: soId,
        salesOrderNo: `SO-${soId}`,
        customerName: customerNameForSo(so),
        fgItemId: itemId,
        fgItemName: fg?.itemName ?? "",
        unit: fg?.unitRef?.unitName ?? fg?.unit ?? "",
        producedQty: Number(b.producedQty || 0),
        acceptedQty,
        rejectedQty,
        reworkQtyApprox,
        qcStatus: qcStatusLabel,
        qcRefs: qcEntries.map((q) => ({ qcId: q.id, qcRef: `QC-${q.id}`, date: q.date })),
        dispatchRef: latestDispatch ? `DSP-${String(latestDispatch.dispatchId).padStart(6, "0")}` : null,
        dispatchId: latestDispatch ? latestDispatch.dispatchId : null,
        dispatchDate: latestDispatch ? latestDispatch.date : null,
        salesBillId: latestBill ? latestBill.billId : null,
        salesBillRef: latestBill ? (latestBill.billNo || `SB-${latestBill.billId}`) : null,
        salesBillDate: latestBill ? latestBill.billDate : null,
        traceabilityNote:
          "Dispatch/Sales Bill linkage is available only at SalesOrder+Item level (not per batch).",
      });
    }

    const summary = rows.reduce(
      (s, r) => {
        s.totalBatches += 1;
        if (r.qcStatus === "PENDING_QC") s.pendingQc += 1;
        if (r.qcStatus === "PARTIAL_QC") s.partialQc += 1;
        if (r.qcStatus === "COMPLETED_QC") s.completedQc += 1;
        return s;
      },
      { totalBatches: 0, pendingQc: 0, partialQc: 0, completedQc: 0 },
    );

    return res.json({
      meta: {
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
        productionId: productionId ?? null,
        fgItemId: fgItemId ?? null,
        customerId: customerId ?? null,
        salesOrderId: salesOrderId ?? null,
        dispatchId: dispatchId ?? null,
        qcStatus,
        supportedTraceabilityLevel: "Production batch → QC (exact). Dispatch/Billing: SalesOrder+Item only.",
      },
      summary,
      rows,
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * GET /api/reports/activity-log
 *
 * Audit-friendly activity log (ISO/CA). Uses existing AuditLog rows, but presents a standardized view.
 *
 * Query:
 * - fromDate (YYYY-MM-DD) required
 * - toDate (YYYY-MM-DD) required
 * - actorUserId? (number)
 * - module? (SALES|PURCHASE|STOCK|PRODUCTION|QC|DISPATCH|REPORTS|SETTINGS|SESSION|ADMIN)
 * - action? (CREATE|UPDATE|DELETE|APPROVE|REVERSE|EXPORT|OVERRIDE|CANCEL|REJECT|LOGIN|LOGOUT|LOGIN_FAILED)
 * - refType? (SO|WO|GRN|PURCHASE_BILL|SALES_BILL|DISPATCH|QC|PRODUCTION|RM_PO|STOCK_ADJUSTMENT|TALLY_EXPORT|EXPORT_HISTORY)
 * - page? (default 1)
 * - pageSize? (default 50; max 200)
 */
reportsRouter.get("/activity-log", requireAuth, activityLogRoles, async (req, res, next) => {
  try {
    const fromDate = parseDateStart(req.query.fromDate);
    const toDate = parseDateEnd(req.query.toDate);
    if (!fromDate || !toDate) {
      const err = new Error("fromDate and toDate are required (YYYY-MM-DD).");
      err.statusCode = 400;
      throw err;
    }
    if (fromDate.getTime() > toDate.getTime()) {
      const err = new Error("fromDate cannot be after toDate.");
      err.statusCode = 400;
      throw err;
    }

    const actorUserIdRaw = req.query.actorUserId ?? req.query.userId;
    const actorUserId =
      actorUserIdRaw != null && String(actorUserIdRaw).trim() !== "" ? Number(actorUserIdRaw) : null;

    const moduleFilter = normalizeAuditModule(req.query.module);
    const actionFilterRaw = String(req.query.action || "").trim().toUpperCase();
    const actionFilter = actionFilterRaw ? actionFilterRaw : null;
    const refTypeFilter = normalizeRefType(req.query.refType);

    const page = Math.max(1, Number(req.query.page || 1) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize || 50) || 50));
    const skip = (page - 1) * pageSize;

    /** @type {import('@prisma/client').Prisma.AuditLogWhereInput} */
    const where = { createdAt: { gte: fromDate, lte: toDate } };
    if (actorUserId != null && Number.isFinite(actorUserId) && actorUserId > 0) where.actorUserId = actorUserId;
    // Prisma enum filter only for known actions. For non-enum (EXPORT/OVERRIDE), we filter post-query via payload/ref fields.
    if (actionFilter && Object.prototype.hasOwnProperty.call(AuditAction, actionFilter)) {
      where.action = AuditAction[actionFilter];
    }

    const [totalRaw, rowsRaw] = await prisma.$transaction([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
    ]);

    const mapped = (rowsRaw || []).map((r) => {
      const payload = r.payload && typeof r.payload === "object" ? r.payload : null;
      const moduleVal = payload ? normalizeAuditModule(payload.module) : null;
      const ref = extractRef(payload, r);
      const status = extractStatusTransition(payload);
      const displayAction = payload && typeof payload.actionLabel === "string" ? payload.actionLabel : String(r.action);
      return {
        id: r.id,
        createdAt: r.createdAt,
        userName: r.actor?.name || r.actor?.email || (r.actorUserId ? `User #${r.actorUserId}` : "—"),
        role: r.actorRole || null,
        module: moduleVal || null,
        action: displayAction,
        referenceType: ref.refType,
        referenceId: ref.refId,
        referenceNo: ref.refNo,
        summary: r.summary,
        oldStatus: status?.from ?? null,
        newStatus: status?.to ?? null,
        reason: r.reason || (payload ? scalarStr(payload.reason) : null) || null,
      };
    });

    const filtered = mapped.filter((r) => {
      if (moduleFilter && r.module !== moduleFilter) return false;
      if (refTypeFilter && r.referenceType !== refTypeFilter) return false;
      if (actionFilter && !Object.prototype.hasOwnProperty.call(AuditAction, actionFilter)) {
        // Non-enum action filters: match against payload display action.
        if (String(r.action || "").toUpperCase() !== actionFilter) return false;
      }
      return true;
    });

    return res.json({
      meta: {
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
        actorUserId: actorUserId ?? null,
        module: moduleFilter,
        action: actionFilter,
        refType: refTypeFilter,
        page,
        pageSize,
        totalRaw,
      },
      total: filtered.length,
      rows: filtered,
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * GET /api/reports/stock-reconciliation
 *
 * Item-wise stock reconciliation (usable bucket): opening, inward/outward, adjustment deltas, closing, and last movement date.
 * Query:
 * - fromDate (YYYY-MM-DD) required
 * - toDate (YYYY-MM-DD) required
 * - itemId? (number)
 * - itemType? (RM|FG)
 * - onlyAdjustments? (true|false) -> only items with any adjustment in range (increase or decrease)
 * - onlyMovement? (true|false) -> only items with any non-zero movement in range (normal or adjustment)
 */
reportsRouter.get("/stock-reconciliation", requireAuth, stockReconRoles, async (req, res, next) => {
  try {
    const fromDate = parseDateStart(req.query.fromDate);
    const toDate = parseDateEnd(req.query.toDate);
    if (!fromDate || !toDate) {
      const err = new Error("fromDate and toDate are required (YYYY-MM-DD).");
      err.statusCode = 400;
      throw err;
    }
    if (fromDate.getTime() > toDate.getTime()) {
      const err = new Error("fromDate cannot be after toDate.");
      err.statusCode = 400;
      throw err;
    }

    const itemIdRaw = req.query.itemId ?? req.query.item;
    const itemId =
      itemIdRaw != null && String(itemIdRaw).trim() !== "" ? Number(itemIdRaw) : null;

    const itemTypeRaw = req.query.itemType != null ? String(req.query.itemType).trim().toUpperCase() : "";
    const itemType = itemTypeRaw === "RM" || itemTypeRaw === "FG" ? itemTypeRaw : null;

    const onlyAdjustments = String(req.query.onlyAdjustments || "").toLowerCase() === "true";
    const onlyMovement = String(req.query.onlyMovement || "").toLowerCase() === "true";

    /** @type {import('@prisma/client').Prisma.StockTransactionWhereInput} */
    const baseWhere = { stockBucket: "USABLE" };
    if (itemId != null && Number.isFinite(itemId) && itemId > 0) baseWhere.itemId = itemId;
    if (itemType) baseWhere.item = { itemType };

    const openingWhere = {
      ...baseWhere,
      date: { lt: fromDate },
    };

    const rangeWhere = {
      ...baseWhere,
      date: { gte: fromDate, lte: toDate },
    };

    // Opening balance (before fromDate) per item: sum(qtyIn - qtyOut)
    const openingAgg = await prisma.stockTransaction.groupBy({
      by: ["itemId"],
      where: openingWhere,
      _sum: { qtyIn: true, qtyOut: true },
    });
    const openingByItemId = new Map(
      openingAgg.map((r) => [r.itemId, Number(r._sum.qtyIn || 0) - Number(r._sum.qtyOut || 0)]),
    );

    // Range movement split by transactionType.
    const rangeAgg = await prisma.stockTransaction.groupBy({
      by: ["itemId", "transactionType"],
      where: rangeWhere,
      _sum: { qtyIn: true, qtyOut: true },
    });

    /** @type {Map<number, { normalIn: number, normalOut: number, adjIn: number, adjOut: number }>} */
    const movementByItemId = new Map();
    for (const r of rangeAgg) {
      const itemId = r.itemId;
      if (!movementByItemId.has(itemId)) movementByItemId.set(itemId, { normalIn: 0, normalOut: 0, adjIn: 0, adjOut: 0 });
      const m = movementByItemId.get(itemId);
      const qIn = Number(r._sum.qtyIn || 0);
      const qOut = Number(r._sum.qtyOut || 0);
      if (r.transactionType === "ADJUSTMENT") {
        m.adjIn += qIn;
        m.adjOut += qOut;
      } else {
        m.normalIn += qIn;
        m.normalOut += qOut;
      }
    }

    // Last movement date per item up to toDate (usable bucket)
    const lastMoveRows = await prisma.stockTransaction.groupBy({
      by: ["itemId"],
      where: { ...baseWhere, date: { lte: toDate } },
      _max: { date: true },
    });
    const lastMoveByItemId = new Map(lastMoveRows.map((r) => [r.itemId, r._max.date || null]));

    // Determine relevant item ids for report output
    const itemIdsSet = new Set();
    for (const k of openingByItemId.keys()) itemIdsSet.add(k);
    for (const k of movementByItemId.keys()) itemIdsSet.add(k);
    for (const k of lastMoveByItemId.keys()) itemIdsSet.add(k);

    const itemIds = Array.from(itemIdsSet).filter((id) => Number.isFinite(id) && id > 0);
    if (itemIds.length === 0) {
      return res.json({
        meta: {
          fromDate: fromDate.toISOString(),
          toDate: toDate.toISOString(),
          onlyAdjustments,
          onlyMovement,
          itemId: itemId ?? null,
          itemType: itemType ?? null,
        },
        summary: { totalItems: 0, itemsWithAdjustments: 0, totalInwardQty: 0, totalOutwardQty: 0 },
        rows: [],
      });
    }

    const items = await prisma.item.findMany({
      where: { id: { in: itemIds } },
      include: { unitRef: { select: { id: true, unitName: true } } },
    });
    const itemById = new Map(items.map((it) => [it.id, it]));

    const rowsRaw = [];
    for (const id of itemIds) {
      const it = itemById.get(id);
      if (!it) continue;
      const openingQty = Number(openingByItemId.get(id) ?? 0);
      const mv = movementByItemId.get(id) ?? { normalIn: 0, normalOut: 0, adjIn: 0, adjOut: 0 };
      const systemClosingQty = openingQty + (mv.normalIn - mv.normalOut) + (mv.adjIn - mv.adjOut);
      const hasAdjustments = Math.abs(mv.adjIn) > 1e-9 || Math.abs(mv.adjOut) > 1e-9;
      const hasMovement =
        Math.abs(mv.normalIn) > 1e-9 ||
        Math.abs(mv.normalOut) > 1e-9 ||
        Math.abs(mv.adjIn) > 1e-9 ||
        Math.abs(mv.adjOut) > 1e-9;

      if (onlyAdjustments && !hasAdjustments) continue;
      if (onlyMovement && !hasMovement) continue;

      rowsRaw.push({
        itemId: it.id,
        itemName: it.itemName,
        itemType: it.itemType ?? null,
        unit: it.unitRef?.unitName ?? it.unit ?? "",
        openingQty,
        totalInwardQty: mv.normalIn,
        totalOutwardQty: mv.normalOut,
        adjustmentIncreaseQty: mv.adjIn,
        adjustmentDecreaseQty: mv.adjOut,
        systemClosingQty,
        lastMovementDate: lastMoveByItemId.get(id) ?? null,
      });
    }

    // Current available qty (usable bucket): aggregate once for all returned items.
    const currentAgg = await prisma.stockTransaction.groupBy({
      by: ["itemId"],
      where: { stockBucket: "USABLE", itemId: { in: rowsRaw.map((r) => r.itemId) } },
      _sum: { qtyIn: true, qtyOut: true },
    });
    const currentByItemId = new Map(
      currentAgg.map((r) => [r.itemId, Number(r._sum.qtyIn || 0) - Number(r._sum.qtyOut || 0)]),
    );

    const rows = rowsRaw
      .map((r) => {
        const currentAvailableQty = currentByItemId.get(r.itemId) ?? null;
        const showCurrent =
          currentAvailableQty != null && Number.isFinite(currentAvailableQty) && Math.abs(currentAvailableQty - r.systemClosingQty) > 1e-6;
        return {
          ...r,
          currentAvailableQty: showCurrent ? currentAvailableQty : null,
        };
      })
      .sort((a, b) => String(a.itemName).localeCompare(String(b.itemName), undefined, { sensitivity: "base" }));

    const summary = rows.reduce(
      (s, r) => {
        s.totalItems += 1;
        if ((r.adjustmentIncreaseQty || 0) > 1e-9 || (r.adjustmentDecreaseQty || 0) > 1e-9) s.itemsWithAdjustments += 1;
        s.totalInwardQty += Number(r.totalInwardQty || 0);
        s.totalOutwardQty += Number(r.totalOutwardQty || 0);
        return s;
      },
      { totalItems: 0, itemsWithAdjustments: 0, totalInwardQty: 0, totalOutwardQty: 0 },
    );

    return res.json({
      meta: {
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
        onlyAdjustments,
        onlyMovement,
        itemId: itemId ?? null,
        itemType: itemType ?? null,
        stockBucket: "USABLE",
      },
      summary,
      rows,
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * GET /api/reports/so-dispatch-trace
 * Paginated SO → WO → production → QC → dispatch trace (read-only).
 * Query: page, pageSize (max 100), soSearch | soNo, itemId, dateFrom, dateTo (YYYY-MM-DD).
 */
reportsRouter.get("/so-dispatch-trace", requireAuth, soDispatchTraceRoles, async (req, res, next) => {
  try {
    const itemRaw = req.query.itemId ?? req.query.item;
    const itemId = itemRaw != null && String(itemRaw).trim() !== "" ? Number(itemRaw) : undefined;
    const payload = await getSoDispatchTraceReport(prisma, {
      page: req.query.page,
      pageSize: req.query.pageSize,
      soSearch: typeof req.query.soSearch === "string" ? req.query.soSearch : typeof req.query.soNo === "string" ? req.query.soNo : undefined,
      itemId: Number.isFinite(itemId) && itemId > 0 ? itemId : undefined,
      dateFrom: parseDateStart(req.query.dateFrom),
      dateTo: parseDateEnd(req.query.dateTo),
    });
    return res.json(payload);
  } catch (e) {
    return next(e);
  }
});

reportsRouter.get("/operations-exceptions", requireAuth, operationsExceptionsRoles, async (req, res, next) => {
  try {
    const payload = await buildOperationsExceptionReportPayload();
    return res.json(payload);
  } catch (e) {
    return next(e);
  }
});

function customerNameForSalesOrder(so) {
  const direct = so.customer?.name?.trim();
  if (direct) return direct;
  const fromPo = so.po?.customer?.name?.trim();
  if (fromPo) return fromPo;
  return "Unknown Customer";
}

/**
 * GET /api/reports/work-order-tracking
 *
 * One row per WorkOrderLine: required qty (SO), planned production qty (buffer), produced, QC, dispatch.
 *
 * Production: sum(ProductionEntry.producedQty) grouped by workOrderLineId.
 *
 * QC: for each ProductionEntry on the line, sum acceptedQty/rejectedQty from QcEntry where reversedAt is null
 * (reversed QC does not count), same rule as qc-queue dashboard.
 *
 * Dispatch: Dispatch is stored per SalesOrder + itemId only. For each WO line we set dispatchedQty to that
 * line's FIFO share of net dispatch on the SO for fgItemId (see allocateDispatchFifoAcrossWorkOrderLines
 * in reportMetrics). dispatchPendingQty = max(acceptedQty - dispatchedQty, 0) per line (WO tracking).
 * Summary pendingDispatchQtySum is capped per SO+FG: see computeWorkOrderTrackingSummaryPendingDispatchQtySum.
 *
 * orderedQty: sum of SalesOrderLine.qty for matching soId and itemId (same FG as the WO line).
 */
reportsRouter.get("/work-order-tracking", requireAuth, workOrderTrackingRoles, async (req, res, next) => {
  try {
    const lines = await prisma.workOrderLine.findMany({
      orderBy: [
        { workOrder: { salesOrder: { createdAt: "asc" } } },
        { workOrder: { createdAt: "asc" } },
        { id: "asc" },
      ],
      include: {
        fgItem: true,
        workOrder: {
          include: {
            salesOrder: {
              include: {
                lines: { include: { item: true }, orderBy: { id: "asc" } },
                customer: true,
                po: { include: { customer: true } },
                dispatch: true,
              },
            },
          },
        },
        productions: {
          include: {
            qcEntries: { where: QC_ENTRY_ACTIVE_WHERE },
          },
        },
      },
    });

    /** @type {Map<string, Array<{ lineId: number, acceptedQty: number }>>} */
    const groupBuckets = new Map();

    /** @type {Map<number, { producedQty: number, acceptedQty: number, rejectedQty: number }>} */
    const metricsByLineId = new Map();

    for (const wol of lines) {
      let producedQty = 0;
      let acceptedQty = 0;
      let rejectedQty = 0;
      for (const pe of wol.productions) {
        if (pe.workflowStatus !== "APPROVED") continue;
        producedQty += Number(pe.producedQty);
        acceptedQty += sumActiveQcAcceptedQty(pe.qcEntries);
        rejectedQty += sumActiveQcRejectedQty(pe.qcEntries);
      }
      metricsByLineId.set(wol.id, { producedQty, acceptedQty, rejectedQty });

      const so = wol.workOrder.salesOrder;
      const key = `${so.id}-${wol.fgItemId}`;
      if (!groupBuckets.has(key)) groupBuckets.set(key, []);
      groupBuckets.get(key).push({ lineId: wol.id, acceptedQty });
    }

    /** @type {Map<number, number>} */
    const dispatchedByLineId = new Map();

    for (const [key, bucket] of groupBuckets.entries()) {
      const [soIdStr, fgItemIdStr] = key.split("-");
      const soId = Number(soIdStr);
      const fgItemId = Number(fgItemIdStr);
      const sample = lines.find((l) => l.workOrder.salesOrderId === soId && l.fgItemId === fgItemId);
      if (!sample) continue;
      const so = sample.workOrder.salesOrder;
      const net = netDispatchedByItemId(so.dispatch || [], DISPATCH_ALLOC_MODE.CONFIRMED).get(fgItemId) ?? 0;
      const allocMap = allocateDispatchFifoAcrossWorkOrderLines(bucket, net);
      for (const [lid, qty] of allocMap) {
        dispatchedByLineId.set(lid, qty);
      }
    }

    const rows = [];
    for (const wol of lines) {
      const wo = wol.workOrder;
      const so = wo.salesOrder;
      const m = metricsByLineId.get(wol.id);
      const producedQty = m.producedQty;
      const acceptedQty = m.acceptedQty;
      const rejectedQty = m.rejectedQty;
      const requiredQty = Number(wol.qty);
      const orderedQty = aggregateSoOrderedQtyByItemId(so.lines || []).get(wol.fgItemId) ?? 0;
      const dispatchedQty = dispatchedByLineId.get(wol.id) ?? 0;

      const productionPendingQty = getWoTrackingProductionPendingQty(requiredQty, producedQty);
      const qcPendingQty = getWoTrackingQcPendingQty(producedQty, acceptedQty, rejectedQty);
      const dispatchPendingQty = getWoTrackingDispatchPendingQty(acceptedQty, dispatchedQty);

      const status = deriveWoTrackingOperationalStatus(
        {
          productionPendingQty,
          qcPendingQty,
          dispatchPendingQty,
          producedQty,
          acceptedQty,
          rejectedQty,
          dispatchedQty,
        },
        REPORT_QUEUE_EPS,
      );

      rows.push({
        workOrderLineId: wol.id,
        salesOrderId: so.id,
        salesOrderNo: `SO-${so.id}`,
        salesOrderDate: so.createdAt.toISOString(),
        customerName: customerNameForSalesOrder(so),
        workOrderId: wo.id,
        workOrderNo: `WO-${wo.id}`,
        workOrderDate: wo.createdAt.toISOString(),
        workOrderStatus: wo.status,
        itemId: wol.fgItemId,
        itemName: wol.fgItem.itemName,
        orderedQty,
        workOrderQty: requiredQty,
        requiredQty,
        producedQty,
        acceptedQty,
        rejectedQty,
        dispatchedQty,
        productionPendingQty,
        qcPendingQty,
        dispatchPendingQty,
        status,
        quantityContexts: {
          so: {
            orderedTotalForFgOnSalesOrder: orderedQty,
            metricContext: METRIC_CONTEXT.SO_ITEM_TOTAL,
          },
          wo: {
            requiredQty,
            producedQty,
            acceptedQty,
            rejectedQty,
            attributedDispatchedQty: dispatchedQty,
            productionPendingQty,
            qcPendingQty,
            dispatchPendingQty,
            metricContext: METRIC_CONTEXT.WO_LINE,
          },
          dispatchAllocation: METRIC_CONTEXT.WO_FIFO,
        },
      });
    }

    const summary = computeWorkOrderTrackingSummaryFromRows(rows);

    return res.json({
      rows,
      summary,
      reportMetricHints: {
        orderedQty: "Sum of sales order line quantities for this FG item on the sales order (all matching SO lines)",
        requiredQty: "Work order line qty committed to the sales order (SO validation / dispatch pool basis)",
        workOrderQty: "Same as requiredQty (legacy field name)",
        dispatchPendingQty: METRIC_DEFINITIONS.woDispatchPendingQty,
        pendingDispatchQtySum:
          "Sum over SO+FG groups of min(SO order remainder, accepted-not-yet-dispatched); does not exceed SO qty scope",
        dispatchAllocation: METRIC_CONTEXT.WO_FIFO,
        metricDefinitionsRef: METRIC_DEFINITIONS,
      },
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * GET /api/reports/customer-so-rs
 *
 * Customer-wise SO + requirement sheet position (NO_QTY RS fields + dashboard-aligned next action).
 *
 * Query:
 * - customerId? (number)
 * - soType? NORMAL | NO_QTY | ALL
 * - status? SalesOrderInternalStatus or ALL
 * - dateFrom? / dateTo? (YYYY-MM-DD, filters SalesOrder.createdAt)
 * - q? / search? — partial match on docNo or customerPoReference; when set, NO_QTY orders emit one row per cycle
 */
/**
 * GET /api/reports/production-rm-variance
 * Immutable consumption snapshots (REGULAR only). Query: dateFrom, dateTo, fgItemId, rmItemId,
 * varianceType, consumptionType, thresholdPct, highVarianceOnly, woNumber, soNumber, page, pageSize.
 * export=csv returns text/csv attachment payload in JSON { csv } or set Accept — returns { csv, rowCount }.
 */
reportsRouter.get(
  "/production-rm-variance",
  requireAuth,
  productionRmVarianceRoles,
  async (req, res, next) => {
    try {
      const data = await buildProductionRmVarianceReport(req.query);
      if (data.export === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="production-rm-variance_${new Date().toISOString().slice(0, 10)}.csv"`,
        );
        return res.send(data.csv);
      }
      return res.json(data);
    } catch (e) {
      return next(e);
    }
  },
);

reportsRouter.get("/customer-so-rs", requireAuth, customerSoRsRoles, async (req, res, next) => {
  try {
    const statusRaw = String(req.query.status ?? "").trim();
    if (statusRaw && statusRaw.toUpperCase() !== "ALL") {
      const allowed = new Set([
        "DRAFT",
        "OPEN",
        "APPROVED",
        "IN_PROCESS",
        "COMPLETED",
        "CLOSED",
        "MANUALLY_CLOSED",
      ]);
      if (!allowed.has(statusRaw)) {
        const err = new Error(`Invalid status. Use ALL or one of: ${[...allowed].join(", ")}.`);
        err.statusCode = 400;
        throw err;
      }
    }

    const df = parseDateStart(req.query.dateFrom);
    const dt = parseDateEnd(req.query.dateTo);
    if (df && dt && df.getTime() > dt.getTime()) {
      const err = new Error("dateFrom cannot be after dateTo.");
      err.statusCode = 400;
      throw err;
    }

    const payload = await buildCustomerSoRsReport(req.query);
    return res.json(payload);
  } catch (e) {
    return next(e);
  }
});

module.exports = { reportsRouter };
