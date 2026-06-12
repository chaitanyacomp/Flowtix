const { qtyToNumber, sumReceivedByRmPoLineFromGrns } = require("./rmPurchaseHelpers");

const RM_PO_INCLUDE = {
  supplier: {
    select: {
      id: true,
      name: true,
      gst: true,
      address: true,
      stateRef: { select: { stateName: true, stateCode: true } },
    },
  },
  supplierLocation: {
    select: {
      id: true,
      label: true,
      address: true,
      gst: true,
      stateRef: { select: { stateName: true, stateCode: true } },
    },
  },
  lines: {
    include: {
      item: { select: { id: true, itemName: true, unit: true, itemType: true, hsnCode: true } },
      procurementLinks: {
        include: {
          purchaseRequestLine: {
            include: {
              purchaseRequest: { select: { id: true, docNo: true, status: true } },
              sourceLinks: {
                include: {
                  materialRequirementLine: {
                    include: {
                      materialRequirement: {
                        include: {
                          quotation: { select: { id: true, quotationNo: true } },
                          salesOrder: { select: { id: true, docNo: true } },
                          workOrder: { select: { id: true, docNo: true } },
                          monthlyProductionPlan: {
                            select: {
                              id: true,
                              docNo: true,
                              periodKey: true,
                              currentRevision: true,
                              status: true,
                              planSequenceNo: true,
                              planKind: true,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          materialRequirementLine: {
            include: {
              materialRequirement: {
                include: {
                  quotation: { select: { id: true, quotationNo: true } },
                  salesOrder: { select: { id: true, docNo: true } },
                  workOrder: { select: { id: true, docNo: true } },
                  monthlyProductionPlan: {
                    select: {
                      id: true,
                      docNo: true,
                      periodKey: true,
                      currentRevision: true,
                      status: true,
                      planSequenceNo: true,
                      planKind: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { id: "asc" },
  },
  grns: {
    include: {
      lines: {
        include: {
          location: { select: { id: true, locationName: true, locationCode: true } },
        },
      },
    },
    orderBy: { id: "asc" },
  },
};

const { buildPlanDisplayLabel } = require("./monthlyPlanningPlanLifecycleService");
const { buildMonthlyPlanReleaseLabel } = require("./monthlyPlanningRmSnapshotService");

function rmPoDisplayNo(id) {
  return `RMPO-${id}`;
}

function grnDisplayNo(id) {
  return `GRN-${id}`;
}

function mapMonthlyPlanContext(mr) {
  if (!mr?.monthlyProductionPlan) return null;
  const plan = mr.monthlyProductionPlan;
  const revision = mr.sourceRevision != null ? Number(mr.sourceRevision) : null;
  const usePlanDocumentLabel =
    plan.status === "APPROVED" ||
    (plan.planSequenceNo != null && Number(plan.currentRevision ?? 0) === 0);
  const label = usePlanDocumentLabel
    ? buildMonthlyPlanReleaseLabel(plan, revision ?? 1)
    : revision != null && Number.isFinite(revision)
      ? `Monthly Plan Rev ${revision}`
      : plan.docNo || plan.periodKey || `Plan #${plan.id}`;
  return {
    planId: plan.id,
    docNo: plan.docNo,
    periodKey: plan.periodKey,
    currentRevision: plan.currentRevision,
    sourceRevision: Number.isFinite(revision) ? revision : null,
    label,
  };
}

function mapMrContext(mrLine, allocatedQty) {
  if (!mrLine) return null;
  const mr = mrLine.materialRequirement;
  if (!mr) return null;
  return {
    materialRequirementId: mr.id,
    docNo: mr.docNo,
    materialRequirementLineId: mrLine.id,
    sourceType: mr.sourceType,
    allocatedQty: qtyToNumber(allocatedQty),
    monthlyPlan: mapMonthlyPlanContext(mr),
    workOrder: mr.workOrder ? { id: mr.workOrder.id, docNo: mr.workOrder.docNo } : null,
    salesOrder: mr.salesOrder ? { id: mr.salesOrder.id, docNo: mr.salesOrder.docNo } : null,
    quotation: mr.quotation ? { id: mr.quotation.id, quotationNo: mr.quotation.quotationNo } : null,
  };
}

function mapPrContext(prLine, allocatedQty) {
  if (!prLine) return null;
  const pr = prLine.purchaseRequest;
  return {
    purchaseRequestId: pr?.id ?? null,
    docNo: pr?.docNo ?? null,
    status: pr?.status ?? null,
    purchaseRequestLineId: prLine.id,
    allocatedQty: qtyToNumber(allocatedQty),
  };
}

/**
 * Build demand-source rows from procurement links on one PO line.
 * @param {{ procurementLinks?: unknown[] }} poLine
 */
function buildDemandSourcesForPoLine(poLine) {
  const demandSources = [];
  const mrSources = [];
  const prSources = [];
  const seenMr = new Set();
  const seenPr = new Set();

  for (const link of poLine.procurementLinks || []) {
    const linkQty = qtyToNumber(link.allocatedQty);
    const prLine = link.purchaseRequestLine;

    if (prLine) {
      const prCtx = mapPrContext(prLine, linkQty);
      if (prCtx && !seenPr.has(prLine.id)) {
        seenPr.add(prLine.id);
        prSources.push(prCtx);
      }

      const sourceLinks = prLine.sourceLinks || [];
      if (sourceLinks.length) {
        for (const sl of sourceLinks) {
          const mrCtx = mapMrContext(sl.materialRequirementLine, sl.allocatedQty);
          if (mrCtx && !seenMr.has(mrCtx.materialRequirementLineId)) {
            seenMr.add(mrCtx.materialRequirementLineId);
            mrSources.push(mrCtx);
          }
          demandSources.push({
            demandSourceType: mrCtx?.sourceType ?? null,
            monthlyPlanRevision: mrCtx?.monthlyPlan?.sourceRevision ?? null,
            monthlyPlan: mrCtx?.monthlyPlan ?? null,
            mr: mrCtx,
            pr: prCtx,
            workOrder: mrCtx?.workOrder ?? null,
            salesOrder: mrCtx?.salesOrder ?? null,
            quotation: mrCtx?.quotation ?? null,
          });
        }
      } else {
        demandSources.push({
          demandSourceType: null,
          monthlyPlanRevision: null,
          monthlyPlan: null,
          mr: null,
          pr: prCtx,
          workOrder: null,
          salesOrder: null,
          quotation: null,
        });
      }
      continue;
    }

    const mrCtx = mapMrContext(link.materialRequirementLine, linkQty);
    if (mrCtx && !seenMr.has(mrCtx.materialRequirementLineId)) {
      seenMr.add(mrCtx.materialRequirementLineId);
      mrSources.push(mrCtx);
    }
    demandSources.push({
      demandSourceType: mrCtx?.sourceType ?? null,
      monthlyPlanRevision: mrCtx?.monthlyPlan?.sourceRevision ?? null,
      monthlyPlan: mrCtx?.monthlyPlan ?? null,
      mr: mrCtx,
      pr: null,
      workOrder: mrCtx?.workOrder ?? null,
      salesOrder: mrCtx?.salesOrder ?? null,
      quotation: mrCtx?.quotation ?? null,
    });
  }

  return { demandSources, mrSources, prSources };
}

function mapStockTransaction(row) {
  return {
    id: row.id,
    itemId: row.itemId,
    locationId: row.locationId,
    transactionType: row.transactionType,
    refId: row.refId,
    stockBucket: row.stockBucket,
    qtyIn: qtyToNumber(row.qtyIn),
    qtyOut: qtyToNumber(row.qtyOut),
    date: row.date,
    reversedAt: row.reversedAt,
  };
}

function mapPurchaseBillLine(row) {
  const bill = row.purchaseBill;
  return {
    id: row.id,
    purchaseBillId: row.purchaseBillId,
    grnId: row.grnId,
    grnLineId: row.grnLineId,
    rmPoId: row.rmPoId,
    rmPoLineId: row.rmPoLineId,
    itemId: row.itemId,
    qty: qtyToNumber(row.qty),
    rate: qtyToNumber(row.rate),
    lineTotal: qtyToNumber(row.lineTotal),
    purchaseBill: bill
      ? {
          id: bill.id,
          billNo: bill.billNo,
          status: bill.status,
          billDate: bill.billDate,
        }
      : null,
  };
}

function mapGrnLine(gl, grn, stockByGrnLineId, billsByGrnLineId) {
  const stockTransactions = stockByGrnLineId.get(gl.id) || [];
  const purchaseBillLines = billsByGrnLineId.get(gl.id) || [];
  return {
    id: gl.id,
    grnId: gl.grnId,
    grnNo: grnDisplayNo(gl.grnId),
    supplierInvoiceNo: grn.supplierInvoiceNo,
    grnDate: grn.date,
    reversedAt: grn.reversedAt,
    isReversed: Boolean(grn.reversedAt),
    rmPoLineId: gl.rmPoLineId,
    receivedQty: qtyToNumber(gl.receivedQty),
    rateSnapshot: qtyToNumber(gl.rateSnapshot),
    location: gl.location
      ? { id: gl.location.id, name: gl.location.locationName, code: gl.location.locationCode }
      : null,
    stockTransactions,
    purchaseBillLines,
  };
}

function buildTraceChainLabels(demandSources, rmPoId, grnLines, stockTransactions, purchaseBillLines) {
  const labels = [];
  const primary = demandSources[0];
  if (primary?.monthlyPlan?.label) labels.push(primary.monthlyPlan.label);
  else if (primary?.monthlyPlanRevision != null) labels.push(`Monthly Plan Rev ${primary.monthlyPlanRevision}`);
  if (primary?.salesOrder?.docNo && primary?.demandSourceType === "SALES_ORDER") {
    labels.push(primary.salesOrder.docNo);
  }
  if (primary?.mr?.docNo) labels.push(primary.mr.docNo);
  if (primary?.pr?.docNo) labels.push(primary.pr.docNo);
  labels.push(rmPoDisplayNo(rmPoId));
  for (const gl of grnLines) {
    labels.push(gl.grnNo);
    if (gl.stockTransactions.length) labels.push("StockTransaction IN");
    for (const bl of gl.purchaseBillLines) {
      const billNo = bl.purchaseBill?.billNo;
      labels.push(billNo ? `Purchase Bill ${billNo}` : `Purchase Bill #${bl.purchaseBillId}`);
    }
  }
  if (!grnLines.length && stockTransactions.length) labels.push("StockTransaction IN");
  if (!grnLines.length) {
    for (const bl of purchaseBillLines) {
      const billNo = bl.purchaseBill?.billNo;
      labels.push(billNo ? `Purchase Bill ${billNo}` : `Purchase Bill #${bl.purchaseBillId}`);
    }
  }
  return labels;
}

/**
 * Pure assembly from loaded PO row + related stock/bill rows (unit-testable).
 * @param {object} poRow
 * @param {object[]} stockTransactions
 * @param {object[]} purchaseBillLines
 */
function assembleRmPoProcurementTrace(poRow, stockTransactions = [], purchaseBillLines = []) {
  const receivedByLine = sumReceivedByRmPoLineFromGrns(poRow.grns);

  const stockByGrnLineId = new Map();
  for (const st of stockTransactions) {
    if (st.transactionType !== "GRN" || !st.refId) continue;
    const list = stockByGrnLineId.get(st.refId) || [];
    list.push(mapStockTransaction(st));
    stockByGrnLineId.set(st.refId, list);
  }

  const billsByGrnLineId = new Map();
  for (const bl of purchaseBillLines) {
    if (!bl.grnLineId) continue;
    const list = billsByGrnLineId.get(bl.grnLineId) || [];
    list.push(mapPurchaseBillLine(bl));
    billsByGrnLineId.set(bl.grnLineId, list);
  }

  const grnById = new Map((poRow.grns || []).map((g) => [g.id, g]));

  const lines = (poRow.lines || []).map((poLine) => {
    const orderedQty = qtyToNumber(poLine.qty);
    const receivedQty = receivedByLine.get(poLine.id) || 0;
    const pendingQty = Math.max(0, orderedQty - receivedQty);
    const { demandSources, mrSources, prSources } = buildDemandSourcesForPoLine(poLine);

    const grnLines = [];
    for (const grn of poRow.grns || []) {
      for (const gl of grn.lines || []) {
        if (gl.rmPoLineId !== poLine.id) continue;
        grnLines.push(mapGrnLine(gl, grn, stockByGrnLineId, billsByGrnLineId));
      }
    }

    const lineStockTransactions = grnLines.flatMap((gl) => gl.stockTransactions);
    const linePurchaseBillLines = grnLines.flatMap((gl) => gl.purchaseBillLines);

    // Include bill lines tied to PO line but without grnLineId (legacy / header-level).
    for (const bl of purchaseBillLines) {
      if (bl.rmPoLineId === poLine.id && !bl.grnLineId) {
        const mapped = mapPurchaseBillLine(bl);
        if (!linePurchaseBillLines.some((x) => x.id === mapped.id)) {
          linePurchaseBillLines.push(mapped);
        }
      }
    }

    return {
      id: poLine.id,
      item: poLine.item
        ? {
            id: poLine.item.id,
            itemName: poLine.item.itemName,
            unit: poLine.item.unit,
            itemType: poLine.item.itemType,
            hsn: poLine.item.hsnCode,
          }
        : null,
      orderedQty,
      receivedQty,
      pendingQty,
      rate: qtyToNumber(poLine.rate),
      demandSources,
      prSources,
      mrSources,
      grnLines,
      stockTransactions: lineStockTransactions,
      purchaseBillLines: linePurchaseBillLines,
      traceChain: buildTraceChainLabels(
        demandSources,
        poRow.id,
        grnLines,
        lineStockTransactions,
        linePurchaseBillLines,
      ),
    };
  });

  const supplier = poRow.supplier
    ? {
        id: poRow.supplier.id,
        name: poRow.supplier.name,
        gstin: poRow.supplier.gst,
        address: poRow.supplier.address,
        stateName: poRow.supplier.stateRef?.stateName ?? null,
        stateCode: poRow.supplier.stateRef?.stateCode ?? null,
      }
    : null;

  return {
    rmPo: {
      id: poRow.id,
      displayNo: rmPoDisplayNo(poRow.id),
      status: poRow.status,
      supplierId: poRow.supplierId,
      supplierLocationId: poRow.supplierLocationId,
      remarks: poRow.remarks,
      createdAt: poRow.createdAt,
      updatedAt: poRow.updatedAt,
    },
    supplier,
    supplierLocation: poRow.supplierLocation
      ? {
          id: poRow.supplierLocation.id,
          label: poRow.supplierLocation.label,
          address: poRow.supplierLocation.address,
          gstin: poRow.supplierLocation.gst,
          stateName: poRow.supplierLocation.stateRef?.stateName ?? null,
          stateCode: poRow.supplierLocation.stateRef?.stateCode ?? null,
        }
      : null,
    grns: (poRow.grns || []).map((g) => ({
      id: g.id,
      displayNo: grnDisplayNo(g.id),
      supplierInvoiceNo: g.supplierInvoiceNo,
      date: g.date,
      reversedAt: g.reversedAt,
      billingStatus: g.billingStatus,
      lineCount: (g.lines || []).length,
    })),
    lines,
  };
}

/**
 * Read-only RM PO procurement trace.
 * @param {import('@prisma/client').PrismaClient} [db]
 * @param {number} rmPoId
 */
async function buildRmPoProcurementTrace(db, rmPoId) {
  const client = db;
  const poRow = await client.rmPurchaseOrder.findUnique({
    where: { id: rmPoId },
    include: RM_PO_INCLUDE,
  });
  if (!poRow) return null;

  const grnLineIds = [];
  const poLineIds = (poRow.lines || []).map((l) => l.id);
  for (const grn of poRow.grns || []) {
    for (const gl of grn.lines || []) {
      grnLineIds.push(gl.id);
    }
  }

  const stockTransactions =
    grnLineIds.length > 0
      ? await client.stockTransaction.findMany({
          where: { transactionType: "GRN", refId: { in: grnLineIds } },
          orderBy: [{ date: "asc" }, { id: "asc" }],
        })
      : [];

  const purchaseBillLines = await client.purchaseBillLine.findMany({
    where: {
      OR: [
        ...(grnLineIds.length ? [{ grnLineId: { in: grnLineIds } }] : []),
        { rmPoId: rmPoId },
        ...(poLineIds.length ? [{ rmPoLineId: { in: poLineIds } }] : []),
      ],
    },
    include: {
      purchaseBill: {
        select: { id: true, billNo: true, status: true, billDate: true },
      },
    },
    orderBy: { id: "asc" },
  });

  return assembleRmPoProcurementTrace(poRow, stockTransactions, purchaseBillLines);
}

module.exports = {
  RM_PO_INCLUDE,
  assembleRmPoProcurementTrace,
  buildDemandSourcesForPoLine,
  buildRmPoProcurementTrace,
  mapMonthlyPlanContext,
  grnDisplayNo,
  rmPoDisplayNo,
};
