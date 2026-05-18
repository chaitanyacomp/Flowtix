const { COMPANY_STATE } = require("../config/company");
const { DocType, Prisma } = require("../prismaClientPackage");
const { allocateDocNo } = require("./docNoService");
const { maybeAutoCloseNoQtyCycle } = require("./noQtyCycleAutoClose");
const { findApplicableRateContractLine, normalizeUtcDateOnly } = require("./rateContractService");
const { assertAnyAdminPassword } = require("./adminPasswordAuth");

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function startOfUtcDay(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

function friendlyError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function computeLineTaxSplit(basic, gstRatePct, intraState) {
  const rate = Number(gstRatePct) || 0;
  const basicN = round2(basic);
  const tax = round2((basicN * rate) / 100);
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (intraState && rate > 0) {
    cgst = round2(tax / 2);
    sgst = round2(tax - cgst);
  } else {
    igst = tax;
  }
  const lineTotal = round2(basicN + tax);
  return {
    basicAmount: basicN,
    gstRate: rate,
    cgstAmount: cgst,
    sgstAmount: sgst,
    igstAmount: igst,
    lineTotal,
    totalTax: tax,
  };
}

function resolveSalesIntraFromStateCodes({ customer }) {
  const customerCode = customer?.stateRef?.stateCode ?? null;
  if (!customerCode) return { intraState: false, basis: "MISSING_CUSTOMER_STATE_CODE" };
  return { intraState: String(customerCode) === String(COMPANY_STATE.code), basis: "STATIC_CODE" };
}

function sumTotals(lines) {
  let totalBasic = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  let totalTax = 0;
  let netAmount = 0;
  for (const ln of lines) {
    totalBasic += ln.basicAmount;
    totalCgst += ln.cgstAmount;
    totalSgst += ln.sgstAmount;
    totalIgst += ln.igstAmount;
    totalTax += ln.totalTax;
    netAmount += ln.lineTotal;
  }
  return {
    totalBasic: round2(totalBasic),
    totalCgst: round2(totalCgst),
    totalSgst: round2(totalSgst),
    totalIgst: round2(totalIgst),
    totalTax: round2(totalTax),
    netAmount: round2(netAmount),
  };
}

async function deriveSalesRateForSoItem(tx, so, itemId) {
  // Preferred: quotation line rate (SO created from quotation)
  const soLine = (so.lines || []).find((l) => l.itemId === itemId) || null;
  if (soLine?.quotationLineId) {
    const ql = await tx.quotationLine.findUnique({ where: { id: soLine.quotationLineId } });
    if (ql) return Number(ql.isFree ? 0 : ql.rate);
  }
  // Fallback: customer PO line rate (when SO is tied to a customer PO)
  if (so.poId) {
    const pol = await tx.customerPOLine.findFirst({
      where: { poId: so.poId, itemId },
      orderBy: { id: "asc" },
      select: { rate: true },
    });
    if (pol) return Number(pol.rate);
  }
  // Final fallback: SO line rate (legacy / snapshots).
  if (soLine) {
    if (Boolean(soLine.isFree)) return 0;
    const r = Number(soLine.rate ?? 0);
    if (Number.isFinite(r) && r > 0) return r;
  }
  return 0;
}

const billInclude = {
  customer: { include: { stateRef: { select: { id: true, stateName: true, stateCode: true } } } },
  cycle: { select: { id: true, cycleNo: true } },
  dispatch: {
    include: {
      cycle: { select: { id: true, cycleNo: true } },
      salesOrder: { include: { customer: true, po: { include: { customer: true } }, lines: true } },
      item: true,
    },
  },
  exportedBy: { select: { id: true, name: true } },
  lines: { include: { item: true }, orderBy: { id: "asc" } },
  receipts: { orderBy: { id: "asc" }, include: { createdBy: { select: { id: true, name: true } } } },
};

async function getCompanyState(tx) {
  const row = await tx.appSetting.findUnique({
    where: { id: 1 },
    select: {
      companyState: true,
      companyGstin: true,
      companyStateRef: { select: { id: true, stateName: true, stateCode: true } },
    },
  });
  return row ?? { companyState: null, companyStateRef: null };
}

function withSalesBillGstBreakup(bill, { intraState, companyState }) {
  const lines = Array.isArray(bill?.lines) ? bill.lines : [];
  const nextLines = lines.map((ln) => {
    const basic = Number(ln.basicAmount ?? 0);
    const cgst = Number(ln.cgstAmount ?? 0);
    const sgst = Number(ln.sgstAmount ?? 0);
    const igst = Number(ln.igstAmount ?? 0);
    const gst = cgst + sgst + igst;
    return { ...ln, baseAmount: basic.toFixed(2), gstAmount: gst.toFixed(2) };
  });
  const operationalCycleNo = (() => {
    if (bill?.cycle?.cycleNo != null && Number.isFinite(Number(bill.cycle.cycleNo))) return Number(bill.cycle.cycleNo);
    if (bill?.dispatch?.cycle?.cycleNo != null && Number.isFinite(Number(bill.dispatch.cycle.cycleNo)))
      return Number(bill.dispatch.cycle.cycleNo);
    return null;
  })();

  return {
    ...bill,
    taxIntraState: Boolean(intraState),
    companyStateCode: companyState?.companyStateRef?.stateCode ?? null,
    customerStateCode: bill?.customer?.stateRef?.stateCode ?? null,
    lines: nextLines,
    /** NO_QTY: document-linked cycle for operator UI (not SalesOrder.currentCycle). */
    operationalCycleNo,
  };
}

async function listSalesBills(prisma, query) {
  const { fromDate, toDate, customerId, status, search, payment, exportFilter, export: exportQ } = query;
  const exportKey = exportFilter != null && exportFilter !== "" ? exportFilter : exportQ;
  /** @type {import('@prisma/client').Prisma.SalesBillWhereInput} */
  const where = {};
  if (fromDate || toDate) {
    where.billDate = {};
    if (fromDate) {
      const d = new Date(fromDate);
      if (!Number.isNaN(d.getTime())) {
        where.billDate.gte = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      }
    }
    if (toDate) {
      const d = new Date(toDate);
      if (!Number.isNaN(d.getTime())) {
        where.billDate.lte = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      }
    }
  }
  if (customerId != null && customerId !== "") {
    const cid = Number(customerId);
    if (Number.isFinite(cid)) where.customerId = cid;
  }
  if (status && ["DRAFT", "FINALIZED", "CANCELLED"].includes(String(status))) {
    where.status = String(status);
  }
  const searchTrim = typeof search === "string" ? search.trim() : "";
  if (searchTrim) {
    where.OR = [
      { billNo: { contains: searchTrim } },
      { customerNameSnapshot: { contains: searchTrim } },
      { dispatchNoSnapshot: { contains: searchTrim } },
    ];
  }

  const paymentNorm = typeof payment === "string" ? payment.trim().toLowerCase() : "";
  const expNorm = typeof exportKey === "string" ? String(exportKey).trim().toLowerCase() : "";

  /** @type {import('@prisma/client').Prisma.SalesBillWhereInput[]} */
  const paymentAnd = [];
  if (paymentNorm === "pending") {
    paymentAnd.push({
      status: "FINALIZED",
      cancelledAt: null,
      pendingAmount: { gt: new Prisma.Decimal("0.0001") },
    });
  } else if (paymentNorm === "overdue") {
    const today = startOfUtcDay(new Date());
    const minBusinessDue = new Date(Date.UTC(1971, 0, 1));
    paymentAnd.push({
      status: "FINALIZED",
      cancelledAt: null,
      pendingAmount: { gt: new Prisma.Decimal("0.0001") },
      dueDate: { not: null, lt: today, gte: minBusinessDue },
    });
  } else if (paymentNorm === "partial") {
    paymentAnd.push({ status: "FINALIZED", cancelledAt: null, paymentStatus: "PARTIAL" });
  } else if (paymentNorm === "paid") {
    paymentAnd.push({
      status: "FINALIZED",
      cancelledAt: null,
      OR: [{ paymentStatus: "PAID" }, { pendingAmount: { lte: new Prisma.Decimal("0.0001") } }],
    });
  }

  if (expNorm === "not_exported" || expNorm === "pending") {
    paymentAnd.push({ isExported: false });
  } else if (expNorm === "exported") {
    paymentAnd.push({ isExported: true });
  }

  if (paymentAnd.length) {
    where.AND = [...(where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []), ...paymentAnd];
  }

  return prisma.salesBill.findMany({
    where,
    orderBy: { id: "desc" },
    include: {
      customer: { select: { id: true, name: true } },
      dispatch: { select: { id: true, soId: true, date: true, docNo: true, salesOrder: { select: { docNo: true } } } },
    },
  });
}

async function getEligibleDispatches(prisma) {
  // Eligible = forward LOCKED dispatch rows with qty>0 and without an active (draft/finalized) sales bill.
  const dispatches = await prisma.dispatch.findMany({
    where: {
      reversalOfId: null,
      workflowStatus: "LOCKED",
      // Revenue dispatch only: exclude replacement / non-revenue sales orders.
      salesOrder: {
        OR: [
          // NO_QTY dispatch is operational (cycle+stock) and may occur while SO internalStatus is still DRAFT.
          { orderType: "NO_QTY" },
          // NORMAL flow: keep approval dependency (exclude drafts).
          { orderType: "NORMAL", internalStatus: { not: "DRAFT" } },
        ],
      },
    },
    orderBy: { id: "desc" },
    include: { salesOrder: { include: { customer: { include: { stateRef: true } }, po: { include: { customer: true } }, lines: true } }, item: true },
  });
  const ids = dispatches.map((d) => d.id);
  const finalized = await prisma.salesBill.findMany({
    where: {
      dispatchId: { in: ids },
      status: "FINALIZED",
      cancelledAt: null,
    },
    select: { dispatchId: true },
  });
  const drafts = await prisma.salesBill.findMany({
    where: {
      dispatchId: { in: ids },
      status: "DRAFT",
      cancelledAt: null,
    },
    select: { id: true, dispatchId: true },
    orderBy: { id: "desc" },
  });
  const blocked = new Set(finalized.map((x) => x.dispatchId));
  const draftByDispatchId = new Map();
  for (const d of drafts) {
    if (!draftByDispatchId.has(d.dispatchId)) {
      draftByDispatchId.set(d.dispatchId, d.id);
    }
  }
  return dispatches
    .filter((d) => !blocked.has(d.id) && Number(d.dispatchedQty) > 0)
    .map((d) => ({
      dispatchId: d.id,
      dispatchNo: d.docNo || `D-${String(d.id).padStart(2, "0")}-${String(d.id).padStart(4, "0")}`,
      dispatchDate: d.date,
      salesOrderId: d.soId,
      salesOrderDocNo: d.salesOrder?.docNo ?? null,
      customerName: d.salesOrder?.customer?.name ?? d.salesOrder?.po?.customer?.name ?? null,
      itemName: d.item?.itemName ?? null,
      dispatchedQty: String(d.dispatchedQty),
      workflowStatus: d.workflowStatus,
      draftBillId: draftByDispatchId.get(d.id) ?? null,
      hasDraftBill: draftByDispatchId.has(d.id),
    }));
}

/**
 * Rebuild all lines on a NO_QTY draft bill from the rate contract for the given bill date.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function refreshNoQtyDraftLinesFromContract(tx, billId, billDateUtc) {
  const bill = await tx.salesBill.findUnique({
    where: { id: billId },
    include: {
      customer: { include: { stateRef: { select: { id: true, stateName: true, stateCode: true } } } },
      dispatch: { include: { salesOrder: true } },
      lines: { include: { item: true }, orderBy: { id: "asc" } },
    },
  });
  if (!bill?.dispatch?.salesOrder || bill.dispatch.salesOrder.orderType !== "NO_QTY") return;

  const intra = resolveSalesIntraFromStateCodes({ customer: bill.customer }).intraState;
  const customerId = bill.customerId;

  for (const ln of bill.lines) {
    const item = ln.item;
    const contract = await findApplicableRateContractLine(tx, {
      customerId,
      itemId: ln.itemId,
      asOf: billDateUtc,
    });
    if (!contract) {
      const label = item?.itemName ? String(item.itemName) : `ID ${ln.itemId}`;
      throw friendlyError(`No approved rate contract for “${label}” on the selected bill date.`, 400);
    }
    const rate = Number(contract.rate);
    const gstRatePct =
      contract.gstRate != null && String(contract.gstRate).trim() !== ""
        ? Number(contract.gstRate)
        : Number(item?.gstRate ?? 0);
    const qty = Number(ln.qty);
    const calc = computeLineTaxSplit(qty * rate, gstRatePct, intra);
    await tx.salesBillLine.update({
      where: { id: ln.id },
      data: {
        rate: String(rate),
        gstRate: String(calc.gstRate),
        rateEffectiveFrom: contract.effectiveFrom,
        basicAmount: String(calc.basicAmount),
        cgstAmount: String(calc.cgstAmount),
        sgstAmount: String(calc.sgstAmount),
        igstAmount: String(calc.igstAmount),
        lineTotal: String(calc.lineTotal),
      },
    });
  }

  const linesAfter = await tx.salesBillLine.findMany({ where: { salesBillId: billId } });
  const totals = sumTotals(
    linesAfter.map((x) => ({
      basicAmount: Number(x.basicAmount),
      cgstAmount: Number(x.cgstAmount),
      sgstAmount: Number(x.sgstAmount),
      igstAmount: Number(x.igstAmount),
      totalTax: Number(x.cgstAmount) + Number(x.sgstAmount) + Number(x.igstAmount),
      lineTotal: Number(x.lineTotal),
    })),
  );
  await tx.salesBill.update({
    where: { id: billId },
    data: {
      totalBasic: String(totals.totalBasic),
      totalCgst: String(totals.totalCgst),
      totalSgst: String(totals.totalSgst),
      totalIgst: String(totals.totalIgst),
      totalTax: String(totals.totalTax),
      netAmount: String(totals.netAmount),
    },
  });
}

async function createDraftFromDispatch(prisma, dispatchId, opts = {}) {
  if (!Number.isFinite(dispatchId) || dispatchId <= 0) throw friendlyError("Invalid dispatch id");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.salesBill.findFirst({
      where: { dispatchId, status: { in: ["DRAFT", "FINALIZED"] } },
      orderBy: { id: "desc" },
      include: billInclude,
    });
    if (existing) {
      if (existing.status === "FINALIZED") {
        throw friendlyError("Sales Bill already exists for this dispatch.", 409);
      }
      // DRAFT: reopen
      const companyState0 = await getCompanyState(tx);
      const intra0 = resolveSalesIntraFromStateCodes({ customer: existing.customer }).intraState;
      return { bill: withSalesBillGstBreakup(existing, { intraState: intra0, companyState: companyState0 }), created: false };
    }

    const dispatch = await tx.dispatch.findUnique({
      where: { id: dispatchId },
      include: {
        salesOrder: { include: { customer: { include: { stateRef: true } }, po: { include: { customer: true } }, lines: true } },
        item: true,
      },
    });
    if (!dispatch) throw friendlyError("Dispatch not found.", 404);
    if (dispatch.reversalOfId != null) throw friendlyError("This dispatch is a reversal and cannot be billed.");
    if (dispatch.workflowStatus !== "LOCKED") throw friendlyError("Only confirmed (locked) dispatch can be billed.", 409);
    const qty = Number(dispatch.dispatchedQty);
    if (!Number.isFinite(qty) || qty <= 0) throw friendlyError("Dispatch quantity must be positive.");

    const so = dispatch.salesOrder;
    if (!so) throw friendlyError("Sales order not found for this dispatch.");
    if (so.orderType !== "NORMAL" && so.orderType !== "NO_QTY") {
      throw friendlyError("Sales Bill cannot be created for replacement dispatch.", 409);
    }
    const customer = so.customer ?? so.po?.customer ?? null;
    if (!customer) throw friendlyError("Customer is required before creating a Sales Bill.");
    if (!customer.stateRef?.stateCode || !customer.stateRef?.stateName) {
      throw friendlyError("Customer state is required before creating a Sales Bill.", 409);
    }
    const item = dispatch.item;
    if (!item) throw friendlyError("Item not found.");
    if (!item.hsnCode) throw friendlyError("Item HSN is missing for one or more lines.", 409);

    const isNoQty = so.orderType === "NO_QTY";
    if (!isNoQty && item.gstRate == null) throw friendlyError("Item GST rate is missing for one or more lines.", 409);

    const today = new Date();
    const billDate =
      normalizeUtcDateOnly(opts?.billDate != null ? opts.billDate : null) ?? normalizeUtcDateOnly(today);

    const intra = resolveSalesIntraFromStateCodes({ customer }).intraState;
    let rate;
    let gstRatePct;
    /** Rate contract row used for NO_QTY rate/GST snapshot + line.rateEffectiveFrom only. */
    let applicableRateContract = null;

    if (isNoQty) {
      applicableRateContract = await findApplicableRateContractLine(tx, {
        customerId: customer.id,
        itemId: dispatch.itemId,
        asOf: billDate,
      });
      if (!applicableRateContract) {
        throw friendlyError("No approved rate contract for this customer and item on the selected bill date.", 400);
      }
      rate = Number(applicableRateContract.rate);
      gstRatePct =
        applicableRateContract.gstRate != null && String(applicableRateContract.gstRate).trim() !== ""
          ? Number(applicableRateContract.gstRate)
          : Number(item.gstRate ?? 0);
      if (!Number.isFinite(gstRatePct) || gstRatePct < 0) {
        throw friendlyError("GST rate is missing for billing (item master or rate contract).", 409);
      }
    } else {
      rate = await deriveSalesRateForSoItem(tx, so, dispatch.itemId);
      gstRatePct = Number(item.gstRate);
    }

    const calc = computeLineTaxSplit(qty * rate, gstRatePct, intra);

    const billLineCreate = {
      dispatchId: dispatch.id,
      soId: dispatch.soId,
      itemId: item.id,
      itemNameSnapshot: String(item.itemName || "").slice(0, 256),
      hsnCodeSnapshot: String(item.hsnCode || "").trim().toUpperCase().slice(0, 32),
      unitSnapshot: String(item.unit || "").slice(0, 64),
      qty: String(qty),
      rate: String(rate),
      basicAmount: String(calc.basicAmount),
      gstRate: String(calc.gstRate),
      cgstAmount: String(calc.cgstAmount),
      sgstAmount: String(calc.sgstAmount),
      igstAmount: String(calc.igstAmount),
      lineTotal: String(calc.lineTotal),
      ...(isNoQty && applicableRateContract ? { rateEffectiveFrom: applicableRateContract.effectiveFrom } : {}),
    };

    const created = await tx.salesBill.create({
      data: {
        docNo: await allocateDocNo(tx, { docType: DocType.SALES_BILL, date: billDate }),
        billNo: null,
        billDate,
        customerId: customer.id,
        dispatchId: dispatch.id,
        cycleId: dispatch.cycleId ?? null,
        remarks: null,
        status: "DRAFT",
        customerNameSnapshot: String(customer.name || "").slice(0, 256),
        customerStateNameSnapshot: String(customer.stateRef.stateName || "").slice(0, 128),
        customerStateCodeSnapshot: String(customer.stateRef.stateCode || "").slice(0, 2),
        dispatchNoSnapshot: dispatch.docNo || `DISP-${dispatch.id}`,
        dispatchDateSnapshot: dispatch.date,
        soIdSnapshot: dispatch.soId,
        totalBasic: String(calc.basicAmount),
        totalCgst: String(calc.cgstAmount),
        totalSgst: String(calc.sgstAmount),
        totalIgst: String(calc.igstAmount),
        totalTax: String(calc.totalTax),
        netAmount: String(calc.lineTotal),
        lines: {
          create: [billLineCreate],
        },
      },
      include: billInclude,
    });

    const companyStateAfter = await getCompanyState(tx);
    return { bill: withSalesBillGstBreakup(created, { intraState: intra, companyState: companyStateAfter }), created: true };
  });
}

async function updateDraft(prisma, billId, body) {
  const { billNo, billDate, remarks } = body;
  return prisma.$transaction(async (tx) => {
    const bill = await tx.salesBill.findUnique({
      where: { id: billId },
      include: { ...billInclude, lines: { include: { item: true }, orderBy: { id: "asc" } } },
    });
    if (!bill) throw friendlyError("Sales bill not found.", 404);
    if (bill.status !== "DRAFT") throw friendlyError("Only draft Sales Bills can be edited.", 409);

    const trimmedBillNo = billNo != null && String(billNo).trim() !== "" ? String(billNo).trim() : null;
    let parsedBillDate = billDate instanceof Date ? billDate : new Date(billDate);
    if (Number.isNaN(parsedBillDate.getTime())) throw friendlyError("Please enter a valid bill date.");
    parsedBillDate = new Date(Date.UTC(parsedBillDate.getUTCFullYear(), parsedBillDate.getUTCMonth(), parsedBillDate.getUTCDate()));

    const prevBillDateNorm = normalizeUtcDateOnly(bill.billDate);
    const billDateChanged =
      !prevBillDateNorm || !parsedBillDate || prevBillDateNorm.getTime() !== parsedBillDate.getTime();

    await tx.salesBill.update({
      where: { id: billId },
      data: {
        billNo: trimmedBillNo,
        billDate: parsedBillDate,
        remarks: remarks != null && String(remarks).trim() !== "" ? String(remarks).trim() : null,
      },
    });

    const orderType = bill.dispatch?.salesOrder?.orderType;
    if (orderType === "NO_QTY" && billDateChanged) {
      await refreshNoQtyDraftLinesFromContract(tx, billId, parsedBillDate);
    }

    const updated = await tx.salesBill.findUnique({
      where: { id: billId },
      include: billInclude,
    });
    const companyState = await getCompanyState(tx);
    const intra = resolveSalesIntraFromStateCodes({ customer: updated.customer }).intraState;
    return withSalesBillGstBreakup(updated, { intraState: intra, companyState });
  });
}

/**
 * Admin correction of a single line rate on a NO_QTY draft bill (does not alter rate contracts).
 */
async function patchDraftSalesBillLineRate(prisma, billId, lineId, rateInput) {
  const rate = Number(rateInput);
  if (!Number.isFinite(rate) || rate <= 0) throw friendlyError("Enter a valid rate.", 400);

  return prisma.$transaction(async (tx) => {
    const bill = await tx.salesBill.findUnique({
      where: { id: billId },
      include: {
        customer: { include: { stateRef: { select: { id: true, stateName: true, stateCode: true } } } },
        dispatch: { include: { salesOrder: true } },
        lines: { include: { item: true }, orderBy: { id: "asc" } },
      },
    });
    if (!bill) throw friendlyError("Sales bill not found.", 404);
    if (bill.status !== "DRAFT") throw friendlyError("Only draft Sales Bills can be edited.", 409);
    if (bill.isExported) throw friendlyError("Cannot edit rate: this sales bill is exported.", 409);
    if (bill.dispatch?.salesOrder?.orderType !== "NO_QTY") {
      throw friendlyError("Rate correction applies only to No Qty sales orders.", 409);
    }

    const ln = bill.lines.find((l) => l.id === lineId) || null;
    if (!ln) throw friendlyError("Line not found on this bill.", 404);

    const intra = resolveSalesIntraFromStateCodes({ customer: bill.customer }).intraState;
    const qty = Number(ln.qty);
    const gstRate = Number(ln.gstRate);
    const calc = computeLineTaxSplit(qty * rate, gstRate, intra);

    await tx.salesBillLine.update({
      where: { id: lineId },
      data: {
        rate: String(rate),
        rateEffectiveFrom: null,
        basicAmount: String(calc.basicAmount),
        gstRate: String(calc.gstRate),
        cgstAmount: String(calc.cgstAmount),
        sgstAmount: String(calc.sgstAmount),
        igstAmount: String(calc.igstAmount),
        lineTotal: String(calc.lineTotal),
      },
    });

    await tx.salesOrderLine.updateMany({
      where: { soId: bill.dispatch.soId, itemId: ln.itemId },
      data: { rate: new Prisma.Decimal(String(rate)) },
    });

    const linesAfter = await tx.salesBillLine.findMany({ where: { salesBillId: billId } });
    const totals = sumTotals(
      linesAfter.map((x) => ({
        basicAmount: Number(x.basicAmount),
        cgstAmount: Number(x.cgstAmount),
        sgstAmount: Number(x.sgstAmount),
        igstAmount: Number(x.igstAmount),
        totalTax: Number(x.cgstAmount) + Number(x.sgstAmount) + Number(x.igstAmount),
        lineTotal: Number(x.lineTotal),
      })),
    );
    await tx.salesBill.update({
      where: { id: billId },
      data: {
        totalBasic: String(totals.totalBasic),
        totalCgst: String(totals.totalCgst),
        totalSgst: String(totals.totalSgst),
        totalIgst: String(totals.totalIgst),
        totalTax: String(totals.totalTax),
        netAmount: String(totals.netAmount),
      },
    });

    const refreshed = await tx.salesBill.findUnique({ where: { id: billId }, include: billInclude });
    const companyState = await getCompanyState(tx);
    const intra2 = resolveSalesIntraFromStateCodes({ customer: refreshed.customer }).intraState;
    return withSalesBillGstBreakup(refreshed, { intraState: intra2, companyState });
  });
}

async function finalizeBill(prisma, billId, userId) {
  return prisma.$transaction(async (tx) => {
    const bill = await tx.salesBill.findUnique({
      where: { id: billId },
      include: { ...billInclude, lines: { orderBy: { id: "asc" }, include: { item: true } } },
    });
    if (!bill) throw friendlyError("Sales bill not found.", 404);
    if (bill.status !== "DRAFT") throw friendlyError("This bill is already finalized or cancelled.");
    if (!bill.customer?.stateRef?.stateCode) throw friendlyError("Customer state is required before finalizing.", 409);
    if (!bill.lines.length) throw friendlyError("Add at least one line item before finalizing.");
    for (const ln of bill.lines) {
      const rate = Number(ln.rate);
      if (!Number.isFinite(rate) || rate <= 0) {
        throw friendlyError("Cannot finalize sales bill because one or more line rates are missing.", 409);
      }
      if (!String(ln.hsnCodeSnapshot || "").trim()) {
        throw friendlyError("Item HSN is missing for one or more lines.", 409);
      }
    }

    const intra = resolveSalesIntraFromStateCodes({ customer: bill.customer }).intraState;
    const rebuilt = [];
    for (const ln of bill.lines) {
      const qty = Number(ln.qty);
      const rate = Number(ln.rate);
      const gstRate = Number(ln.gstRate);
      const calc = computeLineTaxSplit(qty * rate, gstRate, intra);
      rebuilt.push({ id: ln.id, ...calc, rate, gstRate });
      await tx.salesBillLine.update({
        where: { id: ln.id },
        data: {
          rate: String(rate),
          basicAmount: String(calc.basicAmount),
          gstRate: String(calc.gstRate),
          cgstAmount: String(calc.cgstAmount),
          sgstAmount: String(calc.sgstAmount),
          igstAmount: String(calc.igstAmount),
          lineTotal: String(calc.lineTotal),
        },
      });
    }
    const totals = sumTotals(rebuilt.map((l) => ({ ...l })));
    const finalized = await tx.salesBill.update({
      where: { id: billId },
      data: {
        status: "FINALIZED",
        finalizedAt: new Date(),
        finalizedById: typeof userId === "number" ? userId : null,
        totalBasic: String(totals.totalBasic),
        totalCgst: String(totals.totalCgst),
        totalSgst: String(totals.totalSgst),
        totalIgst: String(totals.totalIgst),
        totalTax: String(totals.totalTax),
        netAmount: String(totals.netAmount),
        pendingAmount: String(totals.netAmount),
        receivedAmount: "0",
        paymentStatus: "PENDING",
      },
      include: billInclude,
    });

    // NO_QTY: Auto-close current cycle when fully billed and no pending dispatch remains.
    // Strictly current-cycle scoped and safe to no-op when not eligible.
    try {
      const soId = finalized?.dispatch?.soId != null ? Number(finalized.dispatch.soId) : 0;
      const cycleId = finalized?.cycleId != null ? Number(finalized.cycleId) : (finalized?.dispatch?.cycleId != null ? Number(finalized.dispatch.cycleId) : 0);
      if (Number.isFinite(soId) && soId > 0 && Number.isFinite(cycleId) && cycleId > 0) {
        await maybeAutoCloseNoQtyCycle(tx, { soId, cycleId });
      }
    } catch {
      // Auto-close is best-effort; billing finalize must succeed even if closing cannot be evaluated.
    }

    const companyState = await getCompanyState(tx);
    return withSalesBillGstBreakup(finalized, { intraState: intra, companyState });
  });
}

async function cancelBill(prisma, billId, { reason, userId }) {
  const reasonTrim = String(reason || "").trim();
  if (!reasonTrim) throw friendlyError("Cancellation reason is required.", 400);
  return prisma.$transaction(async (tx) => {
    const bill = await tx.salesBill.findUnique({ where: { id: billId } });
    if (!bill) throw friendlyError("Sales bill not found.", 404);
    if (bill.status !== "FINALIZED") throw friendlyError("Only finalized Sales Bills can be cancelled.", 409);
    const updated = await tx.salesBill.update({
      where: { id: billId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: typeof userId === "number" ? userId : null,
        cancelReason: reasonTrim,
      },
      include: billInclude,
    });
    const companyState = await getCompanyState(tx);
    const intra = resolveSalesIntraFromStateCodes({ customer: updated.customer }).intraState;
    return withSalesBillGstBreakup(updated, { intraState: intra, companyState });
  });
}

function deriveSalesBillPaymentStatus(receivedAmt, pendingAmt) {
  const r = Number(receivedAmt);
  const p = Number(pendingAmt);
  if (Number.isFinite(p) && p <= 1e-6) return "PAID";
  if (Number.isFinite(r) && r > 1e-6) return "PARTIAL";
  return "PENDING";
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function recalculateSalesBillPaymentTotals(tx, billId) {
  const bill = await tx.salesBill.findUnique({
    where: { id: billId },
    select: { netAmount: true },
  });
  if (!bill) return;
  const agg = await tx.salesBillReceipt.aggregate({
    where: { salesBillId: billId },
    _sum: { amount: true },
  });
  const received = round2(Number(agg._sum.amount || 0));
  const net = round2(Number(bill.netAmount));
  const pending = Math.max(0, round2(net - received));
  const paymentStatus = deriveSalesBillPaymentStatus(received, pending);
  await tx.salesBill.update({
    where: { id: billId },
    data: {
      receivedAmount: String(received),
      pendingAmount: String(pending),
      paymentStatus,
    },
  });
}

const RECEIPT_MODES = new Set(["CASH", "BANK", "UPI", "CHEQUE", "OTHER"]);

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function addSalesBillReceipt(prisma, billId, input, { userId, role }) {
  const mode = String(input?.mode || "").toUpperCase();
  if (!RECEIPT_MODES.has(mode)) throw friendlyError("Invalid payment mode.", 400);

  let amount = Number(input?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw friendlyError("Amount must be positive.", 400);

  const receiptDateRaw = input?.receiptDate;
  if (receiptDateRaw == null || receiptDateRaw === "") throw friendlyError("Receipt date is required.", 400);
  const rd = receiptDateRaw instanceof Date ? receiptDateRaw : new Date(receiptDateRaw);
  if (Number.isNaN(rd.getTime())) throw friendlyError("Invalid receipt date.", 400);
  const receiptDateVal = new Date(Date.UTC(rd.getUTCFullYear(), rd.getUTCMonth(), rd.getUTCDate()));

  const refTrim = input?.referenceNo != null ? String(input.referenceNo).trim().slice(0, 128) : "";
  const remarksTrim = input?.remarks != null ? String(input.remarks).trim().slice(0, 4000) : "";

  return prisma.$transaction(async (tx) => {
    const bill = await tx.salesBill.findUnique({
      where: { id: billId },
      include: billInclude,
    });
    if (!bill) throw friendlyError("Sales bill not found.", 404);
    if (bill.status !== "FINALIZED") throw friendlyError("Receipts apply only to finalized bills.", 409);
    if (bill.cancelledAt) throw friendlyError("Bill is cancelled.", 409);

    const net = round2(Number(bill.netAmount));
    const agg = await tx.salesBillReceipt.aggregate({
      where: { salesBillId: billId },
      _sum: { amount: true },
    });
    const currentReceived = round2(Number(agg._sum.amount || 0));
    const pendingBefore = Math.max(0, round2(net - currentReceived));
    const newTotal = round2(currentReceived + amount);

    const needsConfirm =
      newTotal > net + 1e-6 || (role !== "ADMIN" && amount > pendingBefore + 1e-6);
    if (needsConfirm) {
      await assertAnyAdminPassword(tx, { password: input?.adminPassword });
    }

    await tx.salesBillReceipt.create({
      data: {
        salesBillId: billId,
        receiptDate: receiptDateVal,
        amount: String(round2(amount)),
        mode,
        referenceNo: refTrim || null,
        remarks: remarksTrim || null,
        createdById: typeof userId === "number" ? userId : null,
      },
    });

    await recalculateSalesBillPaymentTotals(tx, billId);

    const updated = await tx.salesBill.findUnique({
      where: { id: billId },
      include: billInclude,
    });
    const companyState = await getCompanyState(tx);
    const intra = resolveSalesIntraFromStateCodes({ customer: updated.customer }).intraState;
    return withSalesBillGstBreakup(updated, { intraState: intra, companyState });
  });
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function deleteSalesBillReceipt(prisma, billId, receiptId, { role, adminPassword }) {
  return prisma.$transaction(async (tx) => {
    if (role !== "ADMIN") {
      await assertAnyAdminPassword(tx, { password: adminPassword });
    }
    const row = await tx.salesBillReceipt.findFirst({
      where: { id: receiptId, salesBillId: billId },
    });
    if (!row) throw friendlyError("Receipt not found.", 404);
    const bill = await tx.salesBill.findUnique({
      where: { id: billId },
      select: { status: true, cancelledAt: true },
    });
    if (!bill || bill.status !== "FINALIZED" || bill.cancelledAt) {
      throw friendlyError("Cannot delete receipt for this bill.", 409);
    }
    await tx.salesBillReceipt.delete({ where: { id: receiptId } });
    await recalculateSalesBillPaymentTotals(tx, billId);
    const updated = await tx.salesBill.findUnique({
      where: { id: billId },
      include: billInclude,
    });
    const companyState = await getCompanyState(tx);
    const intra = resolveSalesIntraFromStateCodes({ customer: updated.customer }).intraState;
    return withSalesBillGstBreakup(updated, { intraState: intra, companyState });
  });
}

/**
 * ERP-side AR tracking for finalized bills (not Tally ledger posting).
 * Updates due date and remarks only — receipts drive amounts.
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function updateSalesBillPaymentTracking(prisma, billId, input) {
  const inObj = input ?? {};
  const hasDue = Object.prototype.hasOwnProperty.call(inObj, "dueDate");
  const hasRem = Object.prototype.hasOwnProperty.call(inObj, "paymentRemarks");

  return prisma.$transaction(async (tx) => {
    const bill = await tx.salesBill.findUnique({
      where: { id: billId },
      include: billInclude,
    });
    if (!bill) throw friendlyError("Sales bill not found.", 404);
    if (bill.status !== "FINALIZED") throw friendlyError("Payment tracking applies only to finalized bills.", 409);
    if (bill.cancelledAt) throw friendlyError("Bill is cancelled.", 409);

    let dueDateVal = bill.dueDate;
    if (hasDue) {
      const dueDateRaw = inObj.dueDate;
      if (dueDateRaw === null || dueDateRaw === "") {
        dueDateVal = null;
      } else {
        const d = dueDateRaw instanceof Date ? dueDateRaw : new Date(dueDateRaw);
        if (Number.isNaN(d.getTime())) throw friendlyError("Please enter a valid due date.", 400);
        dueDateVal = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      }
    }

    let paymentRemarksVal = bill.paymentRemarks;
    if (hasRem) {
      const remarksRaw = inObj.paymentRemarks;
      paymentRemarksVal =
        remarksRaw != null && String(remarksRaw).trim() !== "" ? String(remarksRaw).trim().slice(0, 4000) : null;
    }

    const updated = await tx.salesBill.update({
      where: { id: billId },
      data: {
        dueDate: dueDateVal,
        paymentRemarks: paymentRemarksVal,
      },
      include: billInclude,
    });

    const companyState = await getCompanyState(tx);
    const intra = resolveSalesIntraFromStateCodes({ customer: updated.customer }).intraState;
    return withSalesBillGstBreakup(updated, { intraState: intra, companyState });
  });
}

async function deleteDraft(prisma, billId) {
  return prisma.$transaction(async (tx) => {
    const bill = await tx.salesBill.findUnique({ where: { id: billId }, select: { id: true, status: true, isExported: true } });
    if (!bill) throw friendlyError("Sales bill not found.", 404);
    if (bill.isExported) throw friendlyError("Cannot delete: this sales bill has already been exported.", 409);
    if (bill.status !== "DRAFT") throw friendlyError("Only draft Sales Bills can be deleted.", 409);
    await tx.salesBillLine.deleteMany({ where: { salesBillId: billId } });
    await tx.salesBill.delete({ where: { id: billId } });
  });
}

async function getSalesBillById(prisma, id) {
  const bill = await prisma.salesBill.findUnique({ where: { id }, include: billInclude });
  if (!bill) throw friendlyError("Sales bill not found.", 404);
  const companyState = await getCompanyState(prisma);
  const intra = resolveSalesIntraFromStateCodes({ customer: bill.customer }).intraState;
  return withSalesBillGstBreakup(bill, { intraState: intra, companyState });
}

module.exports = {
  listSalesBills,
  getEligibleDispatches,
  createDraftFromDispatch,
  updateDraft,
  patchDraftSalesBillLineRate,
  finalizeBill,
  cancelBill,
  deleteDraft,
  getSalesBillById,
  updateSalesBillPaymentTracking,
  addSalesBillReceipt,
  deleteSalesBillReceipt,
};

