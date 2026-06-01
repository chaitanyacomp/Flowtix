const { TALLY_LEDGER_PATTERNS } = require("../config/tally");
const { resolvePurchaseBillIntraState } = require("./purchaseCommercialAddress");

function safeStr(v) {
  if (v == null) return "";
  return String(v);
}

function safeStrOrNull(v) {
  const t = safeStr(v).trim();
  return t ? t : null;
}

function trimSnap(v) {
  return safeStr(v).trim();
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
  const out = Array.from(
    new Set((Array.isArray(vals) ? vals : []).filter((v) => Number.isFinite(Number(v))).map((v) => Number(v))),
  );
  out.sort((a, b) => a - b);
  return out;
}

function hasSupplyLocationSnapshots(bill) {
  return Boolean(
    trimSnap(bill?.supplyLocationLabelSnapshot) ||
      trimSnap(bill?.supplyLocationAddressSnapshot) ||
      trimSnap(bill?.supplyLocationGstinSnapshot) ||
      trimSnap(bill?.supplyLocationStateNameSnapshot) ||
      trimSnap(bill?.supplyLocationStateCodeSnapshot),
  );
}

/**
 * Resolve registered supplier / supply-from / purchase source for Tally export.
 * Snapshot-first; legacy supplierState* and live master as last resort.
 */
function resolvePurchaseBillCommercialForTallyExport(bill, supplier) {
  const partyName =
    safeStrOrNull(bill?.supplierNameSnapshot) ?? safeStrOrNull(supplier?.name) ?? null;

  const registeredGstin =
    safeStrOrNull(bill?.supplierRegisteredGstinSnapshot) ?? safeStrOrNull(supplier?.gst) ?? null;
  const registeredAddress =
    trimSnap(bill?.supplierRegisteredAddressSnapshot) || trimSnap(supplier?.address) || "";
  const registeredStateName =
    safeStrOrNull(bill?.supplierRegisteredStateNameSnapshot) ??
    safeStrOrNull(bill?.supplierStateSnapshot) ??
    safeStrOrNull(supplier?.stateRef?.stateName) ??
    safeStrOrNull(supplier?.state);
  const registeredStateCode =
    safeStrOrNull(bill?.supplierRegisteredStateCodeSnapshot) ??
    safeStrOrNull(bill?.supplierStateCodeSnapshot) ??
    safeStrOrNull(supplier?.stateRef?.stateCode) ??
    safeStrOrNull(supplier?.stateCode);

  const supplyPresent = hasSupplyLocationSnapshots(bill);
  const supplyLabel = supplyPresent ? safeStrOrNull(bill?.supplyLocationLabelSnapshot) : null;
  const supplyAddress = supplyPresent ? trimSnap(bill?.supplyLocationAddressSnapshot) : registeredAddress;
  const supplyGstin = supplyPresent
    ? safeStrOrNull(bill?.supplyLocationGstinSnapshot) ?? registeredGstin
    : registeredGstin;
  const supplyStateName = supplyPresent
    ? safeStrOrNull(bill?.supplyLocationStateNameSnapshot) ?? registeredStateName
    : registeredStateName;
  const supplyStateCode = supplyPresent
    ? safeStrOrNull(bill?.supplyLocationStateCodeSnapshot) ?? registeredStateCode
    : registeredStateCode;

  const purchaseSourceStateName =
    safeStrOrNull(bill?.purchaseSourceStateNameSnapshot) ?? supplyStateName ?? registeredStateName;
  const purchaseSourceStateCode =
    safeStrOrNull(bill?.purchaseSourceStateCodeSnapshot) ?? supplyStateCode ?? registeredStateCode;
  const purchaseSource = safeStrOrNull(bill?.purchaseSourceSnapshot);
  const gstModeSnapshot = safeStrOrNull(bill?.purchaseGstModeSnapshot);

  const sameAsRegistered = !supplyPresent;

  return {
    partyName,
    registeredSupplier: {
      name: partyName,
      gstin: registeredGstin,
      address: registeredAddress,
      stateName: registeredStateName,
      stateCode: registeredStateCode,
    },
    supplyFrom: {
      label: supplyPresent ? supplyLabel || "Supply location" : "Same as registered supplier",
      address: supplyAddress,
      gstin: supplyGstin,
      stateName: supplyStateName,
      stateCode: supplyStateCode,
      sameAsRegistered,
    },
    purchaseSource: {
      stateName: purchaseSourceStateName,
      stateCode: purchaseSourceStateCode,
      source: purchaseSource,
      gstMode: gstModeSnapshot,
    },
  };
}

/**
 * Map a Purchase Bill DB row into an export-ready structured payload.
 * Mapping only (no tax recalculation; uses stored breakup fields).
 */
function mapPurchaseBillToTallyExportPayload({ bill, companyState }) {
  const supplier = bill?.supplier ?? null;
  const lines = Array.isArray(bill?.lines) ? bill.lines : [];
  const commercial = resolvePurchaseBillCommercialForTallyExport(bill, supplier);

  const distinctGrnIds = distinctSortedInts(lines.map((l) => l?.grnId).filter((v) => v != null));
  const distinctRmPoIds = distinctSortedInts(lines.map((l) => l?.rmPoId).filter((v) => v != null));

  const companyStateCode = companyState?.companyStateRef?.stateCode ?? null;
  const { intraState: taxIntraState, basis: purchaseTaxBasis } = resolvePurchaseBillIntraState(bill, companyState);

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

  const exportSupplierStateCode =
    commercial.purchaseSource.stateCode ??
    commercial.registeredSupplier.stateCode ??
    safeStrOrNull(bill?.supplierStateCodeSnapshot);
  const exportSupplierStateName =
    commercial.purchaseSource.stateName ??
    commercial.registeredSupplier.stateName ??
    safeStrOrNull(bill?.supplierStateSnapshot);

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
    purchaseTaxBasis,
    hasTemporaryTaxData: Boolean(bill?.hasTemporaryTaxData),

    company: {
      companyGstin: companyState?.companyGstin ?? null,
      companyStateName: companyState?.companyStateRef?.stateName ?? null,
      companyStateCode,
    },

    supplier: {
      supplierId: bill.supplierId,
      supplierName: commercial.partyName ?? safeStrOrNull(supplier?.name),
      supplierGstin: commercial.registeredSupplier.gstin,
      supplierStateName: commercial.registeredSupplier.stateName,
      supplierStateCode: commercial.registeredSupplier.stateCode,
      supplierAddress: commercial.registeredSupplier.address,
    },

    registeredSupplier: commercial.registeredSupplier,
    supplyFrom: commercial.supplyFrom,
    purchaseSource: commercial.purchaseSource,

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

module.exports = {
  mapPurchaseBillToTallyExportPayload,
  resolvePurchaseBillCommercialForTallyExport,
};
