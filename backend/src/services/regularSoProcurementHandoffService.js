/**
 * REGULAR_SO Store → PR handoff projection for Procurement Workspace.
 * Surfaces the same SO-wise RM shortages Pending Actions treat as Create PR,
 * including cases where an APPROVED MaterialRequirement does not exist yet.
 *
 * Projections use live WO-prepare / RM readiness (same authority as
 * createMaterialRequirementFromWoPlanning / createPurchaseRequestFromRegularSalesOrder).
 * They are not fabricated empty-state placeholders.
 */

const { prisma } = require("../utils/prisma");
const { QUEUE_EPS, qtyToNumber } = require("./rmPurchaseHelpers");
const {
  REGULAR_SO_PROCUREMENT_SOURCE,
  regularSoProcurementSourceTypes,
  isRegularSoProcurementSource,
} = require("./regularSoProcurementSource");
const { evaluateWoPrepareReadiness } = require("./materialPlanningService");
const { computeFgGapLinesForSalesOrder } = require("./rmCheckService");

const SO_INCLUDE = {
  customer: { select: { name: true } },
  lines: { include: { item: { select: { id: true, itemName: true, itemType: true, unit: true } } } },
};

/**
 * Stable synthetic id for SO-shortage rows that do not yet have an MR.
 * Negative so they never collide with real materialRequirementId values.
 */
function syntheticMaterialRequirementIdForSalesOrder(salesOrderId) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return null;
  return -soId;
}

function isSyntheticRegularSoRequirementId(materialRequirementId) {
  const id = Number(materialRequirementId);
  return Number.isFinite(id) && id < 0;
}

function salesOrderIdFromSyntheticRequirementId(materialRequirementId) {
  if (!isSyntheticRegularSoRequirementId(materialRequirementId)) return null;
  return Math.abs(Number(materialRequirementId));
}

/**
 * Build a workspace MrSummary for a NORMAL SO with live RM shortage and no open MR yet.
 * @returns {object|null}
 */
async function buildRegularSoPreMrShortageSummary(so, db = prisma) {
  if (!so?.id || so.orderType === "NO_QTY") return null;
  if (so.orderType && so.orderType !== "NORMAL") return null;

  const { fgLines } = await computeFgGapLinesForSalesOrder(so, db);
  const readiness = await evaluateWoPrepareReadiness(
    so.id,
    { fgLines, planQtyByLineId: {}, planQtyByFgItemId: {} },
    db,
  );

  if (!readiness.canRaiseRequirement) return null;

  const shortageLines = (readiness.rmSummary || []).filter((r) => qtyToNumber(r.shortageQty) > QUEUE_EPS);
  if (!shortageLines.length) return null;

  // Open purchase-visible / draft MR already covers this SO — caller should use the MR row.
  if ((readiness.pendingMaterialRequirements || []).length > 0) return null;

  const primaryFg =
    fgLines.find((f) => !f.note && Number(f.rmPlanningQty ?? f.toProduce ?? 0) > 0) ??
    fgLines.find((f) => !f.note) ??
    null;

  let totalShortageQty = 0;
  let totalRemainingQty = 0;
  const lines = shortageLines.map((r, idx) => {
    const shortage = qtyToNumber(r.shortageQty);
    const required = qtyToNumber(r.requiredQty);
    const available = qtyToNumber(r.availableQty);
    totalShortageQty += shortage;
    totalRemainingQty += shortage;
    return {
      lineId: -(so.id * 1000 + idx + 1),
      rmItemId: r.rmItemId,
      itemName: r.itemName ?? "",
      unit: r.unit ?? "",
      requiredQty: required,
      shortageQty: shortage,
      remainingQty: shortage,
      availableQty: available,
      existingPrQty: 0,
      planningStatus: "Awaiting purchase request",
    };
  });

  const soDocNo = so.docNo?.trim() || null;
  const primaryRm = shortageLines[0];

  return {
    materialRequirementId: syntheticMaterialRequirementIdForSalesOrder(so.id),
    docNo: null,
    sourceType: REGULAR_SO_PROCUREMENT_SOURCE,
    source: {
      type: REGULAR_SO_PROCUREMENT_SOURCE,
      label: "Sales Order",
      monthlyProductionPlanId: null,
      periodKey: null,
      sourceRevision: null,
    },
    sourceRef: soDocNo || `SO-${so.id}`,
    fgItemId: primaryFg?.fgItemId ?? null,
    plannedProductionQty: primaryFg?.plannedProductionQty ?? null,
    workOrderId: null,
    workOrderNo: null,
    salesOrderId: so.id,
    salesOrderDocNo: soDocNo,
    customerName: so.customer?.name ?? null,
    primaryFgName: primaryFg?.itemName ?? primaryFg?.fgItemName ?? null,
    primaryRmName: primaryRm?.itemName ?? null,
    primaryRmUnit: primaryRm?.unit ?? null,
    customerCommittedQty: primaryFg ? Number(primaryFg.customerCommittedQty ?? primaryFg.orderQty ?? 0) : null,
    productionBufferPercent: primaryFg ? Number(primaryFg.productionBufferPercent ?? 0) : null,
    rmPlanningQty: primaryFg ? Number(primaryFg.rmPlanningQty ?? primaryFg.toProduce ?? 0) : null,
    shortageRmLineCount: shortageLines.length,
    totalShortageQty,
    totalRemainingQty,
    pendingGrnQty: 0,
    procurementStage: "Procurement Pending",
    createdAt: null,
    createdByName: null,
    status: "APPROVED",
    operationalKey: "PROCUREMENT_PENDING",
    operationalLabel: "Procurement Pending",
    blockerReason: "RM shortage — create Purchase Request for Regular SO",
    recommendedAction: "Create Purchase Request",
    pendingPoStatus: "No PO",
    pendingGrnStatus: "No GRN",
    supplierPendingStatus: "Awaiting purchase action",
    primaryPoId: null,
    lines,
    canCreatePurchaseRequest: true,
    nextActionKey: "CREATE_PR",
    preMaterialRequirement: true,
    procurementDemandPool: "REGULAR_SO",
  };
}

/**
 * Load Regular SO shortage projections for Sales Orders workspace (no open MR yet).
 * @param {object} [opts]
 * @param {number|null} [opts.salesOrderId]
 * @param {Iterable<number>} [opts.excludeSalesOrderIds] — SOs already represented by purchase-visible MRs
 */
async function listRegularSoPreMrShortageSummaries(
  db = prisma,
  { salesOrderId = null, excludeSalesOrderIds = [] } = {},
) {
  const excluded = new Set(
    [...excludeSalesOrderIds].map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0),
  );
  const filterSoId = salesOrderId != null && Number(salesOrderId) > 0 ? Number(salesOrderId) : null;

  let sos;
  if (filterSoId) {
    if (excluded.has(filterSoId)) return [];
    sos = await db.salesOrder.findMany({
      where: { id: filterSoId, orderType: "NORMAL" },
      take: 1,
      include: SO_INCLUDE,
    });
  } else {
    sos = await db.salesOrder.findMany({
      where: {
        orderType: "NORMAL",
        internalStatus: { notIn: ["DRAFT", "CLOSED", "MANUALLY_CLOSED", "CLOSED_WITH_WAIVER", "COMPLETED"] },
        ...(excluded.size ? { id: { notIn: [...excluded] } } : {}),
      },
      include: SO_INCLUDE,
      orderBy: { id: "desc" },
      take: 40,
    });
  }

  const out = [];
  for (const so of sos || []) {
    if (excluded.has(so.id)) continue;
    try {
      const summary = await buildRegularSoPreMrShortageSummary(so, db);
      if (summary) out.push(summary);
    } catch {
      // Skip SOs that fail planning initialization.
    }
  }
  return out;
}

/**
 * Source types visible on the REGULAR_SO Sales Orders workspace tab (includes legacy WOP).
 */
function regularSoWorkspaceSourceTypes() {
  return regularSoProcurementSourceTypes();
}

function isRegularSoWorkspaceSourceType(sourceType) {
  return isRegularSoProcurementSource(sourceType);
}

module.exports = {
  syntheticMaterialRequirementIdForSalesOrder,
  isSyntheticRegularSoRequirementId,
  salesOrderIdFromSyntheticRequirementId,
  buildRegularSoPreMrShortageSummary,
  listRegularSoPreMrShortageSummaries,
  regularSoWorkspaceSourceTypes,
  isRegularSoWorkspaceSourceType,
};
