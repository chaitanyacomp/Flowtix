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
  // Keep it compact: 18, 9, 2.5, 1.25 (trim trailing zeros)
  const s = (Math.round(x * 100) / 100).toFixed(2);
  return s.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function ledgerAt(prefix, pct) {
  const p = fmtPct(pct);
  if (!prefix || !p) return null;
  return `${prefix} @${p}%`;
}

function resolveTaxIntraStateFromCodes({ companyStateCode, customerStateCode }) {
  const c1 = safeStrOrNull(companyStateCode);
  const c2 = safeStrOrNull(customerStateCode);
  if (!c1 || !c2) return null;
  return String(c1) === String(c2);
}

/**
 * Map a Sales Bill DB row into an export-ready structured payload.
 * Mapping only (no tax recalculation; uses stored breakup fields).
 */
function mapSalesBillToTallyExportPayload({ bill, companyState }) {
  const customer = bill?.customer ?? null;
  const lines = Array.isArray(bill?.lines) ? bill.lines : [];
  const orderType = bill?.dispatch?.salesOrder?.orderType ?? null;
  const soId = bill?.soIdSnapshot ?? bill?.dispatch?.soId ?? null;
  const cycleId = bill?.cycleId ?? bill?.dispatch?.cycleId ?? null;

  const mappedLines = lines.map((ln) => {
    const item = ln.item ?? null;
    return {
      itemId: ln.itemId,
      itemName: safeStrOrNull(ln.itemNameSnapshot) ?? safeStrOrNull(item?.itemName),
      hsnCode: safeStrOrNull(ln.hsnCodeSnapshot) ?? safeStrOrNull(item?.hsnCode),
      gstRate: safeStrOrNull(ln.gstRate),
      unit: safeStrOrNull(ln.unitSnapshot) ?? safeStrOrNull(item?.unit),
      // Quantity must come from SalesBillLine.qty (dispatch-derived in our flow).
      quantity: safeStrOrNull(ln.qty),
      rate: safeStrOrNull(ln.rate),
      baseAmount: safeStrOrNull(ln.basicAmount),
      cgstAmount: safeStrOrNull(ln.cgstAmount),
      sgstAmount: safeStrOrNull(ln.sgstAmount),
      igstAmount: safeStrOrNull(ln.igstAmount),
      lineTotal: safeStrOrNull(ln.lineTotal),
    };
  });

  const companyStateCode = companyState?.companyStateRef?.stateCode ?? null;
  const customerStateCode = bill.customerStateCodeSnapshot || customer?.stateRef?.stateCode || null;
  const taxIntraState =
    typeof bill.taxIntraState === "boolean"
      ? bill.taxIntraState
      : resolveTaxIntraStateFromCodes({ companyStateCode, customerStateCode });

  const distinctGstRates = Array.from(
    new Set(mappedLines.map((l) => String(l.gstRate ?? "").trim()).filter(Boolean)),
  );
  if (distinctGstRates.length > 1) {
    const err = new Error(
      "Cannot export sales bill because it contains multiple GST rates. Please export bills with a single GST rate in phase 1.",
    );
    err.statusCode = 400;
    throw err;
  }
  const billGstRate = distinctGstRates.length === 1 ? Number(distinctGstRates[0]) : 0;
  const halfRate = billGstRate / 2;

  const salesLedger =
    taxIntraState === false
      ? ledgerAt(TALLY_LEDGER_PATTERNS.interstateSalesPrefix, billGstRate)
      : ledgerAt(TALLY_LEDGER_PATTERNS.localSalesPrefix, billGstRate);

  const cgstLedger = taxIntraState === true ? ledgerAt(TALLY_LEDGER_PATTERNS.outputCgstPrefix, halfRate) : null;
  const sgstLedger = taxIntraState === true ? ledgerAt(TALLY_LEDGER_PATTERNS.outputSgstPrefix, halfRate) : null;
  const igstLedger = taxIntraState === false ? ledgerAt(TALLY_LEDGER_PATTERNS.outputIgstPrefix, billGstRate) : null;

  return {
    salesBillId: bill.id,
    voucherNo: safeStrOrNull(bill.billNo) ?? `SB-${bill.id}`,
    billNo: safeStrOrNull(bill.billNo),
    billDate: bill.billDate,
    dispatchId: bill.dispatchId ?? null,
    dispatchNo: safeStrOrNull(bill.dispatchNoSnapshot) ?? (bill.dispatchId ? `DISP-${bill.dispatchId}` : null),
    meta: {
      orderType: safeStrOrNull(orderType),
      salesOrderNo: soId != null ? `SO-${soId}` : null,
      cycleId: cycleId != null ? Number(cycleId) : null,
    },

    company: {
      companyGstin: companyState?.companyGstin ?? null,
      companyStateName: companyState?.companyStateRef?.stateName ?? null,
      companyStateCode,
    },

    customer: {
      customerId: bill.customerId,
      customerName: safeStrOrNull(bill.customerNameSnapshot) ?? safeStrOrNull(customer?.name),
      customerGstin: customer?.gst ?? null,
      customerStateName: bill.customerStateNameSnapshot || customer?.stateRef?.stateName || null,
      customerStateCode,
    },

    tax: {
      taxIntraState,
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
        sales: salesLedger,
        cgst: cgstLedger,
        sgst: sgstLedger,
        igst: igstLedger,
      },
    },

    lines: mappedLines,
  };
}

module.exports = { mapSalesBillToTallyExportPayload };

