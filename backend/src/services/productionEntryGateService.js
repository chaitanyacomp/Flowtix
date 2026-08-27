/**
 * Batch 2A — Gate G1 orchestrator: Material Issue → Production Entry.
 *
 * This module is an orchestrator only. It does not own business rules.
 * It resolves context, calls existing lifecycle services in authoritative order,
 * and surfaces consistent errors.
 *
 * ## Authoritative gate sequence (do not reorder without owner-doc review)
 *
 * 1. **WO identity validation** — resolve context; WO/WOL exist; structural linkage
 * 1b. **Linked shift live-window / status** — resolve session/segment; reject if not live OPEN
 * 2. **WO operationally open** — HOLD/PAUSED/terminal blocks all manufacturing flows
 * 3. **SO operationally open** — parent sales order not COMPLETED/CLOSED
 * 4. **NO_QTY / Green execution validation** — cycle/RS/release + shop-floor execution status
 * 5. **PMR validation** — submitted PMR, store issue, release to production
 * 6. **RM readiness validation** — issued RM capacity vs requested production qty
 * 7. **WO quantity tolerance validation** — REGULAR line plan +5% cap
 *
 * Approve-time RM **consumption posting** remains in the production approve route (MFG-07).
 * Live-window rejection happens before RM/material calculations. No inventory mutation occurs in this module.
 */

const { GREEN_LEVEL_WO_SOURCE_TYPE } = require("./greenLevelWorkOrderService");
const { assertSalesOrderOperationallyOpenForProduction } = require("./salesOrderDispatchHelpers");
const {
  assertWorkOrderOperationallyOpenForProduction,
  assertShopFloorExecutionAllowsProduction,
  isShopFloorExecutionWorkOrder,
} = require("./workOrderOperationalStatus");
const { assertNoQtyWorkOrderProductionCycleContext } = require("./noQtyExecutionBoundaryService");
const {
  buildProductionRmReadiness,
  assertProductionPmrGate,
  assertProductionRmReadiness,
} = require("./productionRmReadinessService");
const { assertProductionEntryWoQtyTolerance } = require("./workOrderLifecycleService");
const { assertRegularSoAdditionalProductionAllowed } = require("./regularSoProductionClosure");
const { assertNormalLiveProductionEntryAllowed } = require("./productionEntryLiveWindowService");

/**
 * @typedef {object} ProductionEntryGateContext
 * @property {object} wol
 * @property {object} wo
 * @property {object | null} so
 * @property {string | null} orderType
 */

/**
 * Step 1 — load and validate WO / WO-line identity.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {number} workOrderLineId
 * @returns {Promise<ProductionEntryGateContext>}
 */
async function resolveProductionEntryGateContext(tx, workOrderLineId) {
  const wol = await tx.workOrderLine.findUnique({
    where: { id: workOrderLineId },
    include: {
      fgItem: { select: { id: true, itemName: true } },
      workOrder: {
        include: {
          salesOrder: { select: { id: true, orderType: true, internalStatus: true, customerReturnId: true } },
        },
      },
    },
  });
  if (!wol) {
    const err = new Error("Work order line not found");
    err.statusCode = 404;
    err.code = "WOL_NOT_FOUND";
    throw err;
  }

  const wo = wol.workOrder;
  if (!wo) {
    const err = new Error("Production requires a valid work order.");
    err.statusCode = 400;
    err.code = "WO_NOT_FOUND";
    throw err;
  }

  if (Number(wol.workOrderId) !== Number(wo.id)) {
    const err = new Error("Work order line does not belong to the linked work order.");
    err.statusCode = 409;
    err.code = "WOL_WO_MISMATCH";
    throw err;
  }

  const so = wo.salesOrder ?? null;
  const orderType = so?.orderType ?? null;

  if (so?.orderType === "REPLACEMENT" || so?.customerReturnId != null) {
    const err = new Error(
      "Work orders and production batches are not allowed on customer-return replacement sales orders. Fulfillment uses customer-return QC and replacement dispatch only.",
    );
    err.statusCode = 409;
    err.code = "NO_PRODUCTION_ON_CUSTOMER_RETURN_REPLACEMENT_SO";
    throw err;
  }

  if (wo.requirementSheetId != null) {
    const rs = await tx.requirementSheet.findUnique({
      where: { id: wo.requirementSheetId },
      select: { id: true, salesOrderId: true, cycleId: true, status: true },
    });
    if (!rs) {
      const err = new Error("Linked requirement sheet was not found for this work order.");
      err.statusCode = 409;
      err.code = "WO_RS_NOT_FOUND";
      throw err;
    }
    if (wo.salesOrderId != null && Number(rs.salesOrderId) !== Number(wo.salesOrderId)) {
      const err = new Error("Work order requirement sheet does not belong to the linked sales order.");
      err.statusCode = 409;
      err.code = "WO_RS_SO_MISMATCH";
      throw err;
    }
    if (wo.cycleId != null && rs.cycleId != null && Number(rs.cycleId) !== Number(wo.cycleId)) {
      const err = new Error("Work order cycle does not match the linked requirement sheet cycle.");
      err.statusCode = 409;
      err.code = "WO_RS_CYCLE_MISMATCH";
      throw err;
    }
  }

  if (orderType === "NO_QTY" && wo.sourceType !== GREEN_LEVEL_WO_SOURCE_TYPE && wo.salesOrderId != null) {
    if (wo.cycleId == null) {
      const err = new Error(
        "This work order is not linked to a requirement-sheet cycle. Production cannot be recorded.",
      );
      err.statusCode = 409;
      err.code = "NO_QTY_WO_CYCLE_REQUIRED";
      throw err;
    }
  }

  return { wol, wo, so, orderType };
}

/**
 * Authoritative production-entry gate (create / update / approve pre-consumption).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{
 *   workOrderLineId: number;
 *   producedQty: number | string;
 *   excludeProductionId?: number;
 *   runAllocationId?: number | null;
 *   claimedMachineId?: number | null;
 *   woQtyToleranceMessageBuilder?: (args: { lineQty: number; allowedMaxQty: number; totalProducedQty: number; alreadyProduced?: number }) => string;
 * }} input
 */
async function assertProductionEntryAllowed(tx, input) {
  const workOrderLineId = Number(input.workOrderLineId);
  const producedQty = input.producedQty;

  // 1. WO identity validation
  const ctx = await resolveProductionEntryGateContext(tx, workOrderLineId);

  // 1b. Linked shift session/segment, then live-window/status — before RM/material.
  const liveGate = await assertNormalLiveProductionEntryAllowed(tx, {
    workOrderId: ctx.wo.id,
    workOrderLineId: ctx.wol.id,
    fgItemId: ctx.wol.fgItemId,
    runAllocationId: input.runAllocationId ?? null,
    claimedMachineId: input.claimedMachineId ?? null,
    now: input.now,
  });
  const resolvedRunAllocationId = liveGate.runAllocationId ?? input.runAllocationId ?? null;

  // 2. WO operationally open
  await assertWorkOrderOperationallyOpenForProduction(tx, ctx.wo.id, {
    wo: ctx.wo,
    so: ctx.so,
  });

  // 3. SO operationally open
  if (ctx.wo.salesOrderId != null) {
    await assertSalesOrderOperationallyOpenForProduction(tx, {
      salesOrderId: ctx.wo.salesOrderId,
      so: ctx.so,
    });
  }

  // 3b. REGULAR_SO: no additional production after finalized produced qty covers SO demand.
  await assertRegularSoAdditionalProductionAllowed(tx, workOrderLineId);

  // 4. NO_QTY / Green execution validation
  if (ctx.orderType === "NO_QTY" && ctx.wo.sourceType !== GREEN_LEVEL_WO_SOURCE_TYPE) {
    await assertNoQtyWorkOrderProductionCycleContext(tx, ctx.wo.id, "Production");
  }
  if (isShopFloorExecutionWorkOrder(ctx.wo, ctx.so)) {
    await assertShopFloorExecutionAllowsProduction(tx, ctx.wo.id);
  }

  const readiness = await buildProductionRmReadiness(tx, workOrderLineId);

  // 5. PMR validation
  assertProductionPmrGate(readiness);

  // 6. RM readiness validation
  const readinessResult = await assertProductionRmReadiness(tx, {
    workOrderLineId,
    producedQty,
    excludeProductionId: input.excludeProductionId,
    readiness,
    skipPmrGate: true,
  });

  // 6b. Per-run machine start confirmation (legacy WOs with no allocations skip)
  const { assertProductionRunStartConfirmed } = require("./productionRunStartConfirmationService");
  const startGate = await assertProductionRunStartConfirmed(tx, {
    workOrderId: ctx.wo.id,
    fgItemId: ctx.wol.fgItemId,
    runAllocationId: resolvedRunAllocationId,
    claimedMachineId: input.claimedMachineId ?? null,
  });

  // 7. WO quantity tolerance validation
  const defaultMessageBuilder = ({ lineQty, allowedMaxQty, totalProducedQty, alreadyProduced = 0 }) => {
    const fmt = (n) => (Number.isInteger(n) ? String(n) : Number(n).toFixed(3));
    const remaining = Math.max(0, allowedMaxQty - alreadyProduced);
    return `Total produced quantity cannot exceed the allowed tolerance for this WO line (WO Qty + 5%). WO Qty: ${fmt(lineQty)}. Already recorded (draft + approved): ${fmt(alreadyProduced)}. Maximum additional quantity now: ${fmt(remaining)}. Requested total would be ${fmt(totalProducedQty)}.`;
  };

  await assertProductionEntryWoQtyTolerance(tx, {
    workOrderLineId,
    producedQty,
    excludeProductionId: input.excludeProductionId,
    lineQty: ctx.wol.qty,
    workOrder: ctx.wo,
    orderType: ctx.orderType,
    messageBuilder: input.woQtyToleranceMessageBuilder ?? defaultMessageBuilder,
  });

  return {
    ...ctx,
    readiness: readinessResult,
    productionRunStartGate: startGate,
    resolvedRunAllocationId,
    liveProductionGate: liveGate,
  };
}

module.exports = {
  resolveProductionEntryGateContext,
  assertProductionEntryAllowed,
};
