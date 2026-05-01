const PDFDocument = require("pdfkit");

/** Space reserved for pre-printed letterhead (first page only). ~80–120px; using 100pt. */
const LETTERHEAD_TOP_RESERVE = 100;

const PAGE = { w: 595.28, h: 841.89 };
const M = 48;
const CONTENT_W = PAGE.w - M * 2;

/**
 * @param {import("@prisma/client").Quotation & { enquiry: import("@prisma/client").Enquiry & { customer: import("@prisma/client").Customer }; lines: (import("@prisma/client").QuotationLine & { item: import("@prisma/client").Item })[] }} quotation
 * @returns {Promise<Buffer>}
 */
function buildQuotationPdf(quotation) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: M,
      bufferPages: false,
      info: { Title: `Quotation ${quotation.quotationNo || quotation.id}` },
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const cust = quotation.enquiry.customer;
    const lines = quotation.lines;

    let grossTotal = 0;
    let discountTotal = 0;
    for (const ln of lines) {
      const q = Number(ln.qty);
      const r = Number(ln.rate);
      const d = Number(ln.discountPct);
      const g = q * r;
      grossTotal += g;
      discountTotal += g * (d / 100);
    }
    const taxable = Number(quotation.subtotal);
    const gstTotal = Number(quotation.gstTotal);
    const grand = Number(quotation.totalAmount);

    const fmt = (n) => n.toFixed(2);
    const fmtMoney = (n) => fmt(Number(n));

    // First visible content: title only (letterhead area left blank)
    let y = M + LETTERHEAD_TOP_RESERVE;
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(16).text("QUOTATION", M, y, {
      width: CONTENT_W,
      align: "center",
    });
    y = doc.y + 16;

    // —— Document info (two columns) ——
    const mid = M + CONTENT_W / 2;
    const dateStr = new Date(quotation.createdAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    doc.font("Helvetica").fontSize(9).fillColor("#334155");
    doc.text("Quotation No.", M, y, { width: 120 });
    doc.font("Helvetica-Bold").text(quotation.quotationNo || `#${quotation.id}`, M, y + 11, { width: 200 });
    doc.font("Helvetica").text("Date", mid, y, { width: 120 });
    doc.font("Helvetica-Bold").text(dateStr, mid, y + 11, { width: 200 });
    y += 36;
    doc.font("Helvetica").text("Enquiry ID", M, y, { width: 120 });
    doc.font("Helvetica-Bold").text(`#${quotation.enquiryId}`, M, y + 11, { width: 200 });
    y += 40;

    // —— Bill To box ——
    const billH = 88;
    doc.save();
    doc.roundedRect(M, y, CONTENT_W, billH, 3).stroke("#cbd5e1");
    doc.fillColor("#f8fafc").rect(M, y, CONTENT_W, 22).fill();
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(10).text("Bill To", M + 10, y + 6);
    doc.fillColor("#1e293b").font("Helvetica").fontSize(9);
    let by = y + 28;
    doc.font("Helvetica-Bold").text(cust.name, M + 10, by, { width: CONTENT_W - 20 });
    by = doc.y + 2;
    if (cust.contact) {
      doc.font("Helvetica").text(`Contact: ${cust.contact}`, M + 10, by, { width: CONTENT_W - 20 });
      by = doc.y + 2;
    }
    if (cust.email) {
      doc.text(`Email: ${cust.email}`, M + 10, by, { width: CONTENT_W - 20 });
      by = doc.y + 2;
    }
    if (cust.address) {
      doc.text(cust.address, M + 10, by, { width: CONTENT_W - 20 });
      by = doc.y + 2;
    }
    if (cust.gst) {
      doc.text(`GST: ${cust.gst}`, M + 10, by, { width: CONTENT_W - 20 });
    }
    doc.restore();
    y += billH + 16;

    // —— Item table ——
    const col = {
      sr: M,
      item: M + 28,
      qty: M + 248,
      rate: M + 288,
      disc: M + 338,
      gst: M + 378,
      amt: M + 418,
    };
    const widths = { item: 210, qty: 38, rate: 48, disc: 38, gst: 38, amt: 72 };
    const rowH = 20;
    const headerH = 22;

    function drawTableHeader(yy) {
      doc.save();
      doc.rect(M, yy, CONTENT_W, headerH).fillAndStroke("#f1f5f9", "#94a3b8");
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(8.5);
      doc.text("Sr", col.sr + 4, yy + 6, { width: 20 });
      doc.text("Item", col.item + 4, yy + 6, { width: widths.item - 8 });
      doc.text("Qty", col.qty, yy + 6, { width: widths.qty, align: "right" });
      doc.text("Rate", col.rate, yy + 6, { width: widths.rate, align: "right" });
      doc.text("Disc %", col.disc, yy + 6, { width: widths.disc, align: "right" });
      doc.text("GST %", col.gst, yy + 6, { width: widths.gst, align: "right" });
      doc.text("Amount", col.amt, yy + 6, { width: widths.amt - 4, align: "right" });
      doc.restore();
    }

    function drawRowBorder(yy, h) {
      doc.moveTo(M, yy).lineTo(M + CONTENT_W, yy).stroke("#cbd5e1");
      doc.moveTo(M, yy + h).lineTo(M + CONTENT_W, yy + h).stroke("#cbd5e1");
      doc.moveTo(M, yy).lineTo(M, yy + h).stroke("#cbd5e1");
      doc.moveTo(M + CONTENT_W, yy).lineTo(M + CONTENT_W, yy + h).stroke("#cbd5e1");
      doc.moveTo(col.item, yy).lineTo(col.item, yy + h).stroke("#e2e8f0");
      doc.moveTo(col.qty, yy).lineTo(col.qty, yy + h).stroke("#e2e8f0");
      doc.moveTo(col.rate, yy).lineTo(col.rate, yy + h).stroke("#e2e8f0");
      doc.moveTo(col.disc, yy).lineTo(col.disc, yy + h).stroke("#e2e8f0");
      doc.moveTo(col.gst, yy).lineTo(col.gst, yy + h).stroke("#e2e8f0");
      doc.moveTo(col.amt, yy).lineTo(col.amt, yy + h).stroke("#e2e8f0");
    }

    drawTableHeader(y);
    y += headerH;

    let sr = 1;
    const bottomLimit = PAGE.h - M - 180;

    for (const ln of lines) {
      if (y + rowH > bottomLimit) {
        doc.addPage();
        y = M;
        drawTableHeader(y);
        y += headerH;
      }
      const base = Number(ln.qty) * Number(ln.rate) * (1 - Number(ln.discountPct) / 100);
      const gstPart = base * (Number(ln.gstPct) / 100);
      const lineAmt = base + gstPart;

      drawRowBorder(y, rowH);
      doc.fillColor("#1e293b").font("Helvetica").fontSize(8.5);
      doc.text(String(sr), col.sr + 4, y + 5, { width: 20 });
      const itemLabel =
        ln.isFree === true ? `${String(ln.item.itemName)} (Free)` : String(ln.item.itemName);
      doc.text(itemLabel, col.item + 4, y + 5, { width: widths.item - 8 });
      doc.text(fmtMoney(ln.qty), col.qty, y + 5, { width: widths.qty, align: "right" });
      doc.text(fmtMoney(ln.rate), col.rate, y + 5, { width: widths.rate, align: "right" });
      doc.text(fmtMoney(ln.discountPct), col.disc, y + 5, { width: widths.disc, align: "right" });
      doc.text(fmtMoney(ln.gstPct), col.gst, y + 5, { width: widths.gst, align: "right" });
      doc.text(fmtMoney(lineAmt), col.amt, y + 5, { width: widths.amt - 4, align: "right" });
      y += rowH;
      sr += 1;
    }
    doc.moveTo(M, y).lineTo(M + CONTENT_W, y).stroke("#94a3b8");
    y += 20;

    // —— Totals box (right) ——
    const boxW = 240;
    const boxX = M + CONTENT_W - boxW;
    const lineGap = 16;
    const boxPadding = 12;
    let ty = y;

    const rows = [
      ["Gross value (before discount)", fmtMoney(grossTotal)],
      ["(-) Discount", fmtMoney(discountTotal)],
      ["Taxable value", fmtMoney(taxable)],
      ["GST total", fmtMoney(gstTotal)],
    ];

    const totalsBoxH = boxPadding * 2 + lineGap * rows.length + 12 + 26;

    doc.save();
    doc.roundedRect(boxX, ty, boxW, totalsBoxH, 3).fillAndStroke("#f8fafc", "#cbd5e1");
    let ly = ty + boxPadding;
    doc.font("Helvetica").fontSize(9).fillColor("#475569");
    for (const [label, val] of rows) {
      doc.text(label, boxX + boxPadding, ly, { width: boxW - 100 });
      doc.fillColor("#0f172a").text(val, boxX + boxW - boxPadding - 88, ly, { width: 80, align: "right" });
      doc.fillColor("#475569");
      ly += lineGap;
    }
    ly += 4;
    doc.moveTo(boxX + boxPadding, ly).lineTo(boxX + boxW - boxPadding, ly).stroke("#cbd5e1");
    ly += 10;
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a");
    doc.text("Grand Total", boxX + boxPadding, ly, { width: 120 });
    doc.text(fmtMoney(grand), boxX + boxW - boxPadding - 88, ly, { width: 80, align: "right" });
    doc.restore();

    y = ty + totalsBoxH + 24;

    // —— Terms ——
    if (quotation.terms && String(quotation.terms).trim()) {
      if (y > PAGE.h - M - 120) {
        doc.addPage();
        y = M;
      }
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a").text("Terms & Conditions", M, y);
      y = doc.y + 8;
      doc.font("Helvetica").fontSize(9).fillColor("#334155").text(String(quotation.terms).trim(), M, y, {
        width: CONTENT_W,
        align: "left",
        lineGap: 2,
      });
      y = doc.y + 16;
    }

    // —— Signature (generic — letterhead carries company name) ——
    const sigY = Math.min(y + 24, PAGE.h - M - 72);
    doc.font("Helvetica").fontSize(9).fillColor("#475569").text("For Company", boxX, sigY, {
      width: boxW,
      align: "right",
    });
    doc.text("Authorised Signatory", boxX, sigY + 36, { width: boxW, align: "right" });
    doc.moveTo(boxX + boxW - 160, sigY + 28).lineTo(boxX + boxW, sigY + 28).stroke("#cbd5e1");

    doc.end();
  });
}

module.exports = { buildQuotationPdf };
