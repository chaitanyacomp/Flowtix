const PDFDocument = require("pdfkit");
const fs = require("fs");

/* ------------------------- Page + design constants ------------------------ */

const PAGE = { w: 595.28, h: 841.89 }; // A4 in pt
const M = 36; // page margin (~12.7mm — within 10–14mm target)
const CONTENT_W = PAGE.w - M * 2;
const FOOTER_H = 28; // reserved bottom band for page numbers / footer rule

/**
 * Subtle page frame: drawn on every page after content. Inset 18pt (~6.3mm)
 * from each edge so it never kisses A4 print-safe bleed area and leaves ~6mm
 * of breathing room between the frame and the content gutter.
 */
const PAGE_FRAME = {
  inset: 18,
  thickness: 1.0,
  radius: 3,
};

/** Quotation validity (days from createdAt). Display only — NOT a workflow rule. */
const DEFAULT_VALIDITY_DAYS = 30;

const COLOR = {
  ink: "#0f172a",
  inkSoft: "#1e293b",
  muted: "#475569",
  mutedSoft: "#64748b",
  hairline: "#e2e8f0",
  borderHard: "#cbd5e1",
  panel: "#f8fafc",
  panelAlt: "#f1f5f9",
  zebra: "#fafafa",
  bannerBg: "#eef2ff",
  bannerBorder: "#c7d2fe",
  bannerInk: "#3730a3",
  accent: "#0f172a",
  accentInk: "#ffffff",
  dangerInk: "#b91c1c",
};

/* ------------------------------ Format helpers ---------------------------- */

function fmtMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function fmtPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function safe(v, fallback = "") {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length ? s : fallback;
}

/**
 * Resolves company info for the PDF chrome.
 *
 * Two input shapes supported:
 *   - Structured (preferred): from `getCompanyProfileForDocuments()` —
 *     `{ companyName, companyAddressLine1, companyAddressLine2, companyCity,
 *        companyState, companyStateName, companyStateCode, companyPincode,
 *        companyGstin, companyPan, companyMobile, companyPhone, companyEmail,
 *        companyWebsite, companySignatoryName,
 *        logoAbsolutePath, signatureAbsolutePath }`
 *   - Legacy: `{ name, address, gstin, state, phone, email, website, logoPath }`
 *
 * Each field falls back to a `COMPANY_*` env var before any visible placeholder.
 */
function resolveCompanyInfo(options) {
  const c = (options && options.company) || {};

  const name =
    safe(c.companyName) || safe(c.name) || safe(process.env.COMPANY_NAME) || "Your Company Name";

  let addressLines;
  if (c.companyAddressLine1 || c.companyAddressLine2 || c.companyCity || c.companyPincode) {
    const cityLine = [
      safe(c.companyCity),
      safe(c.companyStateName) || safe(c.companyState),
      safe(c.companyPincode),
    ]
      .filter(Boolean)
      .join(", ");
    addressLines = [
      safe(c.companyAddressLine1),
      safe(c.companyAddressLine2),
      cityLine,
    ].filter(Boolean);
  } else {
    addressLines = (safe(c.address) || safe(process.env.COMPANY_ADDRESS) || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const stateLabel =
    (c.companyStateName
      ? `${c.companyStateName}${c.companyStateCode ? ` (${c.companyStateCode})` : ""}`
      : null) ||
    safe(c.companyState) ||
    safe(c.state) ||
    safe(process.env.COMPANY_STATE);

  const phone = safe(c.companyPhone) || safe(c.phone) || safe(process.env.COMPANY_PHONE);
  const mobile = safe(c.companyMobile) || safe(c.mobile) || safe(process.env.COMPANY_MOBILE);
  const phoneCombined = [mobile, phone].filter(Boolean).join(" / ");

  return {
    name,
    addressLines,
    gstin: safe(c.companyGstin) || safe(c.gstin) || safe(process.env.COMPANY_GSTIN),
    pan: safe(c.companyPan) || safe(c.pan) || safe(process.env.COMPANY_PAN),
    state: stateLabel,
    phone: phoneCombined,
    email: safe(c.companyEmail) || safe(c.email) || safe(process.env.COMPANY_EMAIL),
    website: safe(c.companyWebsite) || safe(c.website) || safe(process.env.COMPANY_WEBSITE),
    logoPath:
      safe(c.logoAbsolutePath) || safe(c.logoPath) || safe(process.env.COMPANY_LOGO_PATH) || null,
    signatoryName:
      safe(c.companySignatoryName) ||
      safe(c.signatoryName) ||
      safe(process.env.COMPANY_SIGNATORY_NAME),
    signaturePath:
      safe(c.signatureAbsolutePath) ||
      safe(c.signaturePath) ||
      safe(process.env.COMPANY_SIGNATURE_PATH) ||
      null,
  };
}

/* ----------------------------- Drawing helpers ---------------------------- */

function drawHRule(doc, x1, x2, y, color = COLOR.hairline) {
  doc.save();
  doc.lineWidth(0.5).strokeColor(color).moveTo(x1, y).lineTo(x2, y).stroke();
  doc.restore();
}

function setText(doc, opts) {
  const { font = "Helvetica", size = 9, color = COLOR.ink } = opts || {};
  doc.font(font).fontSize(size).fillColor(color);
}

/**
 * Render a key/value pair stacked vertically (label small/muted, value bold).
 * Returns the new y after the pair, including a small bottom gap.
 */
function drawKv(doc, x, y, label, value, opts = {}) {
  const w = opts.width || 200;
  setText(doc, { size: 7.5, color: COLOR.mutedSoft });
  doc.text(String(label).toUpperCase(), x, y, { width: w, characterSpacing: 0.4 });
  const valY = doc.y + 1;
  setText(doc, { font: "Helvetica-Bold", size: 9, color: COLOR.ink });
  doc.text(safe(value, "—"), x, valY, { width: w });
  return doc.y + 4;
}

/* ------------------------------- Header band ------------------------------ */

function drawHeaderBand(doc, yStart, company) {
  const headerH = 94;
  const leftX = M;
  const rightX = M + CONTENT_W;
  const logoMaxW = 96;
  const logoMaxH = 60;
  const logoGap = 16;

  // Try to render the logo image. On failure or absence, fall back to a clean
  // text-only header (no broken placeholder box).
  let logoDrawn = false;
  if (company.logoPath && fs.existsSync(company.logoPath)) {
    try {
      doc.image(company.logoPath, leftX, yStart + 2, {
        fit: [logoMaxW, logoMaxH],
        align: "left",
        valign: "top",
      });
      logoDrawn = true;
    } catch (_e) {
      logoDrawn = false;
    }
  }

  const textX = logoDrawn ? leftX + logoMaxW + logoGap : leftX;
  const textW = logoDrawn ? CONTENT_W - logoMaxW - logoGap : CONTENT_W;

  setText(doc, { font: "Helvetica-Bold", size: 15, color: COLOR.ink });
  doc.text(company.name, textX, yStart + 2, { width: textW });

  setText(doc, { size: 8.5, color: COLOR.muted });
  let ay = doc.y + 3;
  for (const line of company.addressLines) {
    doc.text(line, textX, ay, { width: textW, lineGap: 1 });
    ay = doc.y + 1;
  }

  const metaBits = [];
  if (company.gstin) metaBits.push(`GSTIN: ${company.gstin}`);
  if (company.pan) metaBits.push(`PAN: ${company.pan}`);
  if (company.state) metaBits.push(`State: ${company.state}`);
  if (company.phone) metaBits.push(`Tel: ${company.phone}`);
  if (company.email) metaBits.push(`Email: ${company.email}`);
  if (company.website) metaBits.push(company.website);
  if (metaBits.length) {
    setText(doc, { size: 8, color: COLOR.muted });
    doc.text(metaBits.join("   •   "), textX, ay + 2, { width: textW });
  }

  drawHRule(doc, leftX, rightX, yStart + headerH - 4, COLOR.borderHard);

  return yStart + headerH;
}

/* ------------------------------ Document title ---------------------------- */

function drawDocumentTitle(doc, yStart, isNoQty) {
  // Minimal premium title: centered bold characterSpaced text framed by a short
  // thin rule below. No filled band, no shadow, no decoration.
  const titleY = yStart + 6;
  setText(doc, { font: "Helvetica-Bold", size: 13, color: COLOR.ink });
  doc.text("QUOTATION", M, titleY, {
    width: CONTENT_W,
    align: "center",
    characterSpacing: 3,
  });
  const afterTitleY = doc.y + 4;
  const ruleW = 80;
  drawHRule(
    doc,
    M + CONTENT_W / 2 - ruleW / 2,
    M + CONTENT_W / 2 + ruleW / 2,
    afterTitleY,
    COLOR.borderHard,
  );

  if (isNoQty) {
    setText(doc, { size: 8.5, color: COLOR.muted });
    doc.text("Commercial Rate Agreement", M, afterTitleY + 5, {
      width: CONTENT_W,
      align: "center",
      characterSpacing: 0.6,
    });
    return afterTitleY + 22;
  }
  return afterTitleY + 14;
}

/* --------------------------- Bill To + meta panel ------------------------- */

function drawBillToAndMeta(doc, yStart, quotation, customer, isNoQty) {
  const colGap = 14;
  const leftW = Math.floor((CONTENT_W - colGap) * 0.56);
  const rightW = CONTENT_W - leftW - colGap;
  const leftX = M;
  const rightX = M + leftW + colGap;

  // ===== LEFT: Bill To =====
  setText(doc, { size: 8, color: COLOR.mutedSoft });
  doc.text("BILL TO", leftX, yStart, { width: leftW, characterSpacing: 0.6 });
  let by = doc.y + 2;

  setText(doc, { font: "Helvetica-Bold", size: 11, color: COLOR.ink });
  doc.text(safe(customer.name, "—"), leftX, by, { width: leftW });
  by = doc.y + 2;

  setText(doc, { size: 9, color: COLOR.inkSoft });
  if (customer.address) {
    doc.text(customer.address, leftX, by, { width: leftW });
    by = doc.y + 1;
  }
  if (customer.state || customer.stateRef?.stateName) {
    const stateText = customer.stateRef?.stateName
      ? `${customer.stateRef.stateName}${customer.stateRef.stateCode ? ` (${customer.stateRef.stateCode})` : ""}`
      : customer.state;
    doc.text(`State: ${stateText}`, leftX, by, { width: leftW });
    by = doc.y + 1;
  }
  if (customer.gst) {
    setText(doc, { font: "Helvetica-Bold", size: 9, color: COLOR.ink });
    doc.text(`GSTIN: ${customer.gst}`, leftX, by, { width: leftW });
    setText(doc, { size: 9, color: COLOR.inkSoft });
    by = doc.y + 1;
  }
  if (customer.contact) {
    doc.text(`Contact: ${customer.contact}`, leftX, by, { width: leftW });
    by = doc.y + 1;
  }
  if (customer.email) {
    doc.text(`Email: ${customer.email}`, leftX, by, { width: leftW });
    by = doc.y + 1;
  }

  // ===== RIGHT: Document meta panel =====
  const panelPadX = 10;
  const panelPadY = 8;
  const panelH = 96;

  doc.save();
  doc
    .roundedRect(rightX, yStart - 2, rightW, panelH, 4)
    .lineWidth(0.6)
    .strokeColor(COLOR.borderHard)
    .fillColor(COLOR.panel)
    .fillAndStroke();
  doc.restore();

  const innerX = rightX + panelPadX;
  const innerW = rightW - panelPadX * 2;
  const col1X = innerX;
  const col2X = innerX + innerW / 2 + 4;
  const colW = innerW / 2 - 4;

  let metaY = yStart + panelPadY - 2;
  const validity = addDays(quotation.createdAt, DEFAULT_VALIDITY_DAYS);

  metaY = drawKv(doc, col1X, metaY, "Quotation No", safe(quotation.quotationNo) || `#${quotation.id}`, {
    width: colW,
  });
  drawKv(doc, col1X, metaY, "Quotation Date", fmtDate(quotation.createdAt), { width: colW });

  let metaY2 = yStart + panelPadY - 2;
  metaY2 = drawKv(doc, col2X, metaY2, "Enquiry Ref", `#${quotation.enquiryId}`, { width: colW });
  metaY2 = drawKv(doc, col2X, metaY2, "Valid Until", fmtDate(validity), { width: colW });

  // doc type badge at bottom-right of panel
  const badgeText = isNoQty ? "RATE AGREEMENT" : "QUOTATION";
  const badgeColor = isNoQty ? COLOR.bannerInk : COLOR.ink;
  const badgeBg = isNoQty ? COLOR.bannerBg : COLOR.panelAlt;
  const badgeBorder = isNoQty ? COLOR.bannerBorder : COLOR.borderHard;
  const badgeW = 116;
  const badgeH = 18;
  const badgeX = rightX + rightW - panelPadX - badgeW;
  const badgeY = yStart + panelH - panelPadY - badgeH - 2;
  doc.save();
  doc
    .roundedRect(badgeX, badgeY, badgeW, badgeH, 9)
    .lineWidth(0.6)
    .strokeColor(badgeBorder)
    .fillColor(badgeBg)
    .fillAndStroke();
  setText(doc, { font: "Helvetica-Bold", size: 8, color: badgeColor });
  doc.text(badgeText, badgeX, badgeY + 5, { width: badgeW, align: "center", characterSpacing: 0.6 });
  doc.restore();

  return Math.max(by, yStart + panelH) + 12;
}

/* ------------------------------ NO_QTY banner ----------------------------- */

function drawNoQtyBanner(doc, yStart) {
  const h = 26;
  doc.save();
  doc
    .roundedRect(M, yStart, CONTENT_W, h, 4)
    .lineWidth(0.6)
    .strokeColor(COLOR.bannerBorder)
    .fillColor(COLOR.bannerBg)
    .fillAndStroke();
  setText(doc, { font: "Helvetica-Bold", size: 9, color: COLOR.bannerInk });
  doc.text("Commercial rate agreement for rolling requirement planning.", M + 12, yStart + 8, {
    width: CONTENT_W - 24,
  });
  doc.restore();
  return yStart + h + 10;
}

/* ------------------------------- Item table ------------------------------- */

function getColumnsNormal() {
  // Sr (24) + Item (208) + HSN (52) + Qty (50) + Unit (38) + Rate (55) + Disc (38) + GST (38) + Amt (60) = 563? Recompute to fit CONTENT_W=523.
  // Adjusted: 24 + 178 + 50 + 48 + 36 + 52 + 36 + 36 + 63 = 523
  const cols = [
    { key: "sr", label: "Sr", w: 24, align: "left" },
    { key: "item", label: "Item Description", w: 178, align: "left" },
    { key: "hsn", label: "HSN", w: 50, align: "left" },
    { key: "qty", label: "Qty", w: 48, align: "right" },
    { key: "unit", label: "Unit", w: 36, align: "left" },
    { key: "rate", label: "Rate", w: 52, align: "right" },
    { key: "disc", label: "Disc %", w: 36, align: "right" },
    { key: "gst", label: "GST %", w: 36, align: "right" },
    { key: "amt", label: "Amount", w: 63, align: "right" },
  ];
  return cols;
}

function getColumnsNoQty() {
  // 24 + 220 + 60 + 50 + 70 + 50 + 49 = 523
  const cols = [
    { key: "sr", label: "Sr", w: 24, align: "left" },
    { key: "item", label: "Item Description", w: 220, align: "left" },
    { key: "hsn", label: "HSN", w: 60, align: "left" },
    { key: "unit", label: "Unit", w: 50, align: "left" },
    { key: "rate", label: "Unit Rate", w: 70, align: "right" },
    { key: "gst", label: "GST %", w: 50, align: "right" },
    { key: "remarks", label: "Remarks", w: 49, align: "left" },
  ];
  return cols;
}

function colX(cols, index) {
  let x = M;
  for (let i = 0; i < index; i += 1) x += cols[i].w;
  return x;
}

function drawTableHeader(doc, yy, cols, headerH) {
  // Light highlight fill + dark bold ink; thin top + bottom hairlines.
  doc.save();
  doc.rect(M, yy, CONTENT_W, headerH).fillColor(COLOR.panelAlt).fill();
  doc.restore();
  drawHRule(doc, M, M + CONTENT_W, yy, COLOR.borderHard);
  drawHRule(doc, M, M + CONTENT_W, yy + headerH, COLOR.borderHard);

  setText(doc, { font: "Helvetica-Bold", size: 8.5, color: COLOR.ink });
  cols.forEach((c, i) => {
    const x = colX(cols, i);
    const pad = c.align === "right" ? 4 : 5;
    doc.text(c.label, x + (c.align === "right" ? 0 : pad), yy + 6, {
      width: c.w - pad,
      align: c.align,
      characterSpacing: 0.3,
    });
  });
}

function drawRowFrame(doc, yy, h, zebra) {
  if (zebra) {
    doc.save();
    doc.rect(M, yy, CONTENT_W, h).fillColor(COLOR.zebra).fill();
    doc.restore();
  }
  drawHRule(doc, M, M + CONTENT_W, yy + h, COLOR.hairline);
}

function drawCell(doc, cols, index, yy, h, text, opts = {}) {
  const c = cols[index];
  const x = colX(cols, index);
  const pad = 5;
  const align = c.align;
  setText(doc, {
    font: opts.bold ? "Helvetica-Bold" : "Helvetica",
    size: opts.size || 8.5,
    color: opts.color || COLOR.inkSoft,
  });
  doc.text(String(text ?? ""), x + (align === "right" ? 0 : pad), yy + 6, {
    width: c.w - pad,
    align,
    height: h - 8,
    ellipsis: false,
  });
}

function drawItemTable(doc, yStart, lines, isNoQty) {
  const cols = isNoQty ? getColumnsNoQty() : getColumnsNormal();
  const headerH = 22;
  const rowMinH = 22;

  // outer table border
  let tableTop = yStart;
  drawTableHeader(doc, tableTop, cols, headerH);
  let y = tableTop + headerH;

  const pageBottom = PAGE.h - M - FOOTER_H - 4;
  const bottomReserve = isNoQty ? 130 : 200; // space for totals/terms/signature

  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i];
    const item = ln.item || {};
    const qty = Number(ln.qty);
    const rate = Number(ln.rate);
    const disc = Number(ln.discountPct);
    const gst = Number(ln.gstPct);
    const base = qty * rate * (1 - disc / 100);
    const lineAmt = base * (1 + gst / 100);

    const itemColIndex = cols.findIndex((c) => c.key === "item");
    const itemName = ln.isFree === true ? `${safe(item.itemName, "—")} (Free)` : safe(item.itemName, "—");

    // compute row height based on item description wrap
    setText(doc, { size: 8.5 });
    const itemHeight = doc.heightOfString(itemName, { width: cols[itemColIndex].w - 10 });
    const rowH = Math.max(rowMinH, Math.ceil(itemHeight) + 12);

    // page break — keep totals/terms/signature on the same page when possible
    if (y + rowH > pageBottom - bottomReserve && i < lines.length - 1) {
      // continue on next page only if more rows remain that would otherwise be cut
      doc.addPage();
      y = M;
      drawTableHeader(doc, y, cols, headerH);
      y += headerH;
    } else if (y + rowH > pageBottom) {
      doc.addPage();
      y = M;
      drawTableHeader(doc, y, cols, headerH);
      y += headerH;
    }

    drawRowFrame(doc, y, rowH, i % 2 === 1);

    // fill cells
    cols.forEach((c, idx) => {
      let txt = "";
      switch (c.key) {
        case "sr":
          txt = String(i + 1);
          break;
        case "item":
          txt = itemName;
          break;
        case "hsn":
          txt = safe(item.hsnCode, "—");
          break;
        case "qty":
          txt = fmtQty(qty);
          break;
        case "unit":
          txt = safe(item.unit, "—");
          break;
        case "rate":
          txt = fmtMoney(rate);
          break;
        case "disc":
          txt = `${fmtPct(disc)}`;
          break;
        case "gst":
          txt = `${fmtPct(gst)}`;
          break;
        case "amt":
          txt = fmtMoney(lineAmt);
          break;
        case "remarks":
          txt = ln.isFree === true ? "Free" : "";
          break;
        default:
          txt = "";
      }
      drawCell(doc, cols, idx, y, rowH, txt, { color: COLOR.ink });
    });

    y += rowH;
  }

  // closing bottom rule (thicker)
  drawHRule(doc, M, M + CONTENT_W, y, COLOR.borderHard);

  // outer left/right rules
  doc.save();
  doc.lineWidth(0.5).strokeColor(COLOR.borderHard);
  doc.moveTo(M, tableTop + headerH).lineTo(M, y).stroke();
  doc.moveTo(M + CONTENT_W, tableTop + headerH).lineTo(M + CONTENT_W, y).stroke();
  doc.restore();

  return y + 14;
}

/* --------------------------------- Totals --------------------------------- */

function drawTotals(doc, yStart, quotation, lines) {
  let gross = 0;
  let discount = 0;
  for (const ln of lines) {
    const q = Number(ln.qty);
    const r = Number(ln.rate);
    const d = Number(ln.discountPct);
    const g = q * r;
    gross += g;
    discount += g * (d / 100);
  }
  const taxable = Number(quotation.subtotal);
  const gstTotal = Number(quotation.gstTotal);
  const grand = Number(quotation.totalAmount);

  const boxW = 240;
  const boxX = M + CONTENT_W - boxW;
  const lineGap = 15;
  const rows = [
    ["Gross value (before discount)", fmtMoney(gross)],
    ["Less: Discount", fmtMoney(discount)],
    ["Taxable value", fmtMoney(taxable)],
    ["GST total", fmtMoney(gstTotal)],
  ];
  const boxPad = 10;
  const grandH = 22;
  const boxH = boxPad * 2 + rows.length * lineGap + 6 + grandH;

  // page break for totals if needed
  if (yStart + boxH + 90 > PAGE.h - M - FOOTER_H) {
    doc.addPage();
    yStart = M;
  }

  doc.save();
  doc
    .roundedRect(boxX, yStart, boxW, boxH, 4)
    .lineWidth(0.6)
    .strokeColor(COLOR.borderHard)
    .fillColor(COLOR.panel)
    .fillAndStroke();
  doc.restore();

  let ly = yStart + boxPad;
  rows.forEach(([label, val]) => {
    setText(doc, { size: 9, color: COLOR.muted });
    doc.text(label, boxX + boxPad, ly, { width: boxW - 100 });
    setText(doc, { font: "Helvetica-Bold", size: 9, color: COLOR.ink });
    doc.text(val, boxX + boxW - boxPad - 96, ly, { width: 92, align: "right" });
    ly += lineGap;
  });

  ly += 4;
  drawHRule(doc, boxX + boxPad, boxX + boxW - boxPad, ly, COLOR.borderHard);
  ly += 4;

  // grand total band — tightened, still focal but not dominant
  doc.save();
  doc
    .rect(boxX + boxPad - 2, ly, boxW - boxPad * 2 + 4, grandH - 4)
    .fillColor(COLOR.accent)
    .fill();
  setText(doc, { font: "Helvetica-Bold", size: 10, color: COLOR.accentInk });
  doc.text("GRAND TOTAL", boxX + boxPad, ly + 5, {
    width: boxW - 100,
    characterSpacing: 0.4,
  });
  setText(doc, { font: "Helvetica-Bold", size: 11, color: COLOR.accentInk });
  doc.text(`₹ ${fmtMoney(grand)}`, boxX + boxW - boxPad - 96, ly + 4, {
    width: 92,
    align: "right",
  });
  doc.restore();

  return yStart + boxH + 16;
}

/* --------------------------------- Terms ---------------------------------- */

function drawTerms(doc, yStart, quotation, isNoQty) {
  const validity = addDays(quotation.createdAt, DEFAULT_VALIDITY_DAYS);
  const customTerms = safe(quotation.terms);

  const defaultBullets = isNoQty
    ? [
        `Validity: This rate agreement is valid until ${fmtDate(validity)} or supersession by a newer approved rate, whichever is earlier.`,
        "Rates: Unit rates above are GST-exclusive unless explicitly stated. Applicable GST will be charged at the time of supply.",
        "Quantities: This document does NOT commit any specific quantity. Actual supply is governed by rolling requirement plans / individual purchase orders.",
        "Delivery & payment terms: As per individual purchase orders or master supply agreement.",
        "Disputes: Subject to local jurisdiction; refer to master agreement for arbitration.",
      ]
    : [
        `Validity: This quotation is valid until ${fmtDate(validity)}.`,
        "Pricing: Rates are quoted in INR and are GST-exclusive unless otherwise stated. GST will be charged extra at applicable rates.",
        "Delivery: Ex-works / FOB unless explicitly mentioned. Delivery schedule will be confirmed on receipt of confirmed PO.",
        "Payment terms: As mutually agreed and stated on the customer purchase order.",
        "Freight & Packing: Extra at actuals unless explicitly included.",
        "Order acceptance: A formal Purchase Order from the customer is required to convert this quotation into a sales order.",
      ];

  const sectionGap = 6;
  const headerH = 16;
  const bulletGap = 11;
  const bulletPad = 14;

  // page break if not enough room
  setText(doc, { size: 9 });
  const reservedH =
    headerH +
    (customTerms ? doc.heightOfString(customTerms, { width: CONTENT_W - bulletPad }) + 10 : 0) +
    defaultBullets.length * bulletGap +
    14;
  if (yStart + reservedH + 70 > PAGE.h - M - FOOTER_H) {
    doc.addPage();
    yStart = M;
  }

  // section title
  setText(doc, { font: "Helvetica-Bold", size: 10, color: COLOR.ink });
  doc.text("Commercial Terms & Conditions", M, yStart, { width: CONTENT_W, characterSpacing: 0.4 });
  let y = doc.y + 4;
  drawHRule(doc, M, M + CONTENT_W, y, COLOR.borderHard);
  y += sectionGap;

  // custom terms (from quotation.terms)
  if (customTerms) {
    setText(doc, { size: 9, color: COLOR.inkSoft });
    doc.text(customTerms, M, y, { width: CONTENT_W, lineGap: 2 });
    y = doc.y + 8;
    drawHRule(doc, M, M + CONTENT_W, y - 4, COLOR.hairline);
  }

  // default bullets
  setText(doc, { size: 8.5, color: COLOR.muted });
  for (const b of defaultBullets) {
    doc.text("•", M, y, { width: 10 });
    doc.text(b, M + bulletPad, y, { width: CONTENT_W - bulletPad, lineGap: 1 });
    y = doc.y + 3;
  }

  return y + 8;
}

/* ------------------------------- Signature -------------------------------- */

function drawSignature(doc, yStart, company) {
  const sigW = 220;
  const sigX = M + CONTENT_W - sigW;
  const stampH = 46;
  const blockH = 14 + stampH + 18 + 14;
  let y = Math.max(yStart, PAGE.h - M - FOOTER_H - blockH);

  if (y + blockH > PAGE.h - M - FOOTER_H) {
    doc.addPage();
    y = M;
  }

  setText(doc, { size: 8.5, color: COLOR.muted });
  doc.text(`For ${company.name}`, sigX, y, { width: sigW, align: "right" });

  const stampY = y + 14;

  // Signature image (aspect-preserving) OR a clean dashed sign-space when
  // no image is uploaded. We deliberately keep the dashed box even with a
  // signature so customers see a visual stamp/sign region.
  if (company.signaturePath && fs.existsSync(company.signaturePath)) {
    try {
      doc.image(company.signaturePath, sigX + sigW - 140, stampY, {
        fit: [140, stampH - 4],
        align: "right",
        valign: "center",
      });
    } catch (_e) {
      // fall through to plain dashed box
    }
  } else {
    doc.save();
    doc
      .roundedRect(sigX, stampY, sigW, stampH, 3)
      .lineWidth(0.5)
      .dash(2, { space: 2 })
      .strokeColor(COLOR.borderHard)
      .stroke();
    doc.restore();
    setText(doc, { size: 7.5, color: COLOR.mutedSoft });
    doc.text("Signature & Stamp", sigX, stampY + stampH / 2 - 4, {
      width: sigW,
      align: "center",
    });
  }

  let belowY = stampY + stampH + 4;
  if (company.signatoryName) {
    setText(doc, { font: "Helvetica-Bold", size: 9, color: COLOR.ink });
    doc.text(company.signatoryName, sigX, belowY, { width: sigW, align: "right" });
    belowY = doc.y + 1;
  }
  setText(doc, { size: 8.5, color: COLOR.muted });
  doc.text("Authorised Signatory", sigX, belowY, { width: sigW, align: "right" });
}

/* ----------------------------- Page chrome -------------------------------- */

/**
 * Subtle full-page border. Drawn inset from page edge so it never touches the
 * physical bleed and never crosses any content (content margin = M = 36pt,
 * frame inset = 18pt → 18pt of gap between frame and content gutter).
 */
function drawPageFrame(doc) {
  const inset = PAGE_FRAME.inset;
  doc.save();
  doc
    .lineWidth(PAGE_FRAME.thickness)
    .strokeColor(COLOR.borderHard)
    .roundedRect(
      inset,
      inset,
      PAGE.w - inset * 2,
      PAGE.h - inset * 2,
      PAGE_FRAME.radius,
    )
    .stroke();
  doc.restore();
}

function addPageChrome(doc, quotation, company) {
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = 0; i < total; i += 1) {
    doc.switchToPage(range.start + i);

    // Frame: drawn after content so it sits cleanly on top of any zebra fills
    // that brushed close to the content edge. Doesn't overlap content because
    // of the inset gap.
    drawPageFrame(doc);

    // Footer rule + meta strip
    const footerY = PAGE.h - M - FOOTER_H + 6;
    drawHRule(doc, M, M + CONTENT_W, footerY - 4, COLOR.hairline);
    setText(doc, { size: 7.5, color: COLOR.mutedSoft });
    const leftBits = [];
    if (quotation.quotationNo) leftBits.push(`Quotation ${quotation.quotationNo}`);
    if (company && company.name) leftBits.push(company.name);
    leftBits.push("Computer-generated document");
    doc.text(leftBits.join("   •   "), M, footerY, { width: CONTENT_W - 80 });
    doc.text(`Page ${i + 1} of ${total}`, M + CONTENT_W - 80, footerY, {
      width: 80,
      align: "right",
    });
  }
}

/* --------------------------------- Build ---------------------------------- */

/**
 * Build a customer-facing quotation PDF.
 *
 * UI/PDF presentation only — does NOT change calculations, approvals,
 * permissions, or workflow. Pricing, tax, validity rules, etc. are all read
 * from `quotation` and rendered as-is.
 *
 * NO_QTY (rate agreement) quotations omit Qty, Amount, and Grand Total per the
 * commercial rate-agreement product semantics. Hardcoded UI presentation only.
 *
 * @param {object} quotation Prisma quotation including `enquiry.customer.stateRef`,
 *   `lines.item`, and `flowTypeSnapshot`.
 * @param {object} [options]
 * @param {object} [options.company] Optional company branding override
 *   `{ name, address, gstin, state, phone, email, website, logoPath }`. When
 *   omitted, falls back to `COMPANY_*` env vars or visible placeholders.
 * @returns {Promise<Buffer>}
 */
function buildQuotationPdf(quotation, options = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: M,
      bufferPages: true,
      info: { Title: `Quotation ${quotation.quotationNo || quotation.id}` },
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      const company = resolveCompanyInfo(options);
      const customer = quotation.enquiry.customer;
      const isNoQty = quotation.flowTypeSnapshot === "NO_QTY";

      let y = M;
      y = drawHeaderBand(doc, y, company);
      y = drawDocumentTitle(doc, y, isNoQty);
      y = drawBillToAndMeta(doc, y, quotation, customer, isNoQty);
      if (isNoQty) {
        y = drawNoQtyBanner(doc, y);
      }
      y = drawItemTable(doc, y, quotation.lines, isNoQty);
      if (!isNoQty) {
        y = drawTotals(doc, y, quotation, quotation.lines);
      }
      y = drawTerms(doc, y, quotation, isNoQty);
      drawSignature(doc, y, company);

      addPageChrome(doc, quotation, company);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { buildQuotationPdf };
