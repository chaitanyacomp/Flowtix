const { resolvePurchaseIntraState } = require("./purchaseStateCompare");
const { COMPANY_STATE } = require("../config/company");
const { isTestingModeRelaxed, resolveLineTaxFromItem, resolveSupplierSnapshots } = require("./rmPoTaxFields");

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function fmt2(n) {
  return round2(n).toFixed(2);
}

function withPurchaseBillGstBreakup(bill, { intraState, companyState }) {
  const lines = Array.isArray(bill?.lines) ? bill.lines : [];
  const nextLines = lines.map((ln) => {
    const basic = Number(ln.basicAmount ?? 0);
    const cgst = Number(ln.cgstAmount ?? 0);
    const sgst = Number(ln.sgstAmount ?? 0);
    const igst = Number(ln.igstAmount ?? 0);
    const gst = cgst + sgst + igst;
    return {
      ...ln,
      baseAmount: fmt2(basic),
      gstAmount: fmt2(gst),
    };
  });

  return {
    ...bill,
    taxIntraState: Boolean(intraState),
    companyGstin: companyState?.companyGstin ?? null,
    companyStateName: companyState?.companyStateRef?.stateName ?? null,
    companyStateCode: companyState?.companyStateRef?.stateCode ?? null,
    supplierGstin: bill?.supplier?.gst ?? null,
    supplierStateName: bill?.supplier?.stateName ?? bill?.supplier?.stateRef?.stateName ?? null,
    supplierStateCode: bill?.supplier?.stateCode ?? bill?.supplier?.stateRef?.stateCode ?? null,
    totalCgst: bill.totalCgst,
    totalSgst: bill.totalSgst,
    totalIgst: bill.totalIgst,
    lines: nextLines,
  };
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

function resolveIntraFromStateCodes({ supplier }) {
  const supplierCode = supplier?.stateCode ?? supplier?.stateRef?.stateCode ?? null;
  if (!supplierCode) return { intraState: false, basis: "MISSING_SUPPLIER_STATE_CODE" };
  return { intraState: String(supplierCode) === String(COMPANY_STATE.code), basis: "STATIC_CODE" };
}

/** Prefer stable snapshot stored on PurchaseBill (or supplier fallbacks). */
function resolveIntraForBill(bill, companyState) {
  const supplierCode =
    bill?.supplierStateCodeSnapshot ??
    bill?.supplier?.stateCode ??
    bill?.supplier?.stateRef?.stateCode ??
    null;
  if (!supplierCode) return { intraState: false, basis: "MISSING_SUPPLIER_STATE_CODE" };
  return { intraState: String(supplierCode) === String(companyState?.companyStateRef?.stateCode ?? COMPANY_STATE.code), basis: "BILL_SNAPSHOT_OR_SUPPLIER" };
}

function isFallbackTaxLine(ln) {
  const hsn = String(ln?.hsnCodeSnapshot ?? "").trim();
  const gst = Number(ln?.gstRate);
  return hsn === "0000" || (Number.isFinite(gst) && gst === 0);
}

function assertDraftEditable(bill) {
  if (!bill) throw friendlyError("Purchase bill not found.", 404);
  if (bill.status !== "DRAFT") throw friendlyError("Only draft bills can be edited.", 409);
}

function assertFinalizable(bill) {
  if (!bill) throw friendlyError("Purchase bill not found.", 404);
  if (bill.status !== "DRAFT") throw friendlyError("Only draft bills can be finalized.", 409);
  if (bill.isExported) throw friendlyError("Cannot finalize an exported bill.", 409);
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

const billInclude = {
  supplier: { include: { stateRef: { select: { id: true, stateName: true, stateCode: true } } } },
  grn: { select: { id: true, date: true, rmPo: { select: { id: true } } } },
  lines: {
    orderBy: { id: "asc" },
    include: {
      item: true,
      grnLine: {
        select: {
          id: true,
          grnId: true,
          receivedQty: true,
          rmPoLineId: true,
          grn: { select: { id: true, date: true, rmPoId: true } },
        },
      },
    },
  },
};

function friendlyError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

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

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} tx
 */
async function loadGrnForBilling(tx, grnId) {
  return tx.grn.findUnique({
    where: { id: grnId },
    include: {
      lines: {
        orderBy: { id: "asc" },
        include: { rmPoLine: { include: { item: true } } },
      },
      rmPo: { include: { supplier: true } },
      purchaseBills: { select: { id: true, status: true } },
    },
  });
}

function linePayloadFromGrnLine(grnLine, companyState, supplier) {
  const item = grnLine.rmPoLine.item;
  const poLine = grnLine.rmPoLine;
  const qty = Number(grnLine.receivedQty);
  // Prefer GRN snapshot (stable); fallback to PO line rate for legacy rows (no snapshot).
  let rate = Number(grnLine.rateSnapshot ?? 0);
  if (!Number.isFinite(rate) || rate <= 0) {
    rate = Number(poLine?.rate ?? 0);
  }
  if (!Number.isFinite(rate) || rate < 0) rate = 0;
  const gstFromPo =
    poLine?.gstRate != null && String(poLine.gstRate).trim() !== "" ? Number(poLine.gstRate) : null;
  const gstRate = gstFromPo != null && Number.isFinite(gstFromPo) ? gstFromPo : item.gstRate != null ? Number(item.gstRate) : 0;
  let unitSnap =
    (poLine?.unit && String(poLine.unit).trim()) || (item.unit && String(item.unit).trim()) || "";
  const hsnFromPo = poLine?.hsn && String(poLine.hsn).trim();
  let hsnCodeSnapshot = String(hsnFromPo || item.hsnCode || "")
    .trim()
    .toUpperCase()
    .slice(0, 32);
  // If strict mode and upstream master data is incomplete, fail early with a clear error.
  // In relaxed testing mode, apply fallbacks so billing does not crash.
  if ((!unitSnap || !hsnCodeSnapshot) && isTestingModeRelaxed()) {
    const r = resolveLineTaxFromItem(item, { relaxed: true });
    if (!unitSnap) unitSnap = r.unit;
    if (!hsnCodeSnapshot) hsnCodeSnapshot = r.hsn;
  } else if (!isTestingModeRelaxed()) {
    if (!unitSnap) throw friendlyError("Cannot create purchase bill: item master missing unit.");
    if (!hsnCodeSnapshot) throw friendlyError("Cannot create purchase bill: item master missing HSN.");
  }
  const intra = resolveIntraFromStateCodes({ supplier }).intraState;
  const calc = computeLineTaxSplit(qty * rate, gstRate, intra);
  return {
    itemId: item.id,
    itemNameSnapshot: String(item.itemName || "").slice(0, 256),
    qty: String(qty),
    unitSnapshot: unitSnap,
    hsnCodeSnapshot,
    rate: String(rate),
    basicAmount: String(calc.basicAmount),
    gstRate: String(calc.gstRate),
    cgstAmount: String(calc.cgstAmount),
    sgstAmount: String(calc.sgstAmount),
    igstAmount: String(calc.igstAmount),
    lineTotal: String(calc.lineTotal),
    _meta: { totalTax: calc.totalTax },
  };
}

async function computeFinalizedBilledQtyByGrnLineId(tx, grnLineIds) {
  if (!Array.isArray(grnLineIds) || grnLineIds.length === 0) return new Map();
  const rows = await tx.purchaseBillLine.groupBy({
    by: ["grnLineId"],
    where: { grnLineId: { in: grnLineIds }, purchaseBill: { status: "FINALIZED" } },
    _sum: { qty: true },
  });
  return new Map(rows.map((r) => [r.grnLineId, Number(r._sum.qty || 0)]));
}

async function getEligibleGrnLinesBySupplier(prisma, supplierId) {
  const sid = Number(supplierId);
  if (!Number.isFinite(sid) || sid <= 0) {
    throw friendlyError("Please select a valid supplier.");
  }

  // Load candidate GRNs: active, not reversed, belonging to supplier via RM PO.
  const grns = await prisma.grn.findMany({
    where: {
      reversedAt: null,
      rmPo: { supplierId: sid, status: { not: "CANCELLED" } },
    },
    orderBy: { id: "desc" },
    include: {
      rmPo: { select: { id: true, supplierId: true } },
      lines: {
        orderBy: { id: "asc" },
        include: {
          rmPoLine: { include: { item: { include: { unitRef: { select: { unitName: true } } } } } },
        },
      },
    },
  });

  if (!grns.length) return [];

  const grnLineIds = grns.flatMap((g) => g.lines.map((l) => l.id));
  const billed = await prisma.purchaseBillLine.groupBy({
    by: ["grnLineId"],
    where: {
      grnLineId: { in: grnLineIds },
      purchaseBill: { status: "FINALIZED" },
    },
    _sum: { qty: true },
  });
  const billedByGrnLineId = new Map(billed.map((r) => [r.grnLineId, Number(r._sum.qty || 0)]));

  return grns.map((g) => ({
    id: g.id,
    date: g.date,
    rmPoId: g.rmPo?.id ?? null,
    lines: g.lines
      .map((gl) => {
        const received = Number(gl.receivedQty);
        const already = billedByGrnLineId.get(gl.id) || 0;
        const remaining = Math.max(0, received - already);
        return {
          grnLineId: gl.id,
          rmPoLineId: gl.rmPoLineId,
          itemId: gl.rmPoLine.itemId,
          itemName: gl.rmPoLine.item?.itemName ?? "",
          receivedQty: received,
          alreadyBilledQty: already,
          remainingQty: remaining,
          rateSnapshot: gl.rateSnapshot,
          poLine: {
            unit: gl.rmPoLine.unit ?? null,
            hsn: gl.rmPoLine.hsn ?? null,
            gstRate: gl.rmPoLine.gstRate ?? null,
            rate: gl.rmPoLine.rate ?? null,
          },
          item: {
            unit: gl.rmPoLine.item?.unit ?? "",
            unitName: gl.rmPoLine.item?.unitRef?.unitName ?? null,
            hsnCode: gl.rmPoLine.item?.hsnCode ?? null,
            gstRate: gl.rmPoLine.item?.gstRate ?? null,
          },
        };
      })
      .filter((l) => l.remainingQty > 0),
  }));
}

async function createDraftFromSelection(prisma, body) {
  const { z } = require("zod");
  const schema = z.object({
    supplierId: z.number().int().positive(),
    billNo: z.string().optional().nullable(),
    billDate: z.string().optional().nullable(),
    remarks: z.string().optional().nullable(),
    selections: z
      .array(
        z.object({
          grnLineId: z.number().int().positive(),
          qty: z.number().positive(),
        }),
      )
      .min(1),
  });
  const data = schema.parse(body);

  const relaxed = isTestingModeRelaxed();

  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({
      where: { id: data.supplierId },
      include: { stateRef: { select: { stateName: true, stateCode: true } } },
    });
    if (!supplier) throw friendlyError("Supplier not found.", 404);
    const supplierSnap = resolveSupplierSnapshots(supplier, { relaxed });

    const ids = [...new Set(data.selections.map((s) => s.grnLineId))];
    const grnLines = await tx.grnLine.findMany({
      where: { id: { in: ids } },
      include: {
        grn: { include: { rmPo: { include: { supplier: true } } } },
        rmPoLine: { include: { item: { include: { unitRef: { select: { unitName: true } } } } } },
      },
    });
    const byId = new Map(grnLines.map((l) => [l.id, l]));

    // Compute remaining qty per line based on FINALIZED bills only (DRAFT/CANCELLED do not lock).
    const billedBy = await computeFinalizedBilledQtyByGrnLineId(tx, ids);

    const lineRows = [];
    const meta = [];
    const warnings = [];

    for (const sel of data.selections) {
      const gl = byId.get(sel.grnLineId);
      if (!gl) throw friendlyError("One or more selected GRN lines are invalid.", 400);
      if (gl.grn.reversedAt) throw friendlyError("Cannot bill a reversed GRN.", 409);
      if (gl.grn.rmPo.supplierId !== data.supplierId) throw friendlyError("Selected GRN line does not belong to chosen supplier.", 400);

      const received = Number(gl.receivedQty);
      const already = billedBy.get(gl.id) || 0;
      const remaining = Math.max(0, received - already);
      if (sel.qty > remaining + 1e-9) {
        throw friendlyError(`Cannot bill more than remaining qty (${remaining}) for GRN line #${gl.id}.`, 400);
      }

      const companyState = await getCompanyState(tx);
      const payload = linePayloadFromGrnLine(
        { ...gl, receivedQty: sel.qty }, // pretend receivedQty = billed qty for tax split
        companyState,
        supplier,
      );
      const { _meta, ...row } = payload;
      meta.push(_meta);
      lineRows.push({
        ...row,
        grnId: gl.grnId,
        grnLineId: gl.id,
        rmPoId: gl.grn.rmPoId,
        rmPoLineId: gl.rmPoLineId,
      });
    }

    const totals = sumTotals(
      lineRows.map((row, i) => ({
        basicAmount: Number(row.basicAmount),
        cgstAmount: Number(row.cgstAmount),
        sgstAmount: Number(row.sgstAmount),
        igstAmount: Number(row.igstAmount),
        lineTotal: Number(row.lineTotal),
        totalTax: meta[i].totalTax,
      })),
    );

    const today = new Date();
    const billDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

    const created = await tx.purchaseBill.create({
      data: {
        billNo: data.billNo?.trim() || null,
        billDate,
        dueDate: null,
        supplierId: data.supplierId,
        grnId: null,
        remarks: data.remarks?.trim() || null,
        status: "DRAFT",
        supplierStateSnapshot: supplierSnap.supplierStateSnapshot,
        supplierStateCodeSnapshot: supplierSnap.supplierStateCodeSnapshot,
        hasTemporaryTaxData: relaxed && lineRows.some((r) => String(r.hsnCodeSnapshot).trim() === "0000" || Number(r.gstRate) === 0),
        totalBasic: String(totals.totalBasic),
        totalCgst: String(totals.totalCgst),
        totalSgst: String(totals.totalSgst),
        totalIgst: String(totals.totalIgst),
        totalTax: String(totals.totalTax),
        netAmount: String(totals.netAmount),
        lines: { create: lineRows },
      },
      include: billInclude,
    });

    const csAfter = await getCompanyState(tx);
    const intra = resolveIntraFromStateCodes({ supplier: created.supplier ?? null }).intraState;
    return {
      bill: withPurchaseBillGstBreakup(created, { intraState: intra, companyState: csAfter }),
      warnings: [...new Set([...supplierSnap.warnings, ...warnings])],
    };
  });
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function createDraftForGrn(prisma, grnId) {
  if (!Number.isFinite(grnId) || grnId <= 0) {
    throw friendlyError("Please select a valid GRN.");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.purchaseBill.findFirst({
      where: { grnId, status: "DRAFT" },
      orderBy: { id: "desc" },
      include: billInclude,
    });
    if (existing) {
      const cs0 = await getCompanyState(tx);
      const intra0 = resolveIntraFromStateCodes({ supplier: existing.supplier ?? null }).intraState;
      return {
        bill: withPurchaseBillGstBreakup(existing, { intraState: intra0, companyState: cs0 }),
        created: false,
      };
    }

    const grn = await loadGrnForBilling(tx, grnId);
    if (!grn) {
      throw friendlyError("GRN not found.", 404);
    }
    if (grn.reversedAt) {
      throw friendlyError("Cannot bill a reversed GRN.");
    }
    if (!grn.lines.length) {
      throw friendlyError("This GRN has no line items.");
    }

    const companyState = await getCompanyState(tx);
    const supplier = grn.rmPo.supplier ?? null;

    // Only bill remaining quantities (already billed FINALIZED lines are excluded).
    const grnLineIds = grn.lines.map((l) => l.id);
    const billedBy = await computeFinalizedBilledQtyByGrnLineId(tx, grnLineIds);

    const lineRows = [];
    const meta = [];
    for (const gl of grn.lines) {
      const received = Number(gl.receivedQty);
      const already = billedBy.get(gl.id) || 0;
      const remaining = Math.max(0, received - already);
      if (remaining <= 1e-9) continue;
      const payload = linePayloadFromGrnLine({ ...gl, receivedQty: remaining }, companyState, supplier);
      const { _meta, ...data } = payload;
      meta.push(_meta);
      lineRows.push({
        ...data,
        grnId: gl.grnId,
        grnLineId: gl.id,
        rmPoId: grn.rmPoId,
        rmPoLineId: gl.rmPoLineId,
      });
    }
    if (!lineRows.length) {
      throw friendlyError("This GRN has no remaining quantity to bill.");
    }
    const totals = sumTotals(
      lineRows.map((row, i) => ({
        basicAmount: Number(row.basicAmount),
        cgstAmount: Number(row.cgstAmount),
        sgstAmount: Number(row.sgstAmount),
        igstAmount: Number(row.igstAmount),
        lineTotal: Number(row.lineTotal),
        totalTax: meta[i].totalTax,
      })),
    );

    const today = new Date();
    const billDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

    const created = await tx.purchaseBill.create({
      data: {
        billNo: null,
        billDate,
        dueDate: null,
        supplierId: grn.rmPo.supplierId,
        grnId: grn.id,
        remarks: null,
        status: "DRAFT",
        supplierStateSnapshot: resolveSupplierSnapshots(supplier, { relaxed: isTestingModeRelaxed() }).supplierStateSnapshot,
        supplierStateCodeSnapshot: resolveSupplierSnapshots(supplier, { relaxed: isTestingModeRelaxed() }).supplierStateCodeSnapshot,
        hasTemporaryTaxData: isTestingModeRelaxed() && lineRows.some((r) => String(r.hsnCodeSnapshot).trim() === "0000" || Number(r.gstRate) === 0),
        totalBasic: String(totals.totalBasic),
        totalCgst: String(totals.totalCgst),
        totalSgst: String(totals.totalSgst),
        totalIgst: String(totals.totalIgst),
        totalTax: String(totals.totalTax),
        netAmount: String(totals.netAmount),
        lines: { create: lineRows },
      },
      include: billInclude,
    });

    const companyStateAfter = await getCompanyState(tx);
    const intra = resolveIntraFromStateCodes({ supplier: created.supplier ?? null }).intraState;
    return {
      bill: withPurchaseBillGstBreakup(created, { intraState: intra, companyState: companyStateAfter }),
      created: true,
    };
  });
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function updateDraft(prisma, billId, body) {
  const {
    billNo,
    billDate,
    dueDate,
    remarks,
    lines: lineUpdates,
  } = body;

  return prisma.$transaction(async (tx) => {
    const bill = await tx.purchaseBill.findUnique({
      where: { id: billId },
      include: {
        lines: { orderBy: { id: "asc" }, include: { item: true, grnLine: { select: { id: true, receivedQty: true } } } },
        supplier: { include: { stateRef: { select: { id: true, stateName: true, stateCode: true } } } },
      },
    });
    assertDraftEditable(bill);

    const companyState = await getCompanyState(tx);
    const supplier = bill.supplier ?? null;
    const cmp = resolvePurchaseIntraState({ company: companyState, supplier });
    const intra = cmp.intraState;

    const lineById = new Map(bill.lines.map((l) => [l.id, l]));
    const grnLineIds = bill.lines.map((l) => l.grnLineId).filter((x) => Number.isFinite(Number(x))).map(Number);
    const billedBy = await computeFinalizedBilledQtyByGrnLineId(tx, grnLineIds);
    const nextLines = [];

    for (const lu of lineUpdates) {
      const row = lineById.get(lu.id);
      if (!row) {
        throw friendlyError("One or more line items are invalid for this bill.");
      }
      const qty = lu.qty != null ? Number(lu.qty) : Number(row.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw friendlyError("Please enter a valid positive quantity for every line.");
      }
      // Over-billing protection (FINALIZED only count; drafts/cancelled do not lock).
      if (row.grnLineId != null) {
        const received = row.grnLine ? Number(row.grnLine.receivedQty) : NaN;
        const alreadyFinalized = billedBy.get(Number(row.grnLineId)) || 0;
        const remaining = Number.isFinite(received) ? Math.max(0, received - alreadyFinalized) : NaN;
        if (Number.isFinite(remaining) && qty > remaining + 1e-9) {
          throw friendlyError(`Qty exceeds remaining eligible GRN qty (${remaining}) for one or more lines.`, 400);
        }
      }
      const rate = Number(lu.rate);
      if (!Number.isFinite(rate) || rate <= 0) {
        throw friendlyError("Please enter a valid positive rate for every line.");
      }
      const gstRate = Number(row.gstRate);
      const calc = computeLineTaxSplit(qty * rate, gstRate, intra);
      nextLines.push({
        id: row.id,
        qty,
        ...calc,
        rate,
        gstRate,
      });
    }

    if (nextLines.length !== bill.lines.length) {
      throw friendlyError("Every line on this bill must be included when saving.");
    }

    const totals = sumTotals(
      nextLines.map((l) => ({
        basicAmount: l.basicAmount,
        cgstAmount: l.cgstAmount,
        sgstAmount: l.sgstAmount,
        igstAmount: l.igstAmount,
        lineTotal: l.lineTotal,
        totalTax: l.totalTax,
      })),
    );

    const trimmedBillNo = billNo != null && String(billNo).trim() !== "" ? String(billNo).trim() : null;
    let parsedBillDate = billDate instanceof Date ? billDate : new Date(billDate);
    if (Number.isNaN(parsedBillDate.getTime())) {
      throw friendlyError("Please enter a valid bill date.");
    }
    parsedBillDate = new Date(
      Date.UTC(parsedBillDate.getUTCFullYear(), parsedBillDate.getUTCMonth(), parsedBillDate.getUTCDate()),
    );

    let parsedDue = null;
    if (dueDate != null && String(dueDate).trim() !== "") {
      const d = dueDate instanceof Date ? dueDate : new Date(dueDate);
      if (Number.isNaN(d.getTime())) {
        throw friendlyError("Please enter a valid due date, or leave it blank.");
      }
      parsedDue = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }

    for (const nl of nextLines) {
      await tx.purchaseBillLine.update({
        where: { id: nl.id },
        data: {
          qty: String(nl.qty),
          rate: String(nl.rate),
          basicAmount: String(nl.basicAmount),
          gstRate: String(nl.gstRate),
          cgstAmount: String(nl.cgstAmount),
          sgstAmount: String(nl.sgstAmount),
          igstAmount: String(nl.igstAmount),
          lineTotal: String(nl.lineTotal),
        },
      });
    }

    const updated = await tx.purchaseBill.update({
      where: { id: billId },
      data: {
        billNo: trimmedBillNo,
        billDate: parsedBillDate,
        dueDate: parsedDue,
        remarks: remarks != null && String(remarks).trim() !== "" ? String(remarks).trim() : null,
        supplierStateSnapshot: resolveSupplierSnapshots(supplier, { relaxed: isTestingModeRelaxed() }).supplierStateSnapshot,
        supplierStateCodeSnapshot: resolveSupplierSnapshots(supplier, { relaxed: isTestingModeRelaxed() }).supplierStateCodeSnapshot,
        totalBasic: String(totals.totalBasic),
        totalCgst: String(totals.totalCgst),
        totalSgst: String(totals.totalSgst),
        totalIgst: String(totals.totalIgst),
        totalTax: String(totals.totalTax),
        netAmount: String(totals.netAmount),
      },
      include: billInclude,
    });

    return withPurchaseBillGstBreakup(updated, { intraState: intra, companyState });
  });
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function finalizeBill(prisma, billId) {
  return prisma.$transaction(async (tx) => {
    const bill = await tx.purchaseBill.findUnique({
      where: { id: billId },
      include: {
        lines: { orderBy: { id: "asc" }, include: { item: true } },
        supplier: { include: { stateRef: { select: { id: true, stateName: true, stateCode: true } } } },
      },
    });
    assertFinalizable(bill);

    const billNoTrim = bill.billNo != null ? String(bill.billNo).trim() : "";
    if (!billNoTrim) {
      throw friendlyError("Supplier invoice number is required to finalize.");
    }

    if (!bill.lines.length) {
      throw friendlyError("Add at least one line item before finalizing.");
    }

    const relaxed = isTestingModeRelaxed();
    for (const ln of bill.lines) {
      const hsn = String(ln.hsnCodeSnapshot ?? "").trim();
      const nm = String(ln.itemNameSnapshot ?? "").trim();
      if (!hsn || !nm) {
        throw friendlyError(
          "Cannot finalize purchase bill because one or more lines are missing HSN code or item snapshot.",
          409,
        );
      }
      const g0 = Number(ln.gstRate);
      if (!Number.isFinite(g0) || g0 < 0 || g0 > 100) {
        throw friendlyError(
          "Cannot finalize purchase bill because one or more lines are missing GST rate or have an invalid GST rate.",
          409,
        );
      }
      const unit0 = String(ln.unitSnapshot ?? "").trim();
      if (!unit0) {
        throw friendlyError("Cannot finalize purchase bill because one or more lines are missing unit.", 409);
      }
      if (!relaxed) {
        if (hsn === "0000") {
          throw friendlyError("Cannot finalize purchase bill in strict mode because one or more lines have placeholder HSN (0000).", 409);
        }
        if (g0 === 0) {
          throw friendlyError("Cannot finalize purchase bill in strict mode because one or more lines have GST rate 0.", 409);
        }
      }
    }

    for (const ln of bill.lines) {
      const r = Number(ln.rate);
      if (!Number.isFinite(r) || r <= 0) {
        throw friendlyError("Enter a rate greater than zero for every item before finalizing.");
      }
    }

    const dupMsg = "This supplier invoice number already exists for this supplier.";
    const dup = await tx.purchaseBill.findFirst({
      where: {
        supplierId: bill.supplierId,
        status: "FINALIZED",
        billNo: billNoTrim,
        NOT: { id: bill.id },
      },
      select: { id: true },
    });
    if (dup) {
      throw friendlyError(dupMsg);
    }

    const companyState = await getCompanyState(tx);
    const supplier = bill.supplier ?? null;
    const supplierCode = supplier?.stateCode ?? supplier?.stateRef?.stateCode ?? null;
    const supplierName = supplier?.stateName ?? supplier?.stateRef?.stateName ?? supplier?.state ?? null;
    if ((!supplierCode || !supplierName) && !relaxed) {
      throw friendlyError(
        "Supplier state is required to finalize purchase bill. Update the supplier stateName/stateCode first.",
        409,
      );
    }
    const intra = resolveIntraFromStateCodes({ supplier }).intraState;

    const rebuilt = [];
    for (const ln of bill.lines) {
      const qty = Number(ln.qty);
      const rate = Number(ln.rate);
      const gstRate = Number(ln.gstRate);
      const calc = computeLineTaxSplit(qty * rate, gstRate, intra);
      rebuilt.push({ id: ln.id, ...calc, rate, gstRate });
      await tx.purchaseBillLine.update({
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

    const totals = sumTotals(
      rebuilt.map((l) => ({
        basicAmount: l.basicAmount,
        cgstAmount: l.cgstAmount,
        sgstAmount: l.sgstAmount,
        igstAmount: l.igstAmount,
        lineTotal: l.lineTotal,
        totalTax: l.totalTax,
      })),
    );

    const dupAgain = await tx.purchaseBill.findFirst({
      where: {
        supplierId: bill.supplierId,
        status: "FINALIZED",
        billNo: billNoTrim,
        NOT: { id: bill.id },
      },
      select: { id: true },
    });
    if (dupAgain) {
      throw friendlyError(dupMsg);
    }

    const snap = resolveSupplierSnapshots(supplier, { relaxed });
    const finalized = await tx.purchaseBill.update({
      where: { id: billId },
      data: {
        billNo: billNoTrim,
        status: "FINALIZED",
        finalizedAt: new Date(),
        supplierStateSnapshot: snap.supplierStateSnapshot,
        supplierStateCodeSnapshot: snap.supplierStateCodeSnapshot,
        hasTemporaryTaxData: Boolean(bill.hasTemporaryTaxData) || (relaxed && bill.lines.some(isFallbackTaxLine)),
        totalBasic: String(totals.totalBasic),
        totalCgst: String(totals.totalCgst),
        totalSgst: String(totals.totalSgst),
        totalIgst: String(totals.totalIgst),
        totalTax: String(totals.totalTax),
        netAmount: String(totals.netAmount),
      },
      include: billInclude,
    });

    // Recompute billingStatus for all GRNs referenced by this bill's lines (partial billing supported).
    const touchedGrnIds = [...new Set(bill.lines.map((l) => l.grnId).filter((x) => Number.isFinite(Number(x))))].map(Number);
    for (const grnId of touchedGrnIds) {
      const grn = await tx.grn.findUnique({ where: { id: grnId }, include: { lines: true } });
      if (!grn || grn.reversedAt) continue;
      const glIds = grn.lines.map((l) => l.id);
      if (!glIds.length) continue;
      const sums = await tx.purchaseBillLine.groupBy({
        by: ["grnLineId"],
        where: { grnLineId: { in: glIds }, purchaseBill: { status: "FINALIZED" } },
        _sum: { qty: true },
      });
      const byLine = new Map(sums.map((r) => [r.grnLineId, Number(r._sum.qty || 0)]));
      const allBilled = grn.lines.every((gl) => (byLine.get(gl.id) || 0) >= Number(gl.receivedQty) - 1e-9);
      await tx.grn.update({
        where: { id: grn.id },
        data: { billingStatus: allBilled ? "BILLED" : "PENDING" },
      });
    }

    return withPurchaseBillGstBreakup(finalized, { intraState: intra, companyState });
  });
}

/**
 * Cancel a finalized bill (audit trail kept). Restores GRN eligibility by status.
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function cancelBill(prisma, billId, { reason, actorUserId, allowExported = false } = {}) {
  return prisma.$transaction(async (tx) => {
    const bill = await tx.purchaseBill.findUnique({
      where: { id: billId },
      include: { lines: { select: { grnId: true, grnLineId: true } }, supplier: true },
    });
    if (!bill) throw friendlyError("Purchase bill not found.", 404);
    if (bill.status === "CANCELLED") throw friendlyError("This purchase bill is already cancelled.", 409);
    if (bill.status !== "FINALIZED") throw friendlyError("Only finalized purchase bills can be cancelled.", 409);
    if (bill.isExported && !allowExported) throw friendlyError("Cannot cancel an exported purchase bill.", 409);

    const reasonTrim = String(reason || "").trim();
    if (!reasonTrim) throw friendlyError("Cancel reason is required.", 400);

    const cancelled = await tx.purchaseBill.update({
      where: { id: billId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: reasonTrim,
        cancelledById: typeof actorUserId === "number" && Number.isFinite(actorUserId) ? actorUserId : null,
      },
      include: billInclude,
    });

    // Recompute billingStatus for impacted GRNs (FINALIZED only count; cancelled frees qty).
    const touchedGrnIds = [...new Set((bill.lines || []).map((l) => l.grnId).filter((x) => Number.isFinite(Number(x))))].map(Number);
    for (const grnId of touchedGrnIds) {
      const grn = await tx.grn.findUnique({ where: { id: grnId }, include: { lines: true } });
      if (!grn || grn.reversedAt) continue;
      const glIds = grn.lines.map((l) => l.id);
      if (!glIds.length) continue;
      const sums = await tx.purchaseBillLine.groupBy({
        by: ["grnLineId"],
        where: { grnLineId: { in: glIds }, purchaseBill: { status: "FINALIZED" } },
        _sum: { qty: true },
      });
      const byLine = new Map(sums.map((r) => [r.grnLineId, Number(r._sum.qty || 0)]));
      const allBilled = grn.lines.every((gl) => (byLine.get(gl.id) || 0) >= Number(gl.receivedQty) - 1e-9);
      await tx.grn.update({ where: { id: grn.id }, data: { billingStatus: allBilled ? "BILLED" : "PENDING" } });
    }

    const companyState = await getCompanyState(tx);
    const intra = resolveIntraForBill(cancelled, companyState).intraState;
    return withPurchaseBillGstBreakup(cancelled, { intraState: intra, companyState });
  });
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function listPurchaseBills(prisma, query) {
  const {
    fromDate,
    toDate,
    supplierId,
    status,
    search,
  } = query;

  /** @type {import('@prisma/client').Prisma.PurchaseBillWhereInput} */
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

  if (supplierId != null && supplierId !== "") {
    const sid = Number(supplierId);
    if (Number.isFinite(sid)) {
      where.supplierId = sid;
    }
  }

  if (status === "DRAFT" || status === "FINALIZED") {
    where.status = status;
  }

  const searchTrim = typeof search === "string" ? search.trim() : "";
  if (searchTrim) {
    where.OR = [
      { billNo: { contains: searchTrim } },
      { supplier: { name: { contains: searchTrim } } },
    ];
  }

  return prisma.purchaseBill.findMany({
    where,
    orderBy: { id: "desc" },
    include: {
      supplier: { select: { id: true, name: true } },
      grn: { select: { id: true } },
    },
  });
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function getUnbilledGrns(prisma) {
  return prisma.grn.findMany({
    where: {
      reversedAt: null,
      billingStatus: "PENDING",
    },
    orderBy: { id: "desc" },
    include: {
      rmPo: {
        include: {
          supplier: { select: { id: true, name: true } },
        },
      },
      purchaseBills: { select: { id: true, status: true }, orderBy: { id: "desc" } },
    },
  });
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function getPurchaseBillById(prisma, id) {
  const bill = await prisma.purchaseBill.findUnique({
    where: { id },
    include: billInclude,
  });
  if (!bill) {
    throw friendlyError("Purchase bill not found.", 404);
  }
  const companyState = await getCompanyState(prisma);
  const intra = resolveIntraForBill(bill, companyState).intraState;
  return withPurchaseBillGstBreakup(bill, { intraState: intra, companyState });
}

module.exports = {
  createDraftForGrn,
  createDraftFromSelection,
  updateDraft,
  finalizeBill,
  cancelBill,
  listPurchaseBills,
  getUnbilledGrns,
  getEligibleGrnLinesBySupplier,
  getPurchaseBillById,
};
