const { resolvePurchaseIntraState } = require("./purchaseStateCompare");
const { TALLY_LEDGER_PATTERNS } = require("../config/tally");

function safeStr(v) {
  if (v == null) return "";
  return String(v);
}

function safeStrOrNull(v) {
  const t = safeStr(v).trim();
  return t ? t : null;
}

function fmtPct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "";
  const s = (Math.round(x * 100) / 100).toFixed(2);
  return s.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function ledgerAt(prefix, pct) {
  const p = fmtPct(pct);
  if (!prefix || !p) return null;
  return `${prefix} @${p}%`;
}

function safeNum(v, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function distinctSortedInts(vals) {
  const out = Array.from(new Set((Array.isArray(vals) ? vals : []).filter((v) => Number.isFinite(Number(v))).map((v) => Number(v))));
  out.sort((a, b) => a - b);
  return out;
}

/**
 * Map a Purchase Bill DB row into an export-ready structured payload.
 * This is mapping only (no tax recalculation; uses stored breakup fields).
 */
function mapPurchaseBillToTallyExportPayload({ bill, companyState }) {
  const supplier = bill?.supplier ?? null;

  const lines = Array.isArray(bill?.lines) ? bill.lines : [];

  const distinctGrnIds = distinctSortedInts(lines.map((l) => l?.grnId).filter((v) => v != null));
  const distinctRmPoIds = distinctSortedInts(lines.map((l) => l?.rmPoId).filter((v) => v != null));

  // Snapshot-first supplier state for stable intra/inter determination (avoid master drift).
  const supplierStateNameSnapshot = safeStrOrNull(bill?.supplierStateSnapshot) ?? null;
  const supplierStateCodeSnapshot = safeStrOrNull(bill?.supplierStateCodeSnapshot) ?? null;

  // Fallback to supplier master only if snapshots are missing.
  const supplierStateCodeFallback = supplier?.stateRef?.stateCode ?? supplier?.stateCode ?? null;
  const supplierStateNameFallback = supplier?.stateRef?.stateName ?? supplier?.state ?? null;

  const exportSupplierStateCode = supplierStateCodeSnapshot ?? safeStrOrNull(supplierStateCodeFallback) ?? null;
  const exportSupplierStateName = supplierStateNameSnapshot ?? safeStrOrNull(supplierStateNameFallback) ?? null;

  // Determine intra/inter using snapshot when available; fallback to legacy comparator only when snapshot missing.
  let taxIntraState = null;
  const companyStateCode = companyState?.companyStateRef?.stateCode ?? null;
  if (companyStateCode && exportSupplierStateCode) {
    taxIntraState = String(companyStateCode) === String(exportSupplierStateCode);
  } else {
    const cmp = resolvePurchaseIntraState({ company: companyState, supplier });
    taxIntraState = Boolean(cmp.intraState);
  }

  const distinctGstRates = Array.from(new Set(lines.map((l) => String(l?.gstRate ?? "").trim()).filter(Boolean)));
  if (distinctGstRates.length > 1) {
    const err = new Error(
      "Cannot export purchase bill because it contains multiple GST rates. Please export bills with a single GST rate in the current export mode.",
    );
    err.statusCode = 400;
    throw err;
  }
  const billGstRate = distinctGstRates.length === 1 ? safeNum(distinctGstRates[0], 0) : 0;
  const halfRate = billGstRate / 2;

  const purchaseLedger =
    taxIntraState === false
      ? ledgerAt(TALLY_LEDGER_PATTERNS.interstatePurchasePrefix, billGstRate)
      : ledgerAt(TALLY_LEDGER_PATTERNS.localPurchasePrefix, billGstRate);
  const cgstLedger = taxIntraState === true ? ledgerAt(TALLY_LEDGER_PATTERNS.inputCgstPrefix, halfRate) : null;
  const sgstLedger = taxIntraState === true ? ledgerAt(TALLY_LEDGER_PATTERNS.inputSgstPrefix, halfRate) : null;
  const igstLedger = taxIntraState === false ? ledgerAt(TALLY_LEDGER_PATTERNS.inputIgstPrefix, billGstRate) : null;

  const mappedLines = lines.map((ln) => {
    const item = ln.item ?? null;
    const itemUnitName = item?.unitRef?.unitName ?? null;
    const itemUnitText = safeStrOrNull(item?.unit);

    return {
      itemId: ln.itemId,
      itemName: safeStrOrNull(ln.itemNameSnapshot) ?? safeStrOrNull(item?.itemName),
      hsnCode: safeStrOrNull(ln.hsnCodeSnapshot) ?? safeStrOrNull(item?.hsnCode),
      gstRate: safeStrOrNull(ln.gstRate),
      unit: safeStrOrNull(ln.unitSnapshot) ?? itemUnitName ?? itemUnitText,
      unitName: itemUnitName,
      quantity: safeStrOrNull(ln.qty),
      rate: safeStrOrNull(ln.rate),
      baseAmount: safeStrOrNull(ln.basicAmount),
      gstAmount: safeStrOrNull(ln.gstAmount) ?? null,
      cgstAmount: safeStrOrNull(ln.cgstAmount),
      sgstAmount: safeStrOrNull(ln.sgstAmount),
      igstAmount: safeStrOrNull(ln.igstAmount),
      lineTotal: safeStrOrNull(ln.lineTotal),

      source: {
        grnId: ln.grnId ?? null,
        grnLineId: ln.grnLineId ?? null,
        rmPoId: ln.rmPoId ?? null,
        rmPoLineId: ln.rmPoLineId ?? null,
      },
    };
  });

  return {
    purchaseBillId: bill.id,
    voucherNo: safeStrOrNull(bill.billNo) ?? `PB-${bill.id}`,
    billNo: safeStrOrNull(bill.billNo),
    billDate: bill.billDate,
    dueDate: bill.dueDate ?? null,

    grnId: bill.grnId ?? null,
    distinctGrnIds,
    distinctRmPoIds,
    supplierStateSnapshot: exportSupplierStateName,
    supplierStateCodeSnapshot: exportSupplierStateCode,
    hasTemporaryTaxData: Boolean(bill?.hasTemporaryTaxData),

    company: {
      companyGstin: companyState?.companyGstin ?? null,
      companyStateName: companyState?.companyStateRef?.stateName ?? null,
      companyStateCode: companyState?.companyStateRef?.stateCode ?? null,
    },

    supplier: {
      supplierId: bill.supplierId,
      supplierName: safeStrOrNull(supplier?.name),
      supplierGstin: supplier?.gst ?? null,
      supplierStateName: exportSupplierStateName,
      supplierStateCode: exportSupplierStateCode,
    },

    tax: {
      taxIntraState: Boolean(taxIntraState),
      billGstRate: String(billGstRate || ""),
      totalCgst: safeStrOrNull(bill.totalCgst),
      totalSgst: safeStrOrNull(bill.totalSgst),
      totalIgst: safeStrOrNull(bill.totalIgst),
      subtotal: safeStrOrNull(bill.totalBasic),
      gstTotal: safeStrOrNull(bill.totalTax),
      totalAmount: safeStrOrNull(bill.netAmount),
    },

    tally: {
      ledgers: {
        purchase: purchaseLedger,
        cgst: cgstLedger,
        sgst: sgstLedger,
        igst: igstLedger,
      },
    },

    lines: mappedLines,
  };
}

module.exports = { mapPurchaseBillToTallyExportPayload };

