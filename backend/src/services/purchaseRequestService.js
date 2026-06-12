/**
 * Store → Purchase handoff: consolidated purchase requests (not RM POs).
 */

const { prisma } = require("../utils/prisma");
const { DocType } = require("../prismaClientPackage");
const { allocateDocNo } = require("./docNoService");
const { QUEUE_EPS, qtyToNumber, assertAllItemsAreRm } = require("./rmPurchaseHelpers");
const {
  isTestingModeRelaxed,
  resolveLineTaxFromItem,
  computeLineAmount,
  assertPositiveRate,
} = require("./rmPoTaxFields");
const { freezeRmPurchaseOrderCommercialSnapshots, enrichRmPurchaseOrderCommercial } = require("./purchaseCommercialAddress");
const auditLog = require("./auditLog");
const {
  assertRmRequisitionCanCreatePurchaseRequest,
  assertRmRequisitionPurchaseVisible,
} = require("./rmRequisitionLifecycle");
const { assertSingleDemandPoolFromSourceTypes } = require("./procurementDemandPoolService");

const OPEN_PURCHASE_REQUEST_STATUSES = ["PENDING_PURCHASE", "PARTIALLY_ORDERED"];

function linePendingPoQty(line) {
  const net = qtyToNumber(line.netRequiredQty);
  const ordered = qtyToNumber(line.orderedQty);
  return Math.max(0, net - ordered);
}

/** Line-level gate aligned with createRmPoFromPurchaseRequestLines (header status + pending qty). */
function canOrderPurchaseRequestLine(pr, line) {
  if (!pr || !OPEN_PURCHASE_REQUEST_STATUSES.includes(pr.status)) return false;
  return linePendingPoQty(line) > QUEUE_EPS;
}

function purchaseRequestOrderingBlockReason(pr) {
  if (!pr) return { message: "Purchase request not found.", code: "PR_NOT_FOUND" };
  const doc = pr.docNo || `PR #${pr.id}`;
  if (pr.status === "ORDERED") {
    return {
      message: `PO already created for purchase request ${doc}. Refresh pending requests or open the existing RM PO for GRN.`,
      code: "PR_ALREADY_ORDERED",
    };
  }
  if (pr.status === "CANCELLED") {
    return {
      message: `Purchase request ${doc} is cancelled and cannot be ordered.`,
      code: "PR_CANCELLED",
    };
  }
  if (!OPEN_PURCHASE_REQUEST_STATUSES.includes(pr.status)) {
    return {
      message: `Purchase request ${doc} is not open for ordering (${purchaseRequestStatusLabel(pr.status)}).`,
      code: "PR_NOT_OPEN_FOR_ORDERING",
    };
  }
  return null;
}

function uniqueWarnings(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function purchaseRequestStatusLabel(status) {
  switch (status) {
    case "PENDING_PURCHASE":
      return "Pending purchase";
    case "PARTIALLY_ORDERED":
      return "Partially ordered";
    case "ORDERED":
      return "Ordered";
    case "CANCELLED":
      return "Cancelled";
    default:
      return String(status || "");
  }
}

function sourceRefForPurchaseRequestSource(mr) {
  if (!mr) return "â€”";
  if (mr.sourceType === "STOCK_REPLENISHMENT") return "Stock Replenishment";
  return (
    mr.salesOrder?.docNo ??
    (mr.salesOrderId ? `SO-${mr.salesOrderId}` : null) ??
    mr.quotation?.quotationNo ??
    (mr.quotationId ? `QT-${mr.quotationId}` : null) ??
    mr.docNo ??
    "â€”"
  );
}

/** Qty still available to send on open purchase requests for an MR line. */
async function loadPendingRequestAllocByMrLineId(db = prisma) {
  const links = await db.purchaseRequestLineSourceLink.findMany({
    where: {
      purchaseRequestLine: {
        purchaseRequest: { status: { in: OPEN_PURCHASE_REQUEST_STATUSES } },
      },
    },
    select: { materialRequirementLineId: true, allocatedQty: true },
  });
  const byMr = new Map();
  for (const lk of links) {
    const q = qtyToNumber(lk.allocatedQty);
    byMr.set(lk.materialRequirementLineId, (byMr.get(lk.materialRequirementLineId) || 0) + q);
  }
  return byMr;
}

function remainingAfterPurchaseRequests(line, pendingByMrLine) {
  const shortage = qtyToNumber(line.shortageQty);
  const procured = qtyToNumber(line.procuredQty);
  const pendingPr = pendingByMrLine.get(line.id) || 0;
  return Math.max(0, shortage - procured - pendingPr);
}

async function recalcPurchaseRequestStatus(tx, purchaseRequestId) {
  const lines = await tx.purchaseRequestLine.findMany({
    where: { purchaseRequestId },
  });
  if (!lines.length) return;

  const pr = await tx.purchaseRequest.findUnique({ where: { id: purchaseRequestId } });
  if (!pr || pr.status === "CANCELLED") return;

  let anyOrdered = false;
  let allOrdered = true;
  for (const ln of lines) {
    const net = qtyToNumber(ln.netRequiredQty);
    const ordered = qtyToNumber(ln.orderedQty);
    if (ordered > QUEUE_EPS) anyOrdered = true;
    if (ordered + QUEUE_EPS < net) allOrdered = false;
  }

  let next = "PENDING_PURCHASE";
  if (allOrdered && anyOrdered) next = "ORDERED";
  else if (anyOrdered) next = "PARTIALLY_ORDERED";

  if (next !== pr.status) {
    await tx.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { status: next } });
  }
}

async function assertPurchaseRequestAllocationsValid(tx, lines) {
  const pendingByMr = await loadPendingRequestAllocByMrLineId(tx);
  const lineIds = [];
  for (const l of lines) {
    for (const a of l.allocations || []) lineIds.push(a.materialRequirementLineId);
  }
  const uniqIds = [...new Set(lineIds)];
  if (!uniqIds.length) {
    const err = new Error("Each line must include source allocations.");
    err.statusCode = 400;
    throw err;
  }

  const mrLines = await tx.materialRequirementLine.findMany({
    where: { id: { in: uniqIds } },
    include: { materialRequirement: { select: { id: true, status: true, docNo: true, sourceType: true } } },
  });
  const byId = new Map(mrLines.map((r) => [r.id, r]));
  const allocationSourceTypes = [];

  for (const prLine of lines) {
    const allocs = prLine.allocations || [];
    if (!allocs.length) {
      const err = new Error(`Line for item ${prLine.itemId} needs source allocations.`);
      err.statusCode = 400;
      throw err;
    }
    let allocSum = 0;
    for (const a of allocs) {
      const row = byId.get(a.materialRequirementLineId);
      if (!row) {
        const err = new Error(`Material requirement line ${a.materialRequirementLineId} not found`);
        err.statusCode = 400;
        throw err;
      }
      assertRmRequisitionCanCreatePurchaseRequest(row.materialRequirement);
      allocationSourceTypes.push(row.materialRequirement?.sourceType);
      if (row.rmItemId !== prLine.itemId) {
        const err = new Error("Allocation item must match request line item.");
        err.statusCode = 400;
        throw err;
      }
      const allocQty = qtyToNumber(a.qty);
      if (allocQty <= QUEUE_EPS) {
        const err = new Error("Allocation qty must be positive.");
        err.statusCode = 400;
        throw err;
      }
      const remaining = remainingAfterPurchaseRequests(row, pendingByMr);
      if (allocQty > remaining + QUEUE_EPS) {
        const err = new Error(
          `Allocation ${allocQty} exceeds remaining ${remaining} for ${row.materialRequirement?.docNo || "requirement"}.`,
        );
        err.statusCode = 400;
        throw err;
      }
      allocSum += allocQty;
    }
    if (Math.abs(allocSum - prLine.netRequiredQty) > QUEUE_EPS) {
      const err = new Error(
        `Net required qty ${prLine.netRequiredQty} must equal sum of allocations (${allocSum}).`,
      );
      err.statusCode = 400;
      throw err;
    }
  }

  assertSingleDemandPoolFromSourceTypes(allocationSourceTypes, "purchase request");
}

/**
 * Store sends consolidated requirement to Purchase (no supplier / rate).
 */
async function createPurchaseRequestFromPool(input, actor = {}) {
  return prisma.$transaction(async (tx) => {
    await assertPurchaseRequestAllocationsValid(tx, input.lines);
    await assertAllItemsAreRm(
      tx,
      input.lines.map((l) => l.itemId),
    );

    const docNo = await allocateDocNo(tx, { docType: DocType.PURCHASE_REQUEST, date: new Date() });
    const header = await tx.purchaseRequest.create({
      data: {
        docNo,
        status: "PENDING_PURCHASE",
        remarks: input.remarks?.trim() || null,
        createdByUserId: actor.userId ?? null,
        lines: {
          create: input.lines.map((l) => ({
            rmItemId: l.itemId,
            requiredQty: String(l.requiredQty),
            availableQtySnapshot: String(l.availableQty ?? 0),
            netRequiredQty: String(l.netRequiredQty),
            unitSnapshot: l.unit?.trim() || null,
            sourceLinks: {
              create: (l.allocations || []).map((a) => ({
                materialRequirementLineId: a.materialRequirementLineId,
                allocatedQty: String(a.qty),
              })),
            },
          })),
        },
      },
      include: {
        lines: {
          include: {
            rmItem: { select: { id: true, itemName: true, unit: true } },
            sourceLinks: {
              include: {
                materialRequirementLine: {
                  include: {
                    materialRequirement: {
                      include: {
                        quotation: { select: { quotationNo: true } },
                        salesOrder: { select: { docNo: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const sourceMrIds = new Set();
    for (const line of header.lines || []) {
      for (const source of line.sourceLinks || []) {
        const mrId = source.materialRequirementLine?.materialRequirement?.id;
        if (mrId) sourceMrIds.add(mrId);
      }
    }
    if (sourceMrIds.size) {
      await tx.materialRequirement.updateMany({
        where: { id: { in: [...sourceMrIds] }, status: "APPROVED" },
        data: { status: "SENT_TO_PURCHASE", sentToPurchaseAt: new Date() },
      });
    }

    const userId = actor.userId;
    if (typeof userId === "number" && Number.isFinite(userId)) {
      await auditLog.write(tx, {
        action: auditLog.AuditAction.CREATE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `PURCHASE_REQUEST:${header.id}`,
        actorUserId: userId,
        actorRole: actor.role,
        summary: `Purchase request ${header.docNo || header.id} sent to Purchase (${header.lines.length} lines)`,
        payload: {
          module: "PROCUREMENT_PLANNING",
          actionLabel: "SEND_PURCHASE_REQUEST",
          ref: { type: "PURCHASE_REQUEST", id: String(header.id), no: header.docNo },
          snapshot: { lineCount: header.lines.length },
          status: { from: null, to: header.status },
        },
      });
    }

    return {
      purchaseRequest: {
        ...header,
        statusLabel: purchaseRequestStatusLabel(header.status),
      },
    };
  });
}

function mapPendingRequestRow(pr) {
  return {
    id: pr.id,
    docNo: pr.docNo,
    status: pr.status,
    statusLabel: purchaseRequestStatusLabel(pr.status),
    remarks: pr.remarks,
    createdAt: pr.createdAt,
    lines: (pr.lines || []).map((ln) => {
      const net = qtyToNumber(ln.netRequiredQty);
      const ordered = qtyToNumber(ln.orderedQty);
      const pending = linePendingPoQty(ln);
      const canOrder = canOrderPurchaseRequestLine(pr, ln);
      return {
        id: ln.id,
        purchaseRequestId: ln.purchaseRequestId,
        rmItemId: ln.rmItemId,
        itemName: ln.rmItem?.itemName ?? "",
        unit: ln.unitSnapshot || ln.rmItem?.unit || "",
        requiredQty: qtyToNumber(ln.requiredQty),
        availableQty: qtyToNumber(ln.availableQtySnapshot),
        netRequiredQty: net,
        orderedQty: ordered,
        pendingQty: pending,
        canOrder,
        orderBlockReason: canOrder
          ? null
          : pending <= QUEUE_EPS
            ? "PO already created for this line"
            : purchaseRequestOrderingBlockReason(pr)?.message ?? "Not open for ordering",
        sources: (ln.sourceLinks || []).map((lk) => {
          const mr = lk.materialRequirementLine?.materialRequirement;
          const sourceRef =
            mr?.salesOrder?.docNo ??
            (mr?.salesOrderId ? `SO-${mr.salesOrderId}` : null) ??
            mr?.quotation?.quotationNo ??
            (mr?.quotationId ? `QT-${mr.quotationId}` : null) ??
            mr?.docNo ??
            "—";
          return {
            materialRequirementLineId: lk.materialRequirementLineId,
            requirementDocNo: mr?.docNo ?? null,
            sourceRef: sourceRefForPurchaseRequestSource(mr),
            allocatedQty: qtyToNumber(lk.allocatedQty),
          };
        }),
      };
    }),
  };
}

async function listPendingPurchaseRequests(db = prisma) {
  const rows = await db.purchaseRequest.findMany({
    where: { status: { in: OPEN_PURCHASE_REQUEST_STATUSES } },
    orderBy: { id: "desc" },
    include: {
      lines: {
        include: {
          rmItem: { select: { id: true, itemName: true, unit: true } },
          sourceLinks: {
            include: {
              materialRequirementLine: {
                include: {
                  materialRequirement: {
                    include: {
                      quotation: { select: { quotationNo: true } },
                      salesOrder: { select: { docNo: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  return rows.map(mapPendingRequestRow);
}

async function applyMrProcuredFromPoLine(tx, purchaseRequestLineId, poQty) {
  const prLine = await tx.purchaseRequestLine.findUnique({
    where: { id: purchaseRequestLineId },
    include: { sourceLinks: true, purchaseRequest: { select: { id: true } } },
  });
  if (!prLine) return;

  const sources = prLine.sourceLinks || [];
  const totalSource = sources.reduce((s, lk) => s + qtyToNumber(lk.allocatedQty), 0);
  if (totalSource <= QUEUE_EPS) return;

  const ratio = poQty / totalSource;
  for (const lk of sources) {
    const srcQty = qtyToNumber(lk.allocatedQty);
    const delta = srcQty * ratio;
    if (delta <= QUEUE_EPS) continue;
    await tx.materialRequirementLine.update({
      where: { id: lk.materialRequirementLineId },
      data: { procuredQty: { increment: delta } },
    });
  }
}

/**
 * Purchase dept creates RM PO from pending purchase request lines.
 */
async function createRmPoFromPurchaseRequestLines(input, actor = {}) {
  const relaxed = isTestingModeRelaxed();
  return prisma.$transaction(async (tx) => {
    const lineIds = input.lines.map((l) => l.purchaseRequestLineId);
    const prLines = await tx.purchaseRequestLine.findMany({
      where: { id: { in: lineIds } },
      include: {
        rmItem: { include: { unitRef: { select: { unitName: true } } } },
        purchaseRequest: { select: { id: true, status: true, docNo: true } },
        sourceLinks: {
          include: {
            materialRequirementLine: {
              include: { materialRequirement: { select: { id: true, docNo: true, status: true, sourceType: true } } },
            },
          },
        },
      },
    });
    if (prLines.length !== lineIds.length) {
      const err = new Error("One or more purchase request lines not found");
      err.statusCode = 400;
      throw err;
    }

    const warn = [];
    const poSourceTypes = [];

    const commercial = await freezeRmPurchaseOrderCommercialSnapshots(tx, {
      supplierId: input.supplierId,
      supplierLocationId: input.supplierLocationId ?? null,
    });

    const inputByPrLineId = new Map(input.lines.map((l) => [l.purchaseRequestLineId, l]));
    const lineCreates = [];
    const poLineMeta = [];

    for (const prLine of prLines) {
      for (const source of prLine.sourceLinks || []) {
        assertRmRequisitionPurchaseVisible(source.materialRequirementLine?.materialRequirement);
        poSourceTypes.push(source.materialRequirementLine?.materialRequirement?.sourceType);
      }
      const prHeader = prLine.purchaseRequest;
      const block = purchaseRequestOrderingBlockReason(prHeader);
      if (block) {
        const err = new Error(block.message);
        err.statusCode = 400;
        err.code = block.code;
        throw err;
      }
      const spec = inputByPrLineId.get(prLine.id);
      const qty = qtyToNumber(spec.qty);
      const pending = linePendingPoQty(prLine);
      if (qty <= QUEUE_EPS || qty > pending + QUEUE_EPS) {
        const itemLabel = prLine.rmItem?.itemName || prLine.rmItemId;
        const err = new Error(
          pending <= QUEUE_EPS
            ? `PO already created for ${itemLabel} on ${prHeader?.docNo || "this PR"}. Refresh pending requests.`
            : `Invalid PO qty for ${itemLabel} (pending ${pending}).`,
        );
        err.statusCode = 400;
        err.code = pending <= QUEUE_EPS ? "PR_LINE_ALREADY_ORDERED" : "PR_LINE_QTY_INVALID";
        throw err;
      }
      assertPositiveRate(spec.rate);
      const resolved = resolveLineTaxFromItem(prLine.rmItem, { relaxed });
      warn.push(...resolved.warnings);
      const amount = computeLineAmount(qty, spec.rate);
      lineCreates.push({
        itemId: prLine.rmItemId,
        qty: String(qty),
        rate: String(spec.rate),
        unit: resolved.unit,
        hsn: resolved.hsn,
        gstRate: String(resolved.gstRate),
        amount: String(amount),
      });
      poLineMeta.push({ purchaseRequestLineId: prLine.id, qty, purchaseRequestId: prLine.purchaseRequestId });
    }

    assertSingleDemandPoolFromSourceTypes(poSourceTypes, "RM purchase order");

    const created = await tx.rmPurchaseOrder.create({
      data: {
        supplierId: input.supplierId,
        supplierLocationId: commercial.supplierLocationId,
        status: "PENDING",
        remarks: input.remarks?.trim() || null,
        supplierStateSnapshot: commercial.supplierStateSnapshot,
        supplierStateCodeSnapshot: commercial.supplierStateCodeSnapshot,
        supplierNameSnapshot: commercial.supplierNameSnapshot,
        supplierRegisteredGstinSnapshot: commercial.supplierRegisteredGstinSnapshot,
        supplierRegisteredAddressSnapshot: commercial.supplierRegisteredAddressSnapshot,
        supplierRegisteredStateNameSnapshot: commercial.supplierRegisteredStateNameSnapshot,
        supplierRegisteredStateCodeSnapshot: commercial.supplierRegisteredStateCodeSnapshot,
        supplyLocationLabelSnapshot: commercial.supplyLocationLabelSnapshot,
        supplyLocationAddressSnapshot: commercial.supplyLocationAddressSnapshot,
        supplyLocationGstinSnapshot: commercial.supplyLocationGstinSnapshot,
        supplyLocationStateNameSnapshot: commercial.supplyLocationStateNameSnapshot,
        supplyLocationStateCodeSnapshot: commercial.supplyLocationStateCodeSnapshot,
        purchaseSourceStateNameSnapshot: commercial.purchaseSourceStateNameSnapshot,
        purchaseSourceStateCodeSnapshot: commercial.purchaseSourceStateCodeSnapshot,
        purchaseSourceSnapshot: commercial.purchaseSourceSnapshot,
        purchaseGstModeSnapshot: commercial.purchaseGstModeSnapshot,
        lines: { create: lineCreates },
      },
      include: { supplier: true, supplierLocation: true, lines: { include: { item: true } } },
    });

    const touchedPrIds = new Set();
    for (let i = 0; i < created.lines.length; i++) {
      const poLine = created.lines[i];
      const meta = poLineMeta[i];
      await tx.rmPoLineProcurementLink.create({
        data: {
          rmPoLineId: poLine.id,
          purchaseRequestLineId: meta.purchaseRequestLineId,
          allocatedQty: String(meta.qty),
        },
      });
      await tx.purchaseRequestLine.update({
        where: { id: meta.purchaseRequestLineId },
        data: { orderedQty: { increment: meta.qty } },
      });
      await applyMrProcuredFromPoLine(tx, meta.purchaseRequestLineId, meta.qty);
      touchedPrIds.add(meta.purchaseRequestId);
    }

    for (const prId of touchedPrIds) {
      await recalcPurchaseRequestStatus(tx, prId);
    }

    const poSourceMrIds = new Set();
    for (const prLine of prLines) {
      for (const source of prLine.sourceLinks || []) {
        const mrId = source.materialRequirementLine?.materialRequirement?.id;
        if (mrId) poSourceMrIds.add(mrId);
      }
    }
    if (poSourceMrIds.size) {
      await tx.materialRequirement.updateMany({
        where: { id: { in: [...poSourceMrIds] }, status: { in: ["APPROVED", "SENT_TO_PURCHASE"] } },
        data: { status: "PROCUREMENT_IN_PROGRESS" },
      });
    }

    const userId = actor.userId;
    if (typeof userId === "number" && Number.isFinite(userId)) {
      await auditLog.write(tx, {
        action: auditLog.AuditAction.CREATE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `RM_PO:${created.id}`,
        actorUserId: userId,
        actorRole: actor.role,
        summary: `RM PO RMPO-${created.id} from purchase request (${created.lines.length} lines)`,
        payload: {
          module: "PURCHASE",
          actionLabel: "CREATE_PO_FROM_REQUEST",
          ref: { type: "RM_PO", id: String(created.id), no: `RMPO-${created.id}` },
          snapshot: { supplierId: created.supplierId, lineCount: created.lines.length },
          status: { from: null, to: created.status },
        },
      });
    }

    const refreshed = await tx.rmPurchaseOrder.findUnique({
      where: { id: created.id },
      include: {
        supplier: { include: { stateRef: { select: { stateName: true, stateCode: true } } } },
        supplierLocation: { include: { stateRef: { select: { stateName: true, stateCode: true } } } },
        lines: {
          include: {
            item: true,
            procurementLinks: {
              include: {
                purchaseRequestLine: {
                  include: {
                    purchaseRequest: { select: { docNo: true } },
                    sourceLinks: {
                      include: {
                        materialRequirementLine: {
                          include: {
                            materialRequirement: {
                              include: {
                                quotation: { select: { quotationNo: true } },
                                salesOrder: { select: { docNo: true } },
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
          },
        },
      },
    });

    const enriched = await enrichRmPurchaseOrderCommercial(tx, refreshed);
    return { po: enriched, taxWarnings: uniqueWarnings(warn) };
  });
}

module.exports = {
  OPEN_PURCHASE_REQUEST_STATUSES,
  purchaseRequestStatusLabel,
  loadPendingRequestAllocByMrLineId,
  remainingAfterPurchaseRequests,
  createPurchaseRequestFromPool,
  listPendingPurchaseRequests,
  createRmPoFromPurchaseRequestLines,
  recalcPurchaseRequestStatus,
};
