/**
 * Read-only reporting helpers for dashboard "Recent QC rejections" mini-report.
 * Formulas mirror dashboard.js (no posting / stock side effects).
 */
const { QC_ENTRY_ACTIVE_WHERE } = require("./qcEntryConstants");
const { STOCK_EPS } = require("./stockService");
const PDFDocument = require("pdfkit");

function dispositionPendingExcludingReworkReady(dispositions) {
  return (dispositions || []).reduce((ss, d) => {
    const rem = Number(d.remainingQty ?? 0) || 0;
    if (!(rem > STOCK_EPS)) return ss;
    if (String(d.status) === "CLOSED") return ss;
    if (String(d.status) === "REWORK_READY_FOR_QC") return ss;
    return ss + rem;
  }, 0);
}

function dispositionHoldRemaining(dispositions) {
  return (dispositions || []).reduce((ss, d) => {
    const rem = Number(d.remainingQty ?? 0) || 0;
    if (!(rem > STOCK_EPS)) return ss;
    if (String(d.status) !== "HOLD") return ss;
    return ss + rem;
  }, 0);
}

/** Rolling window aligned with dashboard KPI `since` (30 × 24h). */
function defaultReportRangeBounds() {
  const to = new Date();
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

/**
 * @param {{ from?: unknown; to?: unknown }} query
 * @returns {{ from: Date; to: Date } | { error: string }}
 */
function resolveReportDateRangeFromQuery(query) {
  const qf = query.from != null && String(query.from).trim() !== "" ? String(query.from).trim() : "";
  const qt = query.to != null && String(query.to).trim() !== "" ? String(query.to).trim() : "";
  if (!qf && !qt) {
    return defaultReportRangeBounds();
  }
  const def = defaultReportRangeBounds();
  let fromD;
  let toD;
  if (qf) {
    const p = parseYyyyMmDdLocalStart(qf);
    if (!p) return { error: "Invalid from date (use YYYY-MM-DD)." };
    fromD = p;
  } else {
    fromD = def.from;
  }
  if (qt) {
    const p = parseYyyyMmDdLocalStart(qt);
    if (!p) return { error: "Invalid to date (use YYYY-MM-DD)." };
    toD = endOfLocalDay(p);
  } else {
    toD = endOfLocalDay(new Date());
  }
  if (fromD.getTime() > toD.getTime()) {
    return { error: "from date must be on or before to date." };
  }
  return { from: fromD, to: toD };
}

/**
 * @param {string | undefined} s YYYY-MM-DD
 * @returns {Date | null} local start of day
 */
function parseYyyyMmDdLocalStart(s) {
  if (!s || typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function endOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {{ dateFrom?: Date | null; dateTo?: Date | null; take: number }} opts
 */
async function buildRecentQcRejectionsReportDtos(prisma, { dateFrom = null, dateTo = null, take }) {
  const where = { ...QC_ENTRY_ACTIVE_WHERE };
  if (dateFrom || dateTo) {
    where.date = {};
    if (dateFrom) where.date.gte = dateFrom;
    if (dateTo) where.date.lte = dateTo;
  }

  const recentQcRejectionsRaw = await prisma.qcEntry.findMany({
    where,
    orderBy: { date: "desc" },
    take,
    include: {
      production: {
        include: { workOrderLine: { include: { fgItem: true } } },
      },
      rejectedDispositions: {
        where: { voidedAt: null },
        select: { remainingQty: true, status: true },
      },
    },
  });

  const recentIds = recentQcRejectionsRaw.map((q) => q.id);
  const scrapByRecentQcId = new Map();
  if (recentIds.length) {
    const groupedRecentScrap = await prisma.scrapRecord.groupBy({
      by: ["qcEntryId"],
      where: { qcEntryId: { in: recentIds }, voidedAt: null },
      _sum: { rejectedQty: true },
    });
    for (const g of groupedRecentScrap) {
      if (g.qcEntryId == null) continue;
      scrapByRecentQcId.set(g.qcEntryId, Number(g._sum.rejectedQty || 0));
    }
  }

  const mapped = recentQcRejectionsRaw
    .map((q) => {
      const scrapSum = scrapByRecentQcId.get(q.id) || 0;
      const pending = dispositionPendingExcludingReworkReady(q.rejectedDispositions);
      const holdQty = dispositionHoldRemaining(q.rejectedDispositions);
      const pendingExHold = Math.max(0, pending - holdQty);
      const scrapNetLossQty = Math.max(0, scrapSum + pendingExHold);
      const netLossOrUnresolvedQty = Math.max(0, scrapSum + pending);
      const rejectedGrossQty = Number(q.rejectedQty) || 0;
      const recoveredQty = Math.max(0, rejectedGrossQty - scrapSum - pending);
      return { q, netLossOrUnresolvedQty, rejectedGrossQty, recoveredQty, holdQty, scrapNetLossQty };
    })
    .filter(({ rejectedGrossQty }) => rejectedGrossQty > STOCK_EPS);

  return mapped.map(({ q, netLossOrUnresolvedQty, rejectedGrossQty, recoveredQty, holdQty, scrapNetLossQty }) => ({
    id: q.id,
    date: q.date,
    itemName:
      q.production?.workOrderLine?.fgItem?.itemName ??
      q.production?.workOrderLine?.fgItem?.itemCode ??
      "Unknown Item",
    rejectedGrossQty,
    recoveredQty,
    holdQty,
    scrapNetLossQty,
    netLossOrUnresolvedQty,
    rejectedQty: rejectedGrossQty,
    netRejectedImpactQty: netLossOrUnresolvedQty,
    acceptedQty: Number(q.acceptedQty),
    lossQty: Number(q.lossQty),
    reason: q.reason,
    scrapReusable: q.scrapReusable,
  }));
}

function sumTotals(rows) {
  return rows.reduce(
    (acc, r) => ({
      rejectedGrossQty: acc.rejectedGrossQty + Number(r.rejectedGrossQty ?? 0),
      recoveredQty: acc.recoveredQty + Number(r.recoveredQty ?? 0),
      holdQty: acc.holdQty + Number(r.holdQty ?? 0),
      scrapNetLossQty: acc.scrapNetLossQty + Number(r.scrapNetLossQty ?? 0),
    }),
    { rejectedGrossQty: 0, recoveredQty: 0, holdQty: 0, scrapNetLossQty: 0 },
  );
}

function buildRecentQcRejectionsPdfBuffer(p) {
  const { rows, from, to, generatedAt } = p;
  const totals = sumTotals(rows);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "A4", bufferPages: true, info: { Title: "Recent QC Rejections Report" } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text("Recent QC Rejections Report", { align: "center" });
    doc.moveDown(0.6);
    doc.fontSize(10).fillColor("#444444");
    doc.text(`Period: ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`, { align: "center" });
    doc.text(`Generated: ${generatedAt.toISOString().replace("T", " ").slice(0, 19)} UTC`, { align: "center" });
    doc.fillColor("#000000");
    doc.moveDown(1.2);

    const tableLeft = doc.page.margins.left;
    const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const xDate = tableLeft;
    const xFg = tableLeft + w * 0.12;
    const xRej = tableLeft + w * 0.42;
    const xRec = tableLeft + w * 0.55;
    const xHold = tableLeft + w * 0.68;
    const xScrap = tableLeft + w * 0.8;
    const rowH = 16;
    let y = doc.y;

    function headerRow() {
      doc.fontSize(9).font("Helvetica-Bold");
      doc.text("Date", xDate, y, { width: w * 0.11 });
      doc.text("FG Item", xFg, y, { width: w * 0.28, ellipsis: true });
      doc.text("Rejected", xRej, y, { width: w * 0.12, align: "right" });
      doc.text("Recovered", xRec, y, { width: w * 0.12, align: "right" });
      doc.text("Hold", xHold, y, { width: w * 0.1, align: "right" });
      doc.text("Scrap/Loss", xScrap, y, { width: w * 0.18, align: "right" });
      y += rowH;
      doc.font("Helvetica");
      doc.moveTo(tableLeft, y - 4).lineTo(tableLeft + w, y - 4).stroke("#cccccc");
    }

    headerRow();

    doc.fontSize(8.5).font("Helvetica");
    for (const r of rows) {
      if (y > doc.page.height - doc.page.margins.bottom - 72) {
        doc.addPage();
        y = doc.page.margins.top;
        headerRow();
      }
      const d = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10);
      const fg = String(r.itemName ?? "").slice(0, 52);
      doc.text(d, xDate, y, { width: w * 0.11 });
      doc.text(fg, xFg, y, { width: w * 0.28, ellipsis: true });
      doc.text(String(r.rejectedGrossQty ?? 0), xRej, y, { width: w * 0.12, align: "right" });
      doc.text(String(r.recoveredQty ?? 0), xRec, y, { width: w * 0.12, align: "right" });
      doc.text(String(r.holdQty ?? 0), xHold, y, { width: w * 0.1, align: "right" });
      doc.text(String(r.scrapNetLossQty ?? 0), xScrap, y, { width: w * 0.18, align: "right" });
      y += rowH - 2;
    }

    y += 6;
    doc.moveTo(tableLeft, y).lineTo(tableLeft + w, y).stroke("#999999");
    y += 8;
    doc.fontSize(9).font("Helvetica-Bold");
    doc.text("Totals", xDate, y, { width: w * 0.38 });
    doc.text(String(totals.rejectedGrossQty), xRej, y, { width: w * 0.12, align: "right" });
    doc.text(String(totals.recoveredQty), xRec, y, { width: w * 0.12, align: "right" });
    doc.text(String(totals.holdQty), xHold, y, { width: w * 0.1, align: "right" });
    doc.text(String(totals.scrapNetLossQty), xScrap, y, { width: w * 0.18, align: "right" });

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).font("Helvetica").fillColor("#666666");
      doc.text(
        `Page ${i + 1} of ${range.count}`,
        doc.page.margins.left,
        doc.page.height - 40,
        { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: "center" },
      );
      doc.fillColor("#000000");
    }

    doc.end();
  });
}

module.exports = {
  dispositionPendingExcludingReworkReady,
  dispositionHoldRemaining,
  defaultReportRangeBounds,
  resolveReportDateRangeFromQuery,
  parseYyyyMmDdLocalStart,
  endOfLocalDay,
  buildRecentQcRejectionsReportDtos,
  sumTotals,
  buildRecentQcRejectionsPdfBuffer,
};
