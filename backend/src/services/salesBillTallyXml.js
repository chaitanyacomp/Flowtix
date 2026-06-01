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

function isBadSummaryLedgerName(name) {
  const t = String(name || "").toLowerCase();
  return t.includes("gst total") || t.includes("(info)") || t.includes(" info") || t.includes("summary");
}

function assertAllowedLedgerName(name, { allowParty = false } = {}) {
  const t = String(name || "").trim();
  if (!t) throw new Error("Tally XML: ledger name is missing.");
  // Party ledger is dynamic (customer master in Tally). Do not apply summary-ledger heuristics to party names.
  if (allowParty) return;
  if (isBadSummaryLedgerName(t)) {
    throw new Error(`Tally XML: summary ledger is not allowed: "${t}"`);
  }
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

function fmtPctCompact(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return "";
  const s = (Math.round(x * 100) / 100).toFixed(2);
  return s.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
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
 * Buyer / consignee / POS tags for Sales voucher (Release 3.0 GST fields).
 * Does not alter ledger structure — informational only.
 */
function buildCommercialVoucherXml(payload) {
  const billTo = payload?.billTo ?? null;
  const shipTo = payload?.shipTo ?? null;
  const pos = payload?.placeOfSupply ?? null;
  const parts = [];

  const partyName = billTo?.name || payload?.customer?.customerName;
  if (partyName) parts.push(`<PARTYNAME>${xmlEscape(partyName)}</PARTYNAME>`);

  const partyGstin = billTo?.gstin || payload?.customer?.customerGstin;
  if (partyGstin) parts.push(`<PARTYGSTIN>${xmlEscape(partyGstin)}</PARTYGSTIN>`);

  const buyerLines = splitAddressLines(billTo?.address);
  if (buyerLines.length) parts.push(buildAddressListXml("BASICBUYERADDRESS", buyerLines));

  const buyerState = billTo?.stateName || payload?.customer?.customerStateName;
  if (buyerState) parts.push(`<STATENAME>${xmlEscape(buyerState)}</STATENAME>`);

  const posName = pos?.stateName;
  if (posName) parts.push(`<PLACEOFSUPPLY>${xmlEscape(posName)}</PLACEOFSUPPLY>`);

  if (shipTo && !shipTo.sameAsBillTo) {
    const consigneeLabel = shipTo.label;
    if (consigneeLabel) parts.push(`<CONSIGNEEMAILINGNAME>${xmlEscape(consigneeLabel)}</CONSIGNEEMAILINGNAME>`);

    const shipLines = splitAddressLines(shipTo.address);
    if (shipLines.length) parts.push(buildAddressListXml("BASICFINALDESTINATION", shipLines));

    if (shipTo.stateName) parts.push(`<CONSIGNEESTATENAME>${xmlEscape(shipTo.stateName)}</CONSIGNEESTATENAME>`);
    if (shipTo.gstin) parts.push(`<CONSIGNEEGSTIN>${xmlEscape(shipTo.gstin)}</CONSIGNEEGSTIN>`);
  }

  return parts.join("");
}

function buildStockItemMasterXml(line, { todayDateYYYYMMDD, action }) {
  try {
    // SAFE DATA HANDLING (MANDATORY)
    const itemName = String(line?.itemName || "").trim();
    const hsnCode = String(line?.hsnCode || "").toString().trim();
    const rawGstRate = Number(line?.gstRate || 0);
    const gstRate = Number.isFinite(rawGstRate) && rawGstRate > 0 ? rawGstRate : 0;

    const cgst = gstRate > 0 ? gstRate / 2 : 0;
    const sgst = gstRate > 0 ? gstRate / 2 : 0;

    if (!itemName) return "";

    console.info("[tally-xml][stockitem]", { itemName, hsnCode, gstRate });

    const taxability = gstRate > 0 ? "Taxable" : "Exempt";
    const gstRateStr = fmtPctCompact(gstRate);
    const cgstStr = fmtPctCompact(cgst);
    const sgstStr = fmtPctCompact(sgst);

    const xml = [
      "<TALLYMESSAGE>",
      `<STOCKITEM NAME="${xmlEscape(itemName)}" ACTION="${xmlEscape(action)}">`,
      `<NAME>${xmlEscape(itemName)}</NAME>`,
      "<GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE>",
      "<GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>",
      `<HSNCODE>${xmlEscape(hsnCode)}</HSNCODE>`,
      "<GSTDETAILS.LIST>",
      `<APPLICABLEFROM>${xmlEscape(todayDateYYYYMMDD)}</APPLICABLEFROM>`,
      "<GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE>",
      `<TAXABILITY>${xmlEscape(taxability)}</TAXABILITY>`,
      "<STATEWISEDETAILS.LIST>",
      "<STATENAME>Any</STATENAME>",
      gstRate > 0
        ? [
            "<RATEDETAILS.LIST>",
            "<GSTRATEDUTYHEAD>Integrated Tax</GSTRATEDUTYHEAD>",
            "<GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE>",
            `<GSTRATE>${xmlEscape(gstRateStr)}</GSTRATE>`,
            "</RATEDETAILS.LIST>",
            "<RATEDETAILS.LIST>",
            "<GSTRATEDUTYHEAD>Central Tax</GSTRATEDUTYHEAD>",
            "<GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE>",
            `<GSTRATE>${xmlEscape(cgstStr)}</GSTRATE>`,
            "</RATEDETAILS.LIST>",
            "<RATEDETAILS.LIST>",
            "<GSTRATEDUTYHEAD>State Tax</GSTRATEDUTYHEAD>",
            "<GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE>",
            `<GSTRATE>${xmlEscape(sgstStr)}</GSTRATE>`,
            "</RATEDETAILS.LIST>",
          ].join("")
        : "",
      "</STATEWISEDETAILS.LIST>",
      "</GSTDETAILS.LIST>",
      "</STOCKITEM>",
      "</TALLYMESSAGE>",
    ]
      .filter(Boolean)
      .join("");

    if (itemName.trim().toLowerCase() === "cap") {
      // Required diagnostic: print exact Stock Item XML for Cap.
      // eslint-disable-next-line no-console
      console.log("[tally-xml][stockitem] Cap master XML:", xml);
    }

    return xml;
  } catch (err) {
    console.error("[tally-xml][stockitem-error]", err, line);
    return "";
  }
}

function buildStockItemMasterMessages(payload) {
  let stockXml = "";
  try {
    const lines = Array.isArray(payload?.lines) ? payload.lines : [];

    // PREVENT DUPLICATES
    const uniqueItems = new Map();
    lines.forEach((l) => {
      if (l?.itemName) uniqueItems.set(String(l.itemName), l);
    });

    const todayDateYYYYMMDD = fmtDateYYYYMMDD(new Date());

    stockXml = Array.from(uniqueItems.values())
      .map((ln) => {
        const createXml = buildStockItemMasterXml(ln, { todayDateYYYYMMDD, action: "Create" });
        const alterXml = buildStockItemMasterXml(ln, { todayDateYYYYMMDD, action: "Alter" });
        return createXml + alterXml;
      })
      .join("");
  } catch (e) {
    console.error("[tally-xml][fatal]", e);
    stockXml = "";
  }
  return stockXml;
}

/**
 * Sales voucher XML (invoice-style).
 * Keeps it operational + minimal: party ledger + inventory lines + tax ledgers.
 */
function buildSalesBillTallyXml(payload) {
  const voucherNo = payload?.voucherNo || `SB-${payload?.salesBillId ?? ""}`;
  const voucherDate = fmtDateYYYYMMDD(payload?.billDate);
  const partyName = payload?.customer?.customerName || "Customer";

  // Sales voucher sign convention (as required):
  // - Party ledger: +net (debit)
  // - Inventory amount: -base
  // - Output tax ledgers: -tax (credit)
  const totalAmount = n2(Math.abs(Number(payload?.tax?.totalAmount ?? 0)));
  const taxable = n2(Math.abs(Number(payload?.tax?.subtotal ?? 0)));
  const cgstTotal = n2(Math.abs(Number(payload?.tax?.totalCgst ?? 0)));
  const sgstTotal = n2(Math.abs(Number(payload?.tax?.totalSgst ?? 0)));
  const igstTotal = n2(Math.abs(Number(payload?.tax?.totalIgst ?? 0)));

  const lines = Array.isArray(payload?.lines) ? payload.lines : [];

  assertAllowedLedgerName(partyName, { allowParty: true });
  const salesLedger = payload?.tally?.ledgers?.sales ?? null;
  const cgstLedger = payload?.tally?.ledgers?.cgst ?? null;
  const sgstLedger = payload?.tally?.ledgers?.sgst ?? null;
  const igstLedger = payload?.tally?.ledgers?.igst ?? null;
  assertAllowedLedgerName(salesLedger);
  if (cgstLedger) assertAllowedLedgerName(cgstLedger);
  if (sgstLedger) assertAllowedLedgerName(sgstLedger);
  if (igstLedger) assertAllowedLedgerName(igstLedger);

  // Enforce "either CGST+SGST or IGST" and ensure we never post summary ledgers.
  const taxIntraState = payload?.tax?.taxIntraState;
  if (taxIntraState === true) {
    if (igstTotal !== "0.00") throw new Error("Sales Tally XML: intra-state bill cannot have IGST.");
    if (igstLedger) throw new Error("Sales Tally XML: intra-state bill cannot have IGST ledger.");
    if ((cgstTotal !== "0.00" && !cgstLedger) || (sgstTotal !== "0.00" && !sgstLedger)) {
      throw new Error("Sales Tally XML: intra-state tax ledger missing.");
    }
  } else if (taxIntraState === false) {
    if (cgstTotal !== "0.00" || sgstTotal !== "0.00") throw new Error("Sales Tally XML: inter-state bill cannot have CGST/SGST.");
    if (cgstLedger || sgstLedger) throw new Error("Sales Tally XML: inter-state bill cannot have CGST/SGST ledgers.");
    if (igstTotal !== "0.00" && !igstLedger) throw new Error("Sales Tally XML: inter-state IGST ledger missing.");
  }

  const inventoryEntries = lines
    .map((ln) => {
      const itemName = ln.itemName || `Item-${ln.itemId ?? ""}`;
      const qty = ln.quantity || "0";
      const unit = ln.unit || "";
      const rate = ln.rate || "0";
      const base = Math.abs(Number(ln.baseAmount ?? 0));
      const amt = n2(-base);
      return [
        "<ALLINVENTORYENTRIES.LIST>",
        `<STOCKITEMNAME>${xmlEscape(itemName)}</STOCKITEMNAME>`,
        `<RATE>${xmlEscape(rate)}${unit ? `/${xmlEscape(unit)}` : ""}</RATE>`,
        `<ACTUALQTY>${xmlEscape(qty)}${unit ? ` ${xmlEscape(unit)}` : ""}</ACTUALQTY>`,
        `<BILLEDQTY>${xmlEscape(qty)}${unit ? ` ${xmlEscape(unit)}` : ""}</BILLEDQTY>`,
        `<AMOUNT>${xmlEscape(amt)}</AMOUNT>`,
        "<ACCOUNTINGALLOCATIONS.LIST>",
        `<LEDGERNAME>${xmlEscape(salesLedger)}</LEDGERNAME>`,
        "<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>",
        `<AMOUNT>${xmlEscape(amt)}</AMOUNT>`,
        "</ACCOUNTINGALLOCATIONS.LIST>",
        "</ALLINVENTORYENTRIES.LIST>",
      ].join("");
    })
    .join("");

  const ledgerEntries = [
    // Party (debit)
    [
      "<LEDGERENTRIES.LIST>",
      `<LEDGERNAME>${xmlEscape(partyName)}</LEDGERNAME>`,
      "<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>",
      `<AMOUNT>${xmlEscape(totalAmount)}</AMOUNT>`,
      "</LEDGERENTRIES.LIST>",
    ].join(""),
    // Tax ledgers (credit) – output tax
    cgstTotal !== "0.00"
      ? [
          "<LEDGERENTRIES.LIST>",
          `<LEDGERNAME>${xmlEscape(cgstLedger)}</LEDGERNAME>`,
          "<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>",
          `<AMOUNT>${xmlEscape(`-${cgstTotal}`)}</AMOUNT>`,
          "</LEDGERENTRIES.LIST>",
        ].join("")
      : "",
    sgstTotal !== "0.00"
      ? [
          "<LEDGERENTRIES.LIST>",
          `<LEDGERNAME>${xmlEscape(sgstLedger)}</LEDGERNAME>`,
          "<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>",
          `<AMOUNT>${xmlEscape(`-${sgstTotal}`)}</AMOUNT>`,
          "</LEDGERENTRIES.LIST>",
        ].join("")
      : "",
    igstTotal !== "0.00"
      ? [
          "<LEDGERENTRIES.LIST>",
          `<LEDGERNAME>${xmlEscape(igstLedger)}</LEDGERNAME>`,
          "<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>",
          `<AMOUNT>${xmlEscape(`-${igstTotal}`)}</AMOUNT>`,
          "</LEDGERENTRIES.LIST>",
        ].join("")
      : "",
  ]
    .filter(Boolean)
    .join("");

  // Preflight guard: base+tax must match net.
  const baseSum = lines.reduce((s, ln) => s + Math.abs(Number(ln?.baseAmount ?? 0)), 0);
  const taxSum = Math.abs(Number(payload?.tax?.gstTotal ?? 0));
  const net = Math.abs(Number(payload?.tax?.totalAmount ?? 0));
  const eps = 0.05;
  if (Math.abs(baseSum - Number(taxable)) > eps || Math.abs(baseSum + taxSum - net) > eps) {
    throw new Error("Sales Tally XML: totals mismatch. Refusing to generate XML.");
  }

  // Balance check (ledger entries must sum to 0): +party -base -taxes
  const ledgerNet = net - baseSum - taxSum;
  if (Math.abs(ledgerNet) > 0.05) {
    throw new Error("Sales Tally XML: voucher does not balance. Refusing to generate XML.");
  }

  const isNoQty = String(payload?.meta?.orderType ?? "").toUpperCase() === "NO_QTY";
  const narrationParts = [
    payload?.meta?.salesOrderNo ? payload.meta.salesOrderNo : null,
    isNoQty ? "No Qty SO" : null,
    payload?.dispatchNo ? `Dispatch Ref ${payload.dispatchNo}` : null,
    isNoQty && payload?.meta?.cycleId ? `Cycle ${payload.meta.cycleId}` : null,
    payload?.billNo ? `BillNo:${payload.billNo}` : null,
  ].filter(Boolean);
  const narration = narrationParts.join(" | ").slice(0, 240);

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
    buildStockItemMasterMessages(payload),
    "<TALLYMESSAGE>",
    '<VOUCHER VCHTYPE="Sales" ACTION="Create">',
    "<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>",
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
  ].join("");

  // Hard safety: never emit informational GST summary ledgers.
  if (/<LEDGERNAME>\s*GST\s+Total\s*\(Info\)\s*<\/LEDGERNAME>/i.test(xml)) {
    throw new Error('Tally XML: "GST Total (Info)" ledger is not allowed in export.');
  }

  // Hard safety: Sales Bill XML must reference only Party + Sales + Output tax ledgers.
  const allowed = new Set(
    [partyName, salesLedger, cgstLedger, sgstLedger, igstLedger]
      .filter(Boolean)
      .map((x) => xmlEscape(String(x))),
  );
  const ledgerNames = extractLedgerNamesFromXml(xml).map((x) => String(x));
  for (const ln of ledgerNames) {
    // ln is already escaped inside XML, so we compare escaped representations.
    // xmlEscape does not alter parentheses/spaces, so our summary-ledger detector remains effective.
    if (isBadSummaryLedgerName(ln)) {
      throw new Error(`Tally XML: summary ledger is not allowed in export: "${ln}"`);
    }
    if (!allowed.has(ln)) {
      throw new Error(`Tally XML: unexpected ledger referenced in Sales Bill export: "${ln}"`);
    }
  }
  return xml;
}

module.exports = {
  buildSalesBillTallyXml,
  buildCommercialVoucherXml,
  splitAddressLines,
};

