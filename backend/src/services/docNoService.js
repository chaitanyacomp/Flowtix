const { DocType } = require("../prismaClientPackage");

function pad4(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return "0000";
  return String(Math.floor(x)).padStart(4, "0");
}

function year2FromDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  return Number.isFinite(y) ? y % 100 : new Date().getFullYear() % 100;
}

function formatDocNo(prefix, year2, runningNo) {
  const yy = String(Number(year2) % 100).padStart(2, "0");
  return `${prefix}-${yy}-${pad4(runningNo)}`;
}

/** Authoritative Work Order flow keys for numbering (not inferred from stock/UI). */
const WORK_ORDER_FLOW = Object.freeze({
  REGULAR_SO: "REGULAR_SO",
  NO_QTY: "NO_QTY",
  GREEN_LEVEL: "GREEN_LEVEL",
});

const WORK_ORDER_FLOW_PREFIX = Object.freeze({
  [WORK_ORDER_FLOW.REGULAR_SO]: "WO-R",
  [WORK_ORDER_FLOW.NO_QTY]: "WO-NQ",
  [WORK_ORDER_FLOW.GREEN_LEVEL]: "WO-GL",
});

const WORK_ORDER_FLOW_DOC_TYPE = Object.freeze({
  [WORK_ORDER_FLOW.REGULAR_SO]: DocType.WORK_ORDER_REGULAR,
  [WORK_ORDER_FLOW.NO_QTY]: DocType.WORK_ORDER_NO_QTY,
  [WORK_ORDER_FLOW.GREEN_LEVEL]: DocType.WORK_ORDER_GREEN_LEVEL,
});

/** Legacy shared series before flow-wise numbering: WO-YY-#### */
const LEGACY_WORK_ORDER_DOC_NO_RE = /^WO-(\d{2})-(\d{4})$/i;
const FLOW_WORK_ORDER_DOC_NO_RE = /^WO-(R|NQ|GL)-(\d{2})-(\d{4})$/i;

function normalizeWorkOrderFlow(flow) {
  const key = String(flow ?? "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");
  if (key === "REGULAR" || key === "NORMAL" || key === "REPLACEMENT" || key === "REGULAR_SO") {
    return WORK_ORDER_FLOW.REGULAR_SO;
  }
  if (key === "NO_QTY" || key === "NOQTY") return WORK_ORDER_FLOW.NO_QTY;
  if (key === "GREEN_LEVEL" || key === "GREENLEVEL" || key === "GL") {
    return WORK_ORDER_FLOW.GREEN_LEVEL;
  }
  return null;
}

/**
 * Resolve WO numbering flow from authoritative Sales Order orderType.
 * Never infer from stock source, WO history, or screen context.
 */
function resolveWorkOrderFlowFromSalesOrderType(orderType) {
  const t = String(orderType ?? "")
    .trim()
    .toUpperCase();
  if (t === "NO_QTY") return WORK_ORDER_FLOW.NO_QTY;
  // NORMAL / REPLACEMENT / unknown SO-backed → Regular series
  return WORK_ORDER_FLOW.REGULAR_SO;
}

function workOrderDocTypeForFlow(flow) {
  const normalized = normalizeWorkOrderFlow(flow);
  if (!normalized) {
    const err = new Error(`Unknown Work Order flow for numbering: ${flow}`);
    err.statusCode = 400;
    err.code = "INVALID_WORK_ORDER_FLOW";
    throw err;
  }
  return WORK_ORDER_FLOW_DOC_TYPE[normalized];
}

function workOrderPrefixForFlow(flow) {
  const normalized = normalizeWorkOrderFlow(flow);
  if (!normalized) {
    const err = new Error(`Unknown Work Order flow for numbering: ${flow}`);
    err.statusCode = 400;
    err.code = "INVALID_WORK_ORDER_FLOW";
    throw err;
  }
  return WORK_ORDER_FLOW_PREFIX[normalized];
}

function isLegacyWorkOrderDocNo(docNo) {
  return LEGACY_WORK_ORDER_DOC_NO_RE.test(String(docNo ?? "").trim());
}

function isFlowWorkOrderDocNo(docNo) {
  return FLOW_WORK_ORDER_DOC_NO_RE.test(String(docNo ?? "").trim());
}

function prefixForDocType(docType) {
  switch (docType) {
    case DocType.SALES_ORDER:
      return "SO";
    case DocType.WORK_ORDER:
      return "WO";
    case DocType.WORK_ORDER_REGULAR:
      return WORK_ORDER_FLOW_PREFIX[WORK_ORDER_FLOW.REGULAR_SO];
    case DocType.WORK_ORDER_NO_QTY:
      return WORK_ORDER_FLOW_PREFIX[WORK_ORDER_FLOW.NO_QTY];
    case DocType.WORK_ORDER_GREEN_LEVEL:
      return WORK_ORDER_FLOW_PREFIX[WORK_ORDER_FLOW.GREEN_LEVEL];
    case DocType.PRODUCTION_ENTRY:
      return "PE";
    case DocType.QC_ENTRY:
      return "QC";
    case DocType.DISPATCH:
      return "D";
    case DocType.SALES_BILL:
      return "SB";
    case DocType.REQUIREMENT_SHEET:
      return "RS";
    case DocType.MATERIAL_REQUIREMENT:
      return "MR";
    case DocType.PURCHASE_REQUEST:
      return "PR";
    case DocType.MATERIAL_ISSUE_NOTE:
      return "MIN";
    case DocType.MATERIAL_RETURN_NOTE:
      return "MRN";
    case DocType.MATERIAL_WASTAGE_NOTE:
      return "MWN";
    case DocType.PRODUCTION_MATERIAL_REQUEST:
      return "PMR";
    case DocType.BOM:
      return "BOM";
    default:
      return "DOC";
  }
}

/**
 * Allocate the next running number for (docType, year2) and return formatted docNo.
 * Transaction-safe: MUST be called inside a Prisma transaction.
 *
 * @param {import('@prisma/client').PrismaClient} tx
 * @param {{ docType: import('@prisma/client').DocType, date?: Date }} input
 */
async function allocateDocNo(tx, { docType, date }) {
  const y2 = year2FromDate(date ?? new Date());
  const seq = await tx.docSequence.upsert({
    where: { docType_year2: { docType, year2: y2 } },
    create: { docType, year2: y2, nextNumber: 2 },
    update: { nextNumber: { increment: 1 } },
    select: { nextNumber: true, year2: true, docType: true },
  });
  const runningNo = Number(seq.nextNumber) - 1;
  const prefix = prefixForDocType(docType);
  return formatDocNo(prefix, y2, runningNo);
}

/**
 * Allocate the next Work Order docNo for a flow (independent sequence per flow + year).
 * Globally unique via WorkOrder.docNo @unique — flow prefixes never collide with legacy WO-YY-####.
 *
 * @param {import('@prisma/client').PrismaClient} tx
 * @param {{ flow: string, date?: Date }} input
 */
async function allocateWorkOrderDocNo(tx, { flow, date }) {
  const normalized = normalizeWorkOrderFlow(flow);
  if (!normalized) {
    const err = new Error(`Unknown Work Order flow for numbering: ${flow}`);
    err.statusCode = 400;
    err.code = "INVALID_WORK_ORDER_FLOW";
    throw err;
  }
  return allocateDocNo(tx, {
    docType: WORK_ORDER_FLOW_DOC_TYPE[normalized],
    date,
  });
}

module.exports = {
  allocateDocNo,
  allocateWorkOrderDocNo,
  formatDocNo,
  year2FromDate,
  prefixForDocType,
  WORK_ORDER_FLOW,
  WORK_ORDER_FLOW_PREFIX,
  WORK_ORDER_FLOW_DOC_TYPE,
  normalizeWorkOrderFlow,
  resolveWorkOrderFlowFromSalesOrderType,
  workOrderDocTypeForFlow,
  workOrderPrefixForFlow,
  isLegacyWorkOrderDocNo,
  isFlowWorkOrderDocNo,
  LEGACY_WORK_ORDER_DOC_NO_RE,
  FLOW_WORK_ORDER_DOC_NO_RE,
};
