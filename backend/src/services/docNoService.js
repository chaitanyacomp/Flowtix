const { DocType } = require("@prisma/client");

function pad4(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return "0000";
  return String(Math.floor(x)).padStart(4, "0");
}

function year2FromDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  return Number.isFinite(y) ? (y % 100) : new Date().getFullYear() % 100;
}

function formatDocNo(prefix, year2, runningNo) {
  const yy = String(Number(year2) % 100).padStart(2, "0");
  return `${prefix}-${yy}-${pad4(runningNo)}`;
}

function prefixForDocType(docType) {
  switch (docType) {
    case DocType.SALES_ORDER:
      return "SO";
    case DocType.WORK_ORDER:
      return "WO";
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

module.exports = {
  allocateDocNo,
  formatDocNo,
  year2FromDate,
  prefixForDocType,
};

