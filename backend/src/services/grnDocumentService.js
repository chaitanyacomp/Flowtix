const { qtyToNumber, sumReceivedByRmPoLineFromGrns } = require("./rmPurchaseHelpers");
const {
  enrichRmPurchaseOrderCommercial,
  getCompanyStateCode,
} = require("./purchaseCommercialAddress");
const { buildRmPoProcurementTrace, grnDisplayNo, rmPoDisplayNo } = require("./procurementTraceService");

function roundMoney(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function mapStockPosting(row, grnReversed) {
  if (!row) return null;
  const posted = qtyToNumber(row.qtyIn) > 0;
  const txnReversed = Boolean(row.reversedAt);
  return {
    id: row.id,
    itemId: row.itemId,
    locationId: row.locationId,
    stockBucket: row.stockBucket,
    qtyPosted: qtyToNumber(row.qtyIn),
    date: row.date,
    transactionReversedAt: row.reversedAt,
    status: grnReversed || txnReversed ? "REVERSED" : posted ? "POSTED" : "NOT_POSTED",
  };
}

function mapBillLine(row) {
  const bill = row.purchaseBill;
  return {
    id: row.id,
    purchaseBillId: row.purchaseBillId,
    grnLineId: row.grnLineId,
    qty: qtyToNumber(row.qty),
    billNo: bill?.billNo ?? null,
    status: bill?.status ?? null,
    billDate: bill?.billDate ?? null,
  };
}

function lineBillStatusLabel(billLines) {
  const active = (billLines || []).filter((b) => b.status !== "CANCELLED");
  if (!active.length) return "NOT_BILLED";
  const finalized = active.filter((b) => b.status === "FINALIZED");
  if (finalized.length === active.length) return "BILLED";
  return "PARTIALLY_BILLED";
}

function grnBillStatusLabel(headerStatus, lineStatuses) {
  if (headerStatus === "BILLED") return "BILLED";
  const anyBilled = lineStatuses.some((s) => s === "BILLED" || s === "PARTIALLY_BILLED");
  if (anyBilled) return "PARTIALLY_BILLED";
  return "NOT_BILLED";
}

function filterTraceForGrn(fullTrace, grnId, rmPoLineIds) {
  if (!fullTrace) return { lines: [], grns: [] };
  const lineIdSet = new Set(rmPoLineIds);
  const lines = (fullTrace.lines || [])
    .filter((ln) => lineIdSet.has(ln.id))
    .map((ln) => ({
      ...ln,
      grnLines: (ln.grnLines || []).filter((gl) => gl.grnId === grnId),
      traceChain: ln.traceChain,
    }));
  const grns = (fullTrace.grns || []).filter((g) => g.id === grnId);
  return { lines, grns, rmPo: fullTrace.rmPo, supplier: fullTrace.supplier, supplierLocation: fullTrace.supplierLocation };
}

/**
 * Read-only GRN document payload for GET /api/purchase/grns/:id
 * @param {import('@prisma/client').PrismaClient} db
 * @param {number} grnId
 */
async function buildGrnDocumentDetail(db, grnId) {
  const grn = await db.grn.findUnique({
    where: { id: grnId },
    include: {
      supplier: { include: { stateRef: { select: { stateName: true, stateCode: true } } } },
      supplierLocation: { include: { stateRef: { select: { stateName: true, stateCode: true } } } },
      lines: {
        include: {
          location: { select: { id: true, locationName: true, locationCode: true } },
          rmPoLine: {
            include: {
              item: { select: { id: true, itemName: true, unit: true, hsnCode: true } },
            },
          },
        },
        orderBy: { id: "asc" },
      },
      rmPo: {
        include: {
          supplier: { include: { stateRef: { select: { stateName: true, stateCode: true } } } },
          supplierLocation: { include: { stateRef: { select: { stateName: true, stateCode: true } } } },
          lines: { include: { item: true }, orderBy: { id: "asc" } },
          grns: { include: { lines: true }, orderBy: { id: "asc" } },
        },
      },
      purchaseBills: { select: { id: true, billNo: true, status: true, billDate: true } },
    },
  });

  if (!grn) return null;

  const grnLineIds = grn.lines.map((l) => l.id);
  const rmPoLineIds = grn.lines.map((l) => l.rmPoLineId);

  const stockRows =
    grnLineIds.length > 0
      ? await db.stockTransaction.findMany({
          where: { transactionType: "GRN", refId: { in: grnLineIds } },
          orderBy: [{ id: "asc" }],
        })
      : [];
  const stockByGrnLineId = new Map(stockRows.map((st) => [st.refId, st]));

  const billRows =
    grnLineIds.length > 0
      ? await db.purchaseBillLine.findMany({
          where: { grnLineId: { in: grnLineIds } },
          include: {
            purchaseBill: { select: { id: true, billNo: true, status: true, billDate: true } },
          },
          orderBy: { id: "asc" },
        })
      : [];
  const billsByGrnLineId = new Map();
  for (const bl of billRows) {
    const list = billsByGrnLineId.get(bl.grnLineId) || [];
    list.push(mapBillLine(bl));
    billsByGrnLineId.set(bl.grnLineId, list);
  }

  const companyStateCode = await getCompanyStateCode(db);
  const enrichedPo = await enrichRmPurchaseOrderCommercial(db, grn.rmPo);
  const commercial = enrichedPo?.resolvedSupplierCommercial ?? null;

  const receivedAllActive = sumReceivedByRmPoLineFromGrns(grn.rmPo.grns);
  const receivedExcludingThis = sumReceivedByRmPoLineFromGrns(
    (grn.rmPo.grns || []).filter((g) => g.id !== grn.id),
  );

  const isReversed = Boolean(grn.reversedAt);
  const documentLines = grn.lines.map((gl) => {
    const poLine = gl.rmPoLine;
    const poQty = qtyToNumber(poLine?.qty);
    const thisQty = qtyToNumber(gl.receivedQty);
    const previouslyReceivedQty = receivedExcludingThis.get(gl.rmPoLineId) || 0;
    const totalReceivedQty = receivedAllActive.get(gl.rmPoLineId) || 0;
    const pendingQty = Math.max(0, poQty - totalReceivedQty);
    const rate = qtyToNumber(gl.rateSnapshot ?? poLine?.rate);
    const billLines = billsByGrnLineId.get(gl.id) || [];
    const stockTxn = stockByGrnLineId.get(gl.id) ?? null;

    return {
      id: gl.id,
      grnId: gl.grnId,
      rmPoLineId: gl.rmPoLineId,
      item: poLine?.item
        ? {
            id: poLine.item.id,
            itemName: poLine.item.itemName,
            unit: poLine.unit ?? poLine.item.unit ?? null,
            hsn: poLine.hsn ?? poLine.item.hsnCode ?? null,
          }
        : null,
      poQty,
      previouslyReceivedQty,
      thisGrnQty: thisQty,
      totalReceivedQty,
      pendingQty,
      rate,
      amount: roundMoney(thisQty * rate),
      location: gl.location
        ? {
            id: gl.location.id,
            name: gl.location.locationName,
            code: gl.location.locationCode,
          }
        : null,
      stockPosting: mapStockPosting(stockTxn, isReversed),
      purchaseBillLines: billLines,
      billStatus: lineBillStatusLabel(billLines),
    };
  });

  const lineBillStatuses = documentLines.map((l) => l.billStatus);
  const purchaseBillSummary = {
    headerBillingStatus: grn.billingStatus,
    documentBillStatus: grnBillStatusLabel(grn.billingStatus, lineBillStatuses),
    bills: grn.purchaseBills.map((b) => ({
      id: b.id,
      billNo: b.billNo,
      status: b.status,
      billDate: b.billDate,
    })),
  };

  const fullTrace = await buildRmPoProcurementTrace(db, grn.rmPoId);
  const trace = filterTraceForGrn(fullTrace, grn.id, rmPoLineIds);

  const registered = commercial?.registeredSupplier;
  const supply = commercial?.supplyLocation;

  return {
    grn: {
      id: grn.id,
      displayNo: grnDisplayNo(grn.id),
      date: grn.date,
      supplierInvoiceNo: grn.supplierInvoiceNo,
      billingStatus: grn.billingStatus,
      isReversed,
      reversedAt: grn.reversedAt,
      reversalReason: grn.reversalReason,
      supplierId: grn.supplierId,
      supplierLocationId: grn.supplierLocationId,
    },
    po: {
      id: grn.rmPoId,
      displayNo: rmPoDisplayNo(grn.rmPoId),
      status: grn.rmPo.status,
      supplierId: grn.rmPo.supplierId,
      supplierLocationId: grn.rmPo.supplierLocationId,
    },
    supplier: grn.supplier
      ? {
          id: grn.supplier.id,
          name: registered?.name ?? grn.supplier.name,
          address: registered?.address ?? grn.supplier.address ?? null,
          gstin: registered?.gstin ?? grn.supplier.gst ?? null,
          stateName: registered?.stateName ?? grn.supplier.stateRef?.stateName ?? null,
          stateCode: registered?.stateCode ?? grn.supplier.stateRef?.stateCode ?? null,
        }
      : null,
    supplyLocation: supply
      ? {
          id: supply.id ?? grn.supplierLocationId,
          label: supply.label ?? grn.supplierLocation?.label ?? null,
          address: supply.address ?? grn.supplierLocation?.address ?? null,
          gstin: supply.gstin ?? grn.supplierLocation?.gst ?? null,
          stateName: supply.stateName ?? grn.supplierLocation?.stateRef?.stateName ?? null,
          stateCode: supply.stateCode ?? grn.supplierLocation?.stateRef?.stateCode ?? null,
        }
      : grn.supplierLocation
        ? {
            id: grn.supplierLocation.id,
            label: grn.supplierLocation.label,
            address: grn.supplierLocation.address,
            gstin: grn.supplierLocation.gst,
            stateName: grn.supplierLocation.stateRef?.stateName ?? null,
            stateCode: grn.supplierLocation.stateRef?.stateCode ?? null,
          }
        : null,
    lines: documentLines,
    stockPostingSummary: documentLines.map((ln) => ({
      grnLineId: ln.id,
      itemName: ln.item?.itemName ?? null,
      location: ln.location,
      qtyPosted: ln.stockPosting?.qtyPosted ?? 0,
      status: ln.stockPosting?.status ?? "NOT_POSTED",
    })),
    purchaseBillSummary,
    trace,
    resolvedSupplierCommercial: commercial,
    companyStateCode,
  };
}

module.exports = {
  buildGrnDocumentDetail,
  filterTraceForGrn,
  lineBillStatusLabel,
  grnBillStatusLabel,
};
