const { prisma } = require("../utils/prisma");
const auditLog = require("./auditLog");
const {
  QUEUE_EPS,
  qtyToNumber,
  sumReceivedByRmPoLineFromGrns,
  recalcRmPoStatus,
} = require("./rmPurchaseHelpers");
const { round3, poLineOutstanding, derivePoProcurementClosureKind } = require("./procurementQtyMath");
const { recalculateMaterialRequirementClosureForRmPo } = require("./procurementLifecycleService");
const { recalcPurchaseRequestStatus } = require("./purchaseRequestService");

const PROCUREMENT_SHORT_CLOSE_REASONS = Object.freeze([
  "SUPPLIER_UNAVAILABLE",
  "PRICE_NOT_ACCEPTABLE",
  "QUALITY_ISSUE",
  "PRODUCTION_PLAN_CHANGED",
  "MANAGEMENT_DECISION",
  "OTHER",
]);

const PO_SHORT_CLOSE_INCLUDE = {
  lines: {
    include: {
      item: { select: { id: true, itemName: true, unit: true } },
      procurementLinks: {
        include: {
          purchaseRequestLine: {
            include: {
              purchaseRequest: { select: { id: true, docNo: true } },
              sourceLinks: true,
            },
          },
          materialRequirementLine: {
            select: { id: true, materialRequirementId: true },
          },
        },
      },
    },
    orderBy: { id: "asc" },
  },
  grns: { include: { lines: true } },
};

function normalizeReason(reason) {
  return String(reason ?? "").trim().toUpperCase();
}

async function loadRmPoForShortClose(tx, rmPoId) {
  const rmPo = await tx.rmPurchaseOrder.findUnique({
    where: { id: rmPoId },
    include: PO_SHORT_CLOSE_INCLUDE,
  });
  if (!rmPo) {
    const err = new Error("RM PO not found");
    err.statusCode = 404;
    throw err;
  }
  if (rmPo.status === "CANCELLED") {
    const err = new Error("Cannot short close a cancelled purchase order.");
    err.statusCode = 400;
    throw err;
  }
  return rmPo;
}

function buildLineShortCloseContext(poLine, receivedByLine) {
  const ordered = qtyToNumber(poLine.qty);
  const received = receivedByLine.get(poLine.id) || 0;
  const shortClosed = qtyToNumber(poLine.shortClosedQty);
  const outstanding = poLineOutstanding(ordered, received, shortClosed);
  return { ordered, received, shortClosed, outstanding };
}

async function cascadeShortCloseFromPoLine(tx, poLine, deltaShortClose) {
  const links = poLine.procurementLinks || [];
  const totalAllocated = links.reduce((sum, link) => sum + qtyToNumber(link.allocatedQty), 0);
  if (totalAllocated <= QUEUE_EPS || deltaShortClose <= QUEUE_EPS) return { prIds: [], mrLineIds: [] };

  const prIds = new Set();
  const mrLineIds = new Set();

  for (const link of links) {
    const share = qtyToNumber(link.allocatedQty) / totalAllocated;
    const linkDelta = round3(deltaShortClose * share);
    if (linkDelta <= QUEUE_EPS) continue;

    if (link.purchaseRequestLine) {
      const prLine = link.purchaseRequestLine;
      const nextPrShort = round3(qtyToNumber(prLine.shortClosedQty) + linkDelta);
      await tx.purchaseRequestLine.update({
        where: { id: prLine.id },
        data: { shortClosedQty: String(nextPrShort) },
      });
      prIds.add(prLine.purchaseRequestId);

      const sources = prLine.sourceLinks || [];
      const totalSource = sources.reduce((sum, sl) => sum + qtyToNumber(sl.allocatedQty), 0);
      for (const source of sources) {
        if (totalSource <= QUEUE_EPS) continue;
        const mrShare = qtyToNumber(source.allocatedQty) / totalSource;
        const mrDelta = round3(linkDelta * mrShare);
        if (mrDelta <= QUEUE_EPS) continue;
        const mrLine = await tx.materialRequirementLine.findUnique({
          where: { id: source.materialRequirementLineId },
          select: { id: true, shortClosedQty: true },
        });
        if (!mrLine) continue;
        const nextMrShort = round3(qtyToNumber(mrLine.shortClosedQty) + mrDelta);
        await tx.materialRequirementLine.update({
          where: { id: mrLine.id },
          data: { shortClosedQty: String(nextMrShort) },
        });
        mrLineIds.add(mrLine.id);
      }
    } else if (link.materialRequirementLineId) {
      const mrLine = await tx.materialRequirementLine.findUnique({
        where: { id: link.materialRequirementLineId },
        select: { id: true, shortClosedQty: true },
      });
      if (!mrLine) continue;
      const nextMrShort = round3(qtyToNumber(mrLine.shortClosedQty) + linkDelta);
      await tx.materialRequirementLine.update({
        where: { id: mrLine.id },
        data: { shortClosedQty: String(nextMrShort) },
      });
      mrLineIds.add(mrLine.id);
    }
  }

  return { prIds: [...prIds], mrLineIds: [...mrLineIds] };
}

function buildShortClosePreview(rmPo, receivedByLine, lineFilter = null) {
  const filterSet = Array.isArray(lineFilter) && lineFilter.length ? new Set(lineFilter.map(Number)) : null;
  const lines = [];
  let canShortClose = false;
  let blockReason = null;

  for (const poLine of rmPo.lines || []) {
    if (filterSet && !filterSet.has(poLine.id)) continue;
    const ctx = buildLineShortCloseContext(poLine, receivedByLine);
    if (ctx.outstanding <= QUEUE_EPS) continue;

    const lineBlock =
      ctx.received <= QUEUE_EPS
        ? "Zero-receipt short close is not allowed. Cancel the PO or receive goods first."
        : null;
    if (lineBlock && !blockReason) blockReason = lineBlock;
    if (!lineBlock) canShortClose = true;

    lines.push({
      rmPoLineId: poLine.id,
      itemId: poLine.itemId,
      itemName: poLine.item?.itemName ?? "",
      unit: poLine.item?.unit ?? poLine.unit ?? "",
      requiredQty: ctx.ordered,
      receivedQty: ctx.received,
      shortClosedQty: ctx.shortClosed,
      outstandingQty: ctx.outstanding,
      outstandingAfterClose: 0,
      canShortCloseLine: !lineBlock,
      blockReason: lineBlock,
    });
  }

  return {
    rmPoId: rmPo.id,
    rmPoStatus: rmPo.status,
    canShortClose,
    blockReason,
    lines,
    impactSummary: {
      totalRequired: round3(lines.reduce((s, l) => s + l.requiredQty, 0)),
      totalReceived: round3(lines.reduce((s, l) => s + l.receivedQty, 0)),
      totalShortClosed: round3(lines.reduce((s, l) => s + l.shortClosedQty, 0)),
      totalOutstanding: round3(lines.reduce((s, l) => s + l.outstandingQty, 0)),
      totalOutstandingAfterClose: 0,
    },
    reasons: [...PROCUREMENT_SHORT_CLOSE_REASONS],
  };
}

async function getRmPoShortClosePreview(rmPoId, opts = {}, db = prisma) {
  const rmPo = await loadRmPoForShortClose(db, rmPoId);
  const receivedByLine = sumReceivedByRmPoLineFromGrns(rmPo.grns);
  return buildShortClosePreview(rmPo, receivedByLine, opts.lineIds);
}

async function shortCloseRmPurchaseOrder(rmPoId, input = {}, actor = {}, db = prisma) {
  const reason = normalizeReason(input.reason);
  if (!PROCUREMENT_SHORT_CLOSE_REASONS.includes(reason)) {
    const err = new Error("A valid short close reason is required.");
    err.statusCode = 400;
    throw err;
  }
  const remarks = input?.remarks?.trim() || null;
  const lineIds = Array.isArray(input.lineIds)
    ? input.lineIds.map(Number).filter((id) => Number.isFinite(id) && id > 0)
    : null;

  return db.$transaction(async (tx) => {
    const rmPo = await loadRmPoForShortClose(tx, rmPoId);
    const receivedByLine = sumReceivedByRmPoLineFromGrns(rmPo.grns);
    const preview = buildShortClosePreview(rmPo, receivedByLine, lineIds);
    if (!preview.canShortClose) {
      const err = new Error(preview.blockReason || "No remaining balance is eligible for short close.");
      err.statusCode = 400;
      throw err;
    }

    const closedLines = [];
    const prIds = new Set();
    for (const poLine of rmPo.lines || []) {
      if (lineIds?.length && !lineIds.includes(poLine.id)) continue;
      const ctx = buildLineShortCloseContext(poLine, receivedByLine);
      if (ctx.outstanding <= QUEUE_EPS) continue;
      if (ctx.received <= QUEUE_EPS) {
        const err = new Error(
          "Zero-receipt short close is not allowed. Cancel the PO or receive goods first.",
        );
        err.statusCode = 400;
        throw err;
      }

      const nextShortClosed = round3(ctx.shortClosed + ctx.outstanding);
      await tx.rmPurchaseOrderLine.update({
        where: { id: poLine.id },
        data: { shortClosedQty: String(nextShortClosed) },
      });
      await tx.procurementShortCloseEvent.create({
        data: {
          rmPoId: rmPo.id,
          rmPoLineId: poLine.id,
          shortClosedQty: String(ctx.outstanding),
          reason,
          remarks,
          actorUserId: actor.userId ?? null,
        },
      });

      const cascade = await cascadeShortCloseFromPoLine(tx, poLine, ctx.outstanding);
      for (const prId of cascade.prIds) prIds.add(prId);

      closedLines.push({
        rmPoLineId: poLine.id,
        itemName: poLine.item?.itemName ?? "",
        shortClosedQty: ctx.outstanding,
        requiredQty: ctx.ordered,
        receivedQty: ctx.received,
        shortClosedQtyAfter: nextShortClosed,
        outstandingAfterClose: 0,
      });
    }

    if (!closedLines.length) {
      const err = new Error("No remaining balance is eligible for short close.");
      err.statusCode = 400;
      throw err;
    }

    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `RMPO-${rmPo.id}`,
      actorUserId: actor.userId ?? null,
      actorRole: actor.role ?? null,
      summary: `Procurement short closed on ${rmPo.supplierPoNumber || `RMPO-${rmPo.id}`}`,
      reason,
      payload: {
        module: "PROCUREMENT_SHORT_CLOSE",
        actionLabel: "PO_SHORT_CLOSE",
        rmPoId: rmPo.id,
        remarks,
        lines: closedLines,
      },
    });

    await recalcRmPoStatus(tx, rmPo.id);
    for (const prId of prIds) {
      await recalcPurchaseRequestStatus(tx, prId);
    }
    await recalculateMaterialRequirementClosureForRmPo(tx, rmPo.id);

    const refreshed = await tx.rmPurchaseOrder.findUnique({
      where: { id: rmPo.id },
      include: PO_SHORT_CLOSE_INCLUDE,
    });
    const refreshedReceived = sumReceivedByRmPoLineFromGrns(refreshed.grns);
    const procurementClosureKind = derivePoProcurementClosureKind(
      refreshed.status,
      refreshed.lines,
      refreshedReceived,
    );

    return {
      rmPoId: rmPo.id,
      procurementClosureKind,
      lines: closedLines,
      preview: buildShortClosePreview(refreshed, refreshedReceived, lineIds),
    };
  });
}

function enrichRmPoProcurementSummary(po, receivedByLine) {
  const lines = (po.lines || []).map((line) => {
    const ctx = buildLineShortCloseContext(line, receivedByLine);
    return {
      rmPoLineId: line.id,
      requiredQty: ctx.ordered,
      receivedQty: ctx.received,
      shortClosedQty: ctx.shortClosed,
      outstandingProcurement: ctx.outstanding,
    };
  });
  const procurementClosureKind = derivePoProcurementClosureKind(po.status, po.lines, receivedByLine);
  return {
    procurementClosureKind,
    procurementStatusLabel:
      procurementClosureKind === "SHORT_CLOSED"
        ? "PARTIALLY PROCURED (SHORT CLOSED)"
        : procurementClosureKind === "FULL_RECEIPT"
          ? "Fully Received"
          : null,
    lines,
    totals: {
      requiredQty: round3(lines.reduce((s, l) => s + l.requiredQty, 0)),
      receivedQty: round3(lines.reduce((s, l) => s + l.receivedQty, 0)),
      shortClosedQty: round3(lines.reduce((s, l) => s + l.shortClosedQty, 0)),
      outstandingProcurement: round3(lines.reduce((s, l) => s + l.outstandingProcurement, 0)),
    },
  };
}

module.exports = {
  PROCUREMENT_SHORT_CLOSE_REASONS,
  getRmPoShortClosePreview,
  shortCloseRmPurchaseOrder,
  enrichRmPoProcurementSummary,
  buildShortClosePreview,
};
