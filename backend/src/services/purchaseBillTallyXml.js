function xmlEscape(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fmtDateYYYYMMDD(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const yyyy = String(dt.getUTCFullYear()).padStart(4, "0");
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function n2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.00";
  return (Math.round(n * 100) / 100).toFixed(2);
}

function pickUnit(payloadLine) {
  return payloadLine?.unitName || payloadLine?.unit || "";
}

function assertNoTotalOrInfoLedger(name) {
  const t = String(name || "");
  if (/total/i.test(t) || /\binfo\b/i.test(t) || /summary/i.test(t)) {
    throw new Error("Invalid ledger detected in XML");
  }
}

function isBadSummaryLedgerName(name) {
  const t = String(name || "").toLowerCase();
  return t.includes("gst total") || t.includes("(info)") || t.includes(" info") || t.includes("summary");
}

function assertAllowedLedgerName(name, { allowParty = false } = {}) {
  const t = String(name || "").trim();
  if (!t) throw new Error("Tally XML: ledger name is missing.");
  assertNoTotalOrInfoLedger(t);
  if (isBadSummaryLedgerName(t)) {
    throw new Error(`Tally XML: summary ledger is not allowed: "${t}"`);
  }
  if (allowParty) return; // party ledger is dynamic (supplier master in Tally)
}

function extractLedgerNamesFromXml(xml) {
  const out = [];
  const re = /<LEDGERNAME>([\s\S]*?)<\/LEDGERNAME>/gi;
  let m;
  while ((m = re.exec(String(xml))) != null) {
    out.push(m[1]);
  }
  return out;
}

function splitAddressLines(address) {
  return String(address || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildAddressListXml(tagBase, lines) {
  if (!Array.isArray(lines) || !lines.length) return "";
  const listTag = `${tagBase}.LIST`;
  const itemTag = tagBase;
  return [
    `<${listTag}>`,
    ...lines.map((line) => `<${itemTag}>${xmlEscape(line)}</${itemTag}>`),
    `</${listTag}>`,
  ].join("");
}

/**
 * Supplier / supply-from / purchase source tags for Purchase voucher (GST informational).
 * Does not alter ledger structure.
 */
function buildCommercialVoucherXml(payload) {
  const registered = payload?.registeredSupplier ?? payload?.supplier ?? null;
  const supply = payload?.supplyFrom ?? null;
  const source = payload?.purchaseSource ?? null;
  const parts = [];

  const partyName = registered?.name || payload?.supplier?.supplierName;
  if (partyName) {
    parts.push(`<PARTYNAME>${xmlEscape(partyName)}</PARTYNAME>`);
  }

  const partyGstin = registered?.gstin || payload?.supplier?.supplierGstin;
  if (partyGstin) parts.push(`<PARTYGSTIN>${xmlEscape(partyGstin)}</PARTYGSTIN>`);

  const supplierLines = splitAddressLines(registered?.address || payload?.supplier?.supplierAddress);
  if (supplierLines.length) parts.push(buildAddressListXml("BASICBUYERADDRESS", supplierLines));

  const supplierState = registered?.stateName || payload?.supplier?.supplierStateName;
  if (supplierState) parts.push(`<STATENAME>${xmlEscape(supplierState)}</STATENAME>`);

  const posName = source?.stateName;
  if (posName) parts.push(`<PLACEOFSUPPLY>${xmlEscape(posName)}</PLACEOFSUPPLY>`);

  if (supply && !supply.sameAsRegistered) {
    const dispatchLabel = supply.label;
    if (dispatchLabel) parts.push(`<DISPATCHFROMNAME>${xmlEscape(dispatchLabel)}</DISPATCHFROMNAME>`);

    const dispatchLines = splitAddressLines(supply.address);
    if (dispatchLines.length) parts.push(buildAddressListXml("DISPATCHFROMADDRESS", dispatchLines));

    if (supply.stateName) parts.push(`<DISPATCHFROMSTATENAME>${xmlEscape(supply.stateName)}</DISPATCHFROMSTATENAME>`);
    if (supply.gstin) parts.push(`<DISPATCHFROMGSTIN>${xmlEscape(supply.gstin)}</DISPATCHFROMGSTIN>`);
  }

  return parts.join("");
}

/**
 * Build a first-pass Tally XML voucher draft from the export payload.
 * This is intentionally minimal (no ledger mapping automation yet).
 */
function buildPurchaseBillTallyXml(payload) {
  const voucherNo = payload?.voucherNo || `PB-${payload?.purchaseBillId ?? ""}`;
  const voucherDate = fmtDateYYYYMMDD(payload?.billDate);
  const partyName = payload?.supplier?.supplierName || payload?.registeredSupplier?.name || "Supplier";

  const totalAmount = n2(payload?.tax?.totalAmount);
  const taxable = n2(payload?.tax?.subtotal);
  const cgstTotal = n2(payload?.tax?.totalCgst);
  const sgstTotal = n2(payload?.tax?.totalSgst);
  const igstTotal = n2(payload?.tax?.totalIgst);

  const lines = Array.isArray(payload?.lines) ? payload.lines : [];

  const purchaseLedger = payload?.tally?.ledgers?.purchase ?? null;
  const cgstLedger = payload?.tally?.ledgers?.cgst ?? null;
  const sgstLedger = payload?.tally?.ledgers?.sgst ?? null;
  const igstLedger = payload?.tally?.ledgers?.igst ?? null;

  // --- Preflight totals ---
  const baseSum = lines.reduce((s, ln) => s + Number(ln?.baseAmount ?? 0), 0);
  const lineCgstSum = lines.reduce((s, ln) => s + Number(ln?.cgstAmount ?? 0), 0);
  const lineSgstSum = lines.reduce((s, ln) => s + Number(ln?.sgstAmount ?? 0), 0);
  const lineIgstSum = lines.reduce((s, ln) => s + Number(ln?.igstAmount ?? 0), 0);
  const lineTotalSum = lines.reduce((s, ln) => s + Number(ln?.lineTotal ?? 0), 0);
  const expectedTax = Number(payload?.tax?.gstTotal ?? 0);
  const expectedNet = Number(payload?.tax?.totalAmount ?? 0);
  const expectedCgst = Number(payload?.tax?.totalCgst ?? 0);
  const expectedSgst = Number(payload?.tax?.totalSgst ?? 0);
  const expectedIgst = Number(payload?.tax?.totalIgst ?? 0);
  const eps = 0.02;
  if (Math.abs(baseSum - Number(taxable)) > eps) {
    throw new Error(
      `Tally XML: taxable/basic mismatch (lines=${n2(baseSum)} vs bill=${taxable}). Refusing to generate XML.`,
    );
  }
  if (Math.abs(lineCgstSum - expectedCgst) > 0.05) {
    throw new Error(
      `Tally XML: CGST mismatch (lines=${n2(lineCgstSum)} vs bill=${n2(expectedCgst)}). Refusing to generate XML.`,
    );
  }
  if (Math.abs(lineSgstSum - expectedSgst) > 0.05) {
    throw new Error(
      `Tally XML: SGST mismatch (lines=${n2(lineSgstSum)} vs bill=${n2(expectedSgst)}). Refusing to generate XML.`,
    );
  }
  if (Math.abs(lineIgstSum - expectedIgst) > 0.05) {
    throw new Error(
      `Tally XML: IGST mismatch (lines=${n2(lineIgstSum)} vs bill=${n2(expectedIgst)}). Refusing to generate XML.`,
    );
  }
  if (Math.abs(baseSum + expectedTax - expectedNet) > 0.05) {
    throw new Error(
      `Tally XML: totals mismatch (basic+tax=${n2(baseSum + expectedTax)} vs net=${totalAmount}). Refusing to generate XML.`,
    );
  }
  if (Math.abs(lineTotalSum - expectedNet) > 0.05) {
    throw new Error(
      `Tally XML: line total mismatch (lines=${n2(lineTotalSum)} vs bill=${n2(expectedNet)}). Refusing to generate XML.`,
    );
  }

  // Temporary debug output (requested)
  console.log("[tally-xml] voucher", {
    vchType: "Purchase",
    voucherNo,
    party: { name: partyName, amount: `-${totalAmount}`, isDeemedPositive: "Yes" },
    purchaseLedger: { name: purchaseLedger, amount: taxable, isDeemedPositive: "No" },
    taxes: {
      cgst: { amount: cgstTotal, isDeemedPositive: "No" },
      sgst: { amount: sgstTotal, isDeemedPositive: "No" },
      igst: { amount: igstTotal, isDeemedPositive: "No" },
    },
    inventoryLines: lines.map((ln) => ({
      item: ln.itemName,
      qty: ln.quantity,
      unit: pickUnit(ln),
      rate: ln.rate,
      baseAmount: n2(ln.baseAmount),
      inventoryAmount: n2(ln.baseAmount),
      accountingAllocation: { ledger: purchaseLedger, amount: n2(ln.baseAmount) },
    })),
    expectedNet: totalAmount,
  });

  const inventoryEntries = lines
    .map((ln) => {
      const itemName = ln.itemName || `Item-${ln.itemId ?? ""}`;
      const qty = ln.quantity || "0";
      const unit = pickUnit(ln);
      const rate = ln.rate || "0";
      const base = n2(ln.baseAmount);
      // Purchase voucher invoice mode: show item values positive (purchase side).
      const amt = base;

      return [
        "<ALLINVENTORYENTRIES.LIST>",
        `<STOCKITEMNAME>${xmlEscape(itemName)}</STOCKITEMNAME>`,
        `<RATE>${xmlEscape(rate)}${unit ? `/${xmlEscape(unit)}` : ""}</RATE>`,
        `<ACTUALQTY>${xmlEscape(qty)}${unit ? ` ${xmlEscape(unit)}` : ""}</ACTUALQTY>`,
        `<BILLEDQTY>${xmlEscape(qty)}${unit ? ` ${xmlEscape(unit)}` : ""}</BILLEDQTY>`,
        `<AMOUNT>${xmlEscape(amt)}</AMOUNT>`,
        // Invoice-style accounting: allocate item value to purchase ledger here,
        // so we don't double-post the basic amount via a separate purchase ledger entry.
        "<ACCOUNTINGALLOCATIONS.LIST>",
        `<LEDGERNAME>${xmlEscape(purchaseLedger)}</LEDGERNAME>`,
        "<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>",
        `<AMOUNT>${xmlEscape(amt)}</AMOUNT>`,
        "</ACCOUNTINGALLOCATIONS.LIST>",
        "</ALLINVENTORYENTRIES.LIST>",
      ]
        .filter(Boolean)
        .join("");
    })
    .join("");

  // Minimal ledger entries draft: party + purchase + tax ledgers
  // (Placeholders, to be refined in Step 14)
  assertAllowedLedgerName(partyName, { allowParty: true });
  assertAllowedLedgerName(purchaseLedger);
  if (cgstLedger) assertAllowedLedgerName(cgstLedger);
  if (sgstLedger) assertAllowedLedgerName(sgstLedger);
  if (igstLedger) assertAllowedLedgerName(igstLedger);

  const ledgerEntries = [
    // Party (credit)
    [
      "<LEDGERENTRIES.LIST>",
      `<LEDGERNAME>${xmlEscape(partyName)}</LEDGERNAME>`,
      "<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>",
      `<AMOUNT>${xmlEscape(`-${totalAmount}`)}</AMOUNT>`,
      "</LEDGERENTRIES.LIST>",
    ].join(""),
    // Tax ledgers (debit)
    cgstTotal !== "0.00"
      ? [
          "<LEDGERENTRIES.LIST>",
          `<LEDGERNAME>${xmlEscape(cgstLedger)}</LEDGERNAME>`,
          "<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>",
          `<AMOUNT>${xmlEscape(cgstTotal)}</AMOUNT>`,
          "</LEDGERENTRIES.LIST>",
        ].join("")
      : "",
    sgstTotal !== "0.00"
      ? [
          "<LEDGERENTRIES.LIST>",
          `<LEDGERNAME>${xmlEscape(sgstLedger)}</LEDGERNAME>`,
          "<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>",
          `<AMOUNT>${xmlEscape(sgstTotal)}</AMOUNT>`,
          "</LEDGERENTRIES.LIST>",
        ].join("")
      : "",
    igstTotal !== "0.00"
      ? [
          "<LEDGERENTRIES.LIST>",
          `<LEDGERNAME>${xmlEscape(igstLedger)}</LEDGERNAME>`,
          "<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>",
          `<AMOUNT>${xmlEscape(igstTotal)}</AMOUNT>`,
          "</LEDGERENTRIES.LIST>",
        ].join("")
      : "",
  ]
    .filter(Boolean)
    .join("");

  // Guard: this mapping must produce a normal purchase voucher (net should be positive in payload).
  if (Number(expectedNet) <= 0) {
    throw new Error("Tally XML: net amount must be positive for purchase voucher export.");
  }

  const narrationParts = [
    payload?.billNo ? `BillNo:${payload.billNo}` : null,
    Array.isArray(payload?.distinctGrnIds) && payload.distinctGrnIds.length
      ? `GRN:${payload.distinctGrnIds.join(",")}`
      : payload?.grnId != null
        ? `GRN:${payload.grnId}`
        : null,
    Array.isArray(payload?.distinctRmPoIds) && payload.distinctRmPoIds.length ? `RMPO:${payload.distinctRmPoIds.join(",")}` : null,
    payload?.tax?.taxIntraState === true ? "IntraState" : "InterState",
    payload?.company?.companyStateCode ? `CoState:${payload.company.companyStateCode}` : null,
    payload?.purchaseSource?.stateCode
      ? `SrcState:${payload.purchaseSource.stateCode}`
      : payload?.supplierStateCodeSnapshot
        ? `SuppState:${payload.supplierStateCodeSnapshot}`
        : payload?.supplier?.supplierStateCode
          ? `SuppState:${payload.supplier.supplierStateCode}`
          : null,
    payload?.supplyFrom?.label && !payload?.supplyFrom?.sameAsRegistered
      ? `SupplyFrom:${payload.supplyFrom.label}`
      : null,
  ].filter(Boolean);
  const narration = narrationParts.join(" | ").slice(0, 240);

  // Balance check: -net + base + tax = 0 (voucher must balance).
  const taxSum = Number(payload?.tax?.gstTotal ?? 0);
  const ledgerNet = -expectedNet + baseSum + taxSum;
  if (Math.abs(ledgerNet) > 0.05) {
    throw new Error("Tally XML: voucher does not balance. Refusing to generate XML.");
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<ENVELOPE>",
    "<HEADER>",
    "<TALLYREQUEST>Import Data</TALLYREQUEST>",
    "</HEADER>",
    "<BODY>",
    "<IMPORTDATA>",
    "<REQUESTDESC>",
    "<REPORTNAME>Vouchers</REPORTNAME>",
    "</REQUESTDESC>",
    "<REQUESTDATA>",
    "<TALLYMESSAGE>",
    '<VOUCHER VCHTYPE="Purchase" ACTION="Create">',
    "<VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>",
    "<ISINVOICE>Yes</ISINVOICE>",
    "<PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>",
    `<DATE>${xmlEscape(voucherDate)}</DATE>`,
    `<VOUCHERNUMBER>${xmlEscape(voucherNo)}</VOUCHERNUMBER>`,
    `<PARTYLEDGERNAME>${xmlEscape(partyName)}</PARTYLEDGERNAME>`,
    buildCommercialVoucherXml(payload),
    narration ? `<NARRATION>${xmlEscape(narration)}</NARRATION>` : "",
    inventoryEntries,
    ledgerEntries,
    "</VOUCHER>",
    "</TALLYMESSAGE>",
    "</REQUESTDATA>",
    "</IMPORTDATA>",
    "</BODY>",
    "</ENVELOPE>",
  ]
    .filter(Boolean)
    .join("");

  const ledgerNames = extractLedgerNamesFromXml(xml).map((x) => String(x).trim());
  console.info("[tally-xml][purchase] ledger-preflight", {
    purchaseBillId: payload?.purchaseBillId ?? null,
    ledgers: ledgerNames,
  });
  if (ledgerNames.some((ln) => /^GST\s+Total\s*\(Info\)$/i.test(ln))) {
    throw new Error('Tally XML: "GST Total (Info)" ledger is not allowed in export.');
  }

  // Hard safety: Purchase Bill XML must reference only Party + Purchase + Input tax ledgers.
  const allowed = new Set(
    [partyName, purchaseLedger, cgstLedger, sgstLedger, igstLedger]
      .filter(Boolean)
      .map((x) => xmlEscape(String(x))),
  );
  for (const ln of ledgerNames) {
    if (isBadSummaryLedgerName(ln) || /total/i.test(ln) || /\binfo\b/i.test(ln) || /summary/i.test(ln)) {
      throw new Error(`Tally XML: summary/info ledger is not allowed in export: "${ln}"`);
    }
    if (!allowed.has(ln)) {
      throw new Error(`Tally XML: unexpected ledger referenced in Purchase Bill export: "${ln}"`);
    }
  }
  return xml;
}

function extractTallyMessageBody(xml) {
  const m = String(xml).match(/<TALLYMESSAGE>([\s\S]*?)<\/TALLYMESSAGE>/i);
  if (!m) throw new Error("Invalid Tally XML structure");
  return m[1];
}

/** Combine multiple purchase bill vouchers into one Tally import envelope. */
function buildPurchaseBillTallyBulkXml(payloads) {
  if (!Array.isArray(payloads) || !payloads.length) {
    throw new Error("No purchase bills to export");
  }
  if (payloads.length === 1) {
    return buildPurchaseBillTallyXml(payloads[0]);
  }
  const bodies = payloads.map((p) => extractTallyMessageBody(buildPurchaseBillTallyXml(p)));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<ENVELOPE>",
    "<HEADER>",
    "<TALLYREQUEST>Import Data</TALLYREQUEST>",
    "</HEADER>",
    "<BODY>",
    "<IMPORTDATA>",
    "<REQUESTDESC>",
    "<REPORTNAME>Vouchers</REPORTNAME>",
    "</REQUESTDESC>",
    "<REQUESTDATA>",
    ...bodies.map((b) => `<TALLYMESSAGE>${b}</TALLYMESSAGE>`),
    "</REQUESTDATA>",
    "</IMPORTDATA>",
    "</BODY>",
    "</ENVELOPE>",
  ].join("");
}

module.exports = { buildPurchaseBillTallyXml, buildCommercialVoucherXml, buildPurchaseBillTallyBulkXml };

