/**
 * NO_QTY guided navigation summary for QC / Production handoff (dispatch vs continue vs RS).
 */
const express = require("express");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { NEXT_RS_WRITE_ROLES } = require("../constants/erpRoles");
const { loadNoQtyCycleQcAcceptedMap } = require("./dispatch");
const {
  loadNoQtyDispositionUsableForDispatchPoolMap,
  loadNoQtyPostCycleApprovalQtyByItem,
} = require("../services/noQtyPostCycleApprovalService");
const { netDispatchedByItemId, DISPATCH_ALLOC_MODE } = require("../services/salesOrderDispatchAllocation");
const { normalizePositiveCycleId } = require("../utils/cycleIds");
const { QC_ENTRY_ACTIVE_WHERE } = require("../services/qcEntryConstants");
const {
  sumActiveQcAcceptedQty,
  getWoLineRemainingProductionQty,
} = require("../services/reportMetrics");
const { getNoQtyLastShortageQtyForCycleItem } = require("./requirementSheets");

const noQtyNextActionRouter = express.Router();

const EPS = 1e-6;

function mergeNetDispatchedByNumericItemId(netMap) {
  const merged = new Map();
  for (const [k, v] of netMap.entries()) {
    const nk = Number(k);
    if (!Number.isFinite(nk)) continue;
    merged.set(nk, (merged.get(nk) ?? 0) + Number(v));
  }
  return merged;
}

/**
 * GET /api/no-qty/next-action?salesOrderId=&cycleId=&productionId=
 */
noQtyNextActionRouter.get(
  "/next-action",
  requireAuth,
  requireRole(NEXT_RS_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const salesOrderId = Number(req.query.salesOrderId ?? req.query.soId ?? 0);
      const cycleIdRaw = Number(req.query.cycleId ?? 0);
      const productionId = Number(req.query.productionId ?? 0);

      if (!Number.isFinite(salesOrderId) || salesOrderId <= 0) {
        return res.status(400).json({ error: { message: "salesOrderId is required." } });
      }
      if (!Number.isFinite(cycleIdRaw) || cycleIdRaw <= 0) {
        return res.status(400).json({ error: { message: "cycleId is required." } });
      }

      const so = await prisma.salesOrder.findUnique({
        where: { id: salesOrderId },
        select: { id: true, orderType: true, currentCycleId: true },
      });
      if (!so) {
        return res.status(404).json({ error: { message: "Sales order not found." } });
      }
      if (so.orderType !== "NO_QTY") {
        return res.status(400).json({ error: { message: "This endpoint applies only to NO_QTY sales orders." } });
      }

      const cycleId = normalizePositiveCycleId(cycleIdRaw);
      if (cycleId == null) {
        return res.status(400).json({ error: { message: "Invalid cycleId." } });
      }

      let prod =
        productionId > 0
          ? await prisma.productionEntry.findUnique({
              where: { id: productionId },
              include: {
                qcEntries: { where: QC_ENTRY_ACTIVE_WHERE },
                workOrderLine: {
                  include: {
                    workOrder: { include: { salesOrder: true } },
                    fgItem: { select: { id: true, itemName: true } },
                  },
                },
              },
            })
          : null;

      if (prod && prod.workOrderLine?.workOrder?.salesOrderId !== salesOrderId) {
        return res.status(400).json({ error: { message: "Production batch does not belong to this sales order." } });
      }

      if (prod) {
        const woCid = normalizePositiveCycleId(prod.workOrderLine?.workOrder?.cycleId);
        if (woCid != null && woCid !== cycleId) {
          return res.status(400).json({ error: { message: "Production batch is not in the requested cycle." } });
        }
        if (woCid == null && Number(so.currentCycleId ?? 0) !== cycleId) {
          return res.status(400).json({ error: { message: "Production batch cycle does not match requested cycle." } });
        }
      }

      if (!prod && productionId > 0) {
        return res.status(404).json({ error: { message: "Production entry not found." } });
      }

      if (!prod) {
        const fallback = await prisma.productionEntry.findFirst({
          where: {
            workflowStatus: "APPROVED",
            workOrderLine: { workOrder: { salesOrderId, cycleId } },
          },
          orderBy: { id: "desc" },
          include: {
            qcEntries: { where: QC_ENTRY_ACTIVE_WHERE },
            workOrderLine: {
              include: {
                workOrder: true,
                fgItem: { select: { id: true, itemName: true } },
              },
            },
          },
        });
        prod = fallback;
      }

      const wolIdForAgg = prod?.workOrderLineId ?? null;
      const workOrderId = prod?.workOrderLine?.workOrderId ?? null;
      const fgItemId = prod?.workOrderLine?.fgItemId ?? null;

      const acceptedQty = prod ? sumActiveQcAcceptedQty(prod.qcEntries) : 0;

      const cycleInputs = [{ id: salesOrderId, currentCycleId: cycleId }];
      const [qcMap, recheckMap, postByItem] = await Promise.all([
        loadNoQtyCycleQcAcceptedMap(prisma, cycleInputs),
        loadNoQtyDispositionUsableForDispatchPoolMap(prisma, cycleInputs),
        loadNoQtyPostCycleApprovalQtyByItem(prisma, salesOrderId, cycleId),
      ]);
      const itemKey = fgItemId != null ? `${salesOrderId}:${cycleId}:${fgItemId}` : null;
      const cycleQcAcceptedForItem = itemKey ? Number(qcMap.get(itemKey) ?? 0) : 0;
      const recheckForItem = itemKey ? Number(recheckMap.get(itemKey) ?? 0) : 0;
      const postForItem = fgItemId != null ? Number(postByItem.get(Number(fgItemId)) ?? 0) : 0;

      const dispRows = await prisma.dispatch.findMany({
        where: { soId: salesOrderId, reversalOfId: null },
        select: { itemId: true, dispatchedQty: true, cycleId: true, workflowStatus: true },
      });
      const cycleDisp = (dispRows || []).filter((d) => normalizePositiveCycleId(d.cycleId) === cycleId);
      const netByItem = mergeNetDispatchedByNumericItemId(
        netDispatchedByItemId(cycleDisp, DISPATCH_ALLOC_MODE.OPERATIONAL),
      );
      const dispatchedQty = fgItemId != null ? Number(netByItem.get(Number(fgItemId)) ?? 0) : 0;

      const qcPoolGross = cycleQcAcceptedForItem + recheckForItem + postForItem;
      const qcPoolRemaining = Math.max(0, qcPoolGross - dispatchedQty);

      // NO_QTY: same as dispatch screen — QC + in-cycle disposition→USABLE + post-cycle approvals − same-cycle dispatch.
      const dispatchableQty = Math.max(0, qcPoolRemaining);

      let productionBalanceQty = 0;
      if (wolIdForAgg != null) {
        const wol = await prisma.workOrderLine.findUnique({
          where: { id: wolIdForAgg },
          select: { qty: true },
        });
        const agg = await prisma.productionEntry.aggregate({
          where: { workflowStatus: "APPROVED", workOrderLineId: wolIdForAgg },
          _sum: { producedQty: true },
        });
        const approvedSum = Number(agg._sum.producedQty ?? 0);
        productionBalanceQty = getWoLineRemainingProductionQty(Number(wol?.qty ?? 0), approvedSum);
      }

      /** Cycle-output Last Shortage: locked RS gross for cycle − QC accepted for same cycle (not WO remainder, not stock). */
      const lastShortageQty =
        fgItemId != null ? await getNoQtyLastShortageQtyForCycleItem(salesOrderId, cycleId, fgItemId) : 0;

      let nextAction = "DONE";
      if (qcPoolRemaining > EPS) {
        nextAction = "DISPATCH";
      } else if (acceptedQty <= EPS && productionBalanceQty > EPS) {
        nextAction = "PRODUCTION";
      }

      return res.json({
        salesOrderId,
        cycleId,
        productionId: prod?.id ?? (productionId > 0 ? productionId : null),
        workOrderId,
        itemId: fgItemId,
        acceptedQty,
        cycleQcAcceptedForItem,
        cycleRecheckDispositionToUsableForItem: recheckForItem,
        postCycleApprovalForItem: postForItem,
        qcPoolGross,
        dispatchedQty,
        qcPoolRemaining,
        dispatchableQty,
        productionBalanceQty,
        lastShortageQty,
        nextAction,
      });
    } catch (e) {
      return next(e);
    }
  },
);

module.exports = { noQtyNextActionRouter };
