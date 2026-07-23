/**
 * Regular SO (NORMAL) only: ensure persisted SALES_ORDER MaterialRequirement, then create PR.
 * Store creates PR; Purchase remains responsible for PR → PO.
 *
 * Does not rewrite an existing open MR (avoids breaking PR source-line links on repeat clicks).
 */

const { prisma } = require("../utils/prisma");
const { createMaterialRequirementFromWoPlanning } = require("./materialPlanningService");
const {
  createPurchaseRequestFromPool,
  loadTotalPurchaseRequestAllocByMrLineId,
  remainingAfterPurchaseRequests,
} = require("./purchaseRequestService");
const { QUEUE_EPS } = require("./rmPurchaseHelpers");
const {
  REGULAR_SO_PROCUREMENT_SOURCE,
  regularSoProcurementSourceTypes,
} = require("./regularSoProcurementSource");
const { assertActorMayCreatePurchaseRequest } = require("./procurementPurchaseRequestOwnership");

const EPS = QUEUE_EPS;

/** Statuses that still participate in Store → Purchase PR handoff. */
const OPEN_REGULAR_SO_MR_FOR_PR_STATUSES = Object.freeze([
  "APPROVED",
  "SENT_TO_PURCHASE",
  "PROCUREMENT_IN_PROGRESS",
  "PARTIALLY_PROCURED",
]);

function buildPurchaseRequestLinesFromMaterialRequirement(mr, allocByMrLine) {
  const byItem = new Map();
  for (const ln of mr.lines || []) {
    const remaining = remainingAfterPurchaseRequests(ln, allocByMrLine);
    if (remaining <= EPS) continue;
    const itemId = ln.rmItemId;
    let bucket = byItem.get(itemId);
    if (!bucket) {
      bucket = {
        itemId,
        requiredQty: 0,
        availableQty: 0,
        netRequiredQty: 0,
        unit: ln.unitSnapshot || ln.rmItem?.unit || null,
        allocations: [],
      };
      byItem.set(itemId, bucket);
    }
    bucket.requiredQty += Number(ln.requiredQty ?? 0);
    bucket.availableQty += Number(ln.availableQtySnapshot ?? 0);
    bucket.netRequiredQty += remaining;
    bucket.allocations.push({ materialRequirementLineId: ln.id, qty: remaining });
  }
  return [...byItem.values()];
}

async function findOpenRegularSoMaterialRequirement(salesOrderId, db = prisma) {
  return db.materialRequirement.findFirst({
    where: {
      salesOrderId,
      sourceType: { in: regularSoProcurementSourceTypes() },
      status: { in: [...OPEN_REGULAR_SO_MR_FOR_PR_STATUSES] },
    },
    orderBy: { id: "desc" },
    include: {
      lines: { include: { rmItem: { select: { id: true, itemName: true, unit: true } } } },
    },
  });
}

async function findLatestOpenPurchaseRequestForMaterialRequirement(materialRequirementId, db = prisma) {
  const link = await db.purchaseRequestLineSourceLink.findFirst({
    where: {
      materialRequirementLine: { materialRequirementId },
      purchaseRequestLine: {
        purchaseRequest: { status: { not: "CANCELLED" } },
      },
    },
    orderBy: { id: "desc" },
    include: {
      purchaseRequestLine: {
        include: {
          purchaseRequest: {
            include: {
              lines: {
                include: {
                  rmItem: { select: { id: true, itemName: true, unit: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  return link?.purchaseRequestLine?.purchaseRequest ?? null;
}

/**
 * Create (or reuse) REGULAR_SO MaterialRequirement for the SO, then create Purchase Request.
 * Repeated calls are idempotent when remaining MR qty is already allocated to a PR.
 */
async function createPurchaseRequestFromRegularSalesOrder(input, actor = {}, db = prisma) {
  const salesOrderId = Number(input.salesOrderId);
  if (!Number.isFinite(salesOrderId) || salesOrderId <= 0) {
    const err = new Error("Invalid salesOrderId");
    err.statusCode = 400;
    throw err;
  }

  const so = await db.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: { id: true, docNo: true, orderType: true },
  });
  if (!so) {
    const err = new Error("Sales order not found");
    err.statusCode = 404;
    throw err;
  }
  if (so.orderType === "NO_QTY" || (so.orderType && so.orderType !== "NORMAL")) {
    const err = new Error(
      "Create Purchase Request from sales order is only for Regular (NORMAL) sales orders.",
    );
    err.statusCode = 400;
    err.code = "REGULAR_SO_ONLY";
    throw err;
  }

  assertActorMayCreatePurchaseRequest(actor, [REGULAR_SO_PROCUREMENT_SOURCE]);

  let mr = await findOpenRegularSoMaterialRequirement(salesOrderId, db);
  let reusedMr = Boolean(mr);

  if (!mr) {
    const raised = await createMaterialRequirementFromWoPlanning(
      {
        salesOrderId,
        workOrderId: input.workOrderId,
        planQtyByLineId: input.planQtyByLineId ?? {},
        createdByUserId: actor.userId,
        confirmReuse: Boolean(input.confirmReuse),
        confirmReopenClosed: Boolean(input.confirmReopenClosed),
      },
      db,
    );
    mr = raised.materialRequirement;
    reusedMr = Boolean(raised.reused);
  }

  if (!mr?.id) {
    const err = new Error("Material requirement was not created for this sales order.");
    err.statusCode = 500;
    throw err;
  }

  const allocByMrLine = await loadTotalPurchaseRequestAllocByMrLineId(db);
  const lines = buildPurchaseRequestLinesFromMaterialRequirement(mr, allocByMrLine);

  if (!lines.length) {
    const existingPr = await findLatestOpenPurchaseRequestForMaterialRequirement(mr.id, db);
    if (!existingPr) {
      const err = new Error("No RM lines are eligible for a purchase request on this sales order.");
      err.statusCode = 400;
      err.code = "NO_ELIGIBLE_PR_LINES";
      throw err;
    }
    return {
      purchaseRequest: existingPr,
      materialRequirement: mr,
      salesOrder: { id: so.id, docNo: so.docNo },
      reusedMr,
      reusedPr: true,
      created: false,
    };
  }

  const soLabel = so.docNo?.trim() || `SO #${so.id}`;
  const result = await createPurchaseRequestFromPool(
    {
      remarks: `Purchase request for ${soLabel}`,
      lines,
    },
    actor,
  );

  return {
    purchaseRequest: result.purchaseRequest,
    materialRequirement: mr,
    salesOrder: { id: so.id, docNo: so.docNo },
    reusedMr,
    reusedPr: false,
    created: true,
  };
}

module.exports = {
  OPEN_REGULAR_SO_MR_FOR_PR_STATUSES,
  buildPurchaseRequestLinesFromMaterialRequirement,
  createPurchaseRequestFromRegularSalesOrder,
  findLatestOpenPurchaseRequestForMaterialRequirement,
  findOpenRegularSoMaterialRequirement,
};
