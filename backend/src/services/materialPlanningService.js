/**
 * REGULAR flow material planning — quotation or sales order → RM requirement + shortage.
 */

const { prisma } = require("../utils/prisma");
const { getMaterialAvailabilityByItems } = require("./materialAvailabilityService");
const {
  buildFgBomMeta,
  aggregateRmDemandForFgLines,
  round3,
} = require("./bomExplosionService");
const { DocType } = require("../prismaClientPackage");
const { allocateDocNo } = require("./docNoService");
const { isMaterialRequirementFullyReceived } = require("./procurementLifecycleService");
const {
  buildRegularSoPlanningSnapshotView,
  fgShortageDemandInputFromPlanningView,
} = require("./regularSoPlanningSnapshotService");
const {
  RM_REQUISITION_ACTIVE_STATUSES,
  rmRequisitionStatusLabel,
} = require("./rmRequisitionLifecycle");

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** Customer master uses `name`; API responses expose stable `customerName`. */
function customerDisplayName(customer) {
  if (!customer) return "";
  const label = customer.name ?? customer.customerName ?? "";
  return typeof label === "string" ? label.trim() : "";
}

function rmLineStatus(requiredQty, availableQty) {
  const shortage = Math.max(0, requiredQty - availableQty);
  if (shortage <= 1e-6) return "AVAILABLE";
  if (availableQty > 1e-6) return "PARTIAL";
  return "SHORTAGE";
}

async function loadQuotationContext(quotationId, db = prisma) {
  const q = await db.quotation.findUnique({
    where: { id: quotationId },
    include: {
      lines: { include: { item: true } },
      enquiry: { include: { customer: true } },
      salesOrder: { select: { id: true, docNo: true } },
    },
  });
  if (!q) {
    const err = new Error("Quotation not found");
    err.statusCode = 404;
    throw err;
  }
  if (q.workflowStatus !== "APPROVED") {
    const err = new Error("Quotation must be approved before material planning.");
    err.statusCode = 400;
    throw err;
  }
  if (q.flowTypeSnapshot !== "REGULAR") {
    const err = new Error("Material planning applies to Regular flow quotations only.");
    err.statusCode = 400;
    throw err;
  }
  return q;
}

async function loadSalesOrderContext(salesOrderId, db = prisma) {
  const so = await db.salesOrder.findUnique({
    where: { id: salesOrderId },
    include: {
      lines: { include: { item: true } },
      customer: true,
      quotation: { select: { id: true, quotationNo: true } },
    },
  });
  if (!so) {
    const err = new Error("Sales order not found");
    err.statusCode = 404;
    throw err;
  }
  const orderType = so.orderType ?? "NORMAL";
  if (orderType === "NO_QTY") {
    const err = new Error("Use Requirement & Cycle Planning for No Qty sales orders.");
    err.statusCode = 400;
    throw err;
  }
  if (orderType !== "NORMAL" && orderType !== "REPLACEMENT") {
    const err = new Error("Material planning applies to Regular sales orders only.");
    err.statusCode = 400;
    throw err;
  }
  return so;
}

function fgLinesFromQuotation(q) {
  return (q.lines ?? [])
    .filter((l) => l.item?.itemType === "FG")
    .map((l) => ({
      lineId: l.id,
      fgItemId: l.itemId,
      fgName: l.item.itemName,
      fgQty: n(l.qty),
      unit: l.item.unit ?? "",
    }));
}

function fgLinesFromSalesOrder(so, planningView = null) {
  if (planningView?.lines?.length) {
    return fgShortageDemandInputFromPlanningView(planningView);
  }
  return (so.lines ?? [])
    .filter((l) => l.item?.itemType === "FG")
    .map((l) => ({
      lineId: l.id,
      fgItemId: l.itemId,
      fgName: l.item.itemName,
      fgQty: n(l.qty),
      unit: l.item.unit ?? "",
    }));
}

/** Map UI status to operator-friendly readiness chip. */
function readinessChipStatus(rmStatus) {
  if (rmStatus === "AVAILABLE") return "READY";
  if (rmStatus === "PARTIAL") return "PARTIAL";
  return "SHORTAGE";
}

function buildRmSummaryLineFromAvailability({ rmItemId, requiredQty, item, availability }) {
  const availableQty = availability?.freeStockQty ?? 0;
  const required = round3(requiredQty);
  const shortage = round3(availability?.shortageAfterReservationQty ?? Math.max(0, required - availableQty));
  const status = rmLineStatus(required, availableQty);
  return {
    rmItemId,
    itemName: item?.itemName ?? `#${rmItemId}`,
    unit: item?.unit ?? "",
    requiredQty: required,
    physicalUsableStockQty: availability?.physicalUsableStockQty ?? availableQty,
    activeAllocatedQty: availability?.activeAllocatedQty ?? 0,
    legacyReservedQty: availability?.legacyReservedQty ?? 0,
    effectiveReservedQty: availability?.effectiveReservedQty ?? availability?.legacyReservedQty ?? 0,
    freeStockQty: availability?.freeStockQty ?? availableQty,
    incomingQty: availability?.incomingQty ?? 0,
    issuedToProductionQty: availability?.issuedToProductionQty ?? 0,
    shortageNowQty: availability?.shortageNowQty ?? Math.max(0, required - availableQty),
    shortageAfterReservationQty: shortage,
    coveredByIncomingQty: availability?.coveredByIncomingQty ?? 0,
    netShortageAfterIncomingQty: availability?.netShortageAfterIncomingQty ?? shortage,
    allocationCoverageQty: availability?.allocationCoverageQty ?? 0,
    allocationShortageQty: availability?.allocationShortageQty ?? shortage,
    allocationStatus: availability?.allocationStatus ?? "NOT_ALLOCATED",
    warnings: availability?.warnings ?? [],
    /** Backward-compatible aliases consumed by existing frontend/MR code. */
    availableQty,
    shortageQty: shortage,
    status,
    readinessStatus: readinessChipStatus(status),
  };
}

/**
 * Single source: BOM explosion, RM merge, stock compare (approved BOM only).
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {{ lineId?: number, fgItemId: number, fgName?: string, fgQty: number, unit?: string }[]} fgInput
 */
async function buildMaterialReadinessForFgDemand(db, fgInput) {
  const fgSummary = [];
  for (const row of fgInput) {
    if (!(row.fgQty > 0)) continue;
    const meta = await buildFgBomMeta(db, row.fgItemId);
    const bomMissing = meta.planningStatus === "MISSING_BOM";
    fgSummary.push({
      lineId: row.lineId ?? null,
      fgItemId: row.fgItemId,
      fgName: row.fgName ?? "",
      fgQty: n(row.fgQty),
      unit: row.unit ?? "",
      bomRevision: meta.bomRevision,
      bomDocNo: meta.bom?.docNo ?? null,
      rmCount: meta.rmCount,
      sfgCount: meta.sfgCount,
      childBomsLinked: meta.childBomsLinked,
      missingChildBomNames: meta.missingChildBomNames,
      planningStatus: bomMissing ? "MISSING_BOM" : meta.planningStatus,
      bomMissing,
      warningMessage: bomMissing
        ? "Approved BOM not found."
        : meta.missingChildBomNames.length
          ? `Child BOM missing for ${meta.missingChildBomNames.join(", ")}`
          : null,
    });
  }

  const { rmNeeded, missingChildBoms } = await aggregateRmDemandForFgLines(
    db,
    fgSummary.map((f) => ({ fgItemId: f.fgItemId, fgQty: f.fgQty, bomMissing: f.bomMissing })),
  );

  const rmIds = [...rmNeeded.keys()];
  const [rmItems, availabilityRows] = await Promise.all([
    rmIds.length > 0
      ? db.item.findMany({
          where: { id: { in: rmIds } },
          select: { id: true, itemName: true, unit: true, itemType: true },
        })
      : Promise.resolve([]),
    getMaterialAvailabilityByItems({
      db,
      itemIds: rmIds,
      requiredQtyByItemId: rmNeeded,
      includeIncoming: true,
      includeIssued: true,
    }),
  ]);
  const itemById = new Map(rmItems.map((i) => [i.id, i]));
  const availabilityByItemId = new Map(availabilityRows.map((row) => [row.itemId, row]));

  const rmSummary = [];
  for (const [rmItemId, requiredQty] of rmNeeded) {
    rmSummary.push(buildRmSummaryLineFromAvailability({
      rmItemId,
      requiredQty,
      item: itemById.get(rmItemId),
      availability: availabilityByItemId.get(rmItemId),
    }));
  }
  rmSummary.sort((a, b) => b.shortageQty - a.shortageQty || a.itemName.localeCompare(b.itemName));

  const hasMissingBom = fgSummary.some((f) => f.bomMissing);
  const hasMissingChildBom =
    fgSummary.some((f) => f.planningStatus === "MISSING_CHILD_BOM") || missingChildBoms.length > 0;
  const totalShortageLines = rmSummary.filter((r) => r.shortageQty > 0).length;
  const allRmAvailable = rmSummary.length > 0 && rmSummary.every((r) => r.status === "AVAILABLE");
  const availableRmCount = rmSummary.filter((r) => r.status === "AVAILABLE").length;
  const shortageRmCount = totalShortageLines;

  const childBomWarnings = [
    ...new Set(
      fgSummary.flatMap((f) =>
        (f.missingChildBomNames ?? []).map((name) => `Child BOM missing for ${name}`),
      ),
    ),
  ];

  return {
    fgSummary,
    rmSummary,
    childBomsLinked: fgSummary.reduce((s, f) => s + (f.childBomsLinked ?? 0), 0),
    childBomWarnings,
    hasMissingBom,
    hasMissingChildBom,
    totalShortageLines,
    allRmAvailable,
    rmCount: rmSummary.length,
    fgCount: fgInput.filter((r) => r.fgQty > 0).length,
    materialReadiness: {
      planningSource: "Material Planning Engine",
      requiredRmCount: rmSummary.length,
      availableRmCount,
      shortageRmCount,
      allRmAvailable,
    },
    canRaiseRequirement: !hasMissingBom && !hasMissingChildBom && rmSummary.length > 0,
  };
}

function resolveWoPrepareBlockReason(readiness, { pendingMaterialRequirements = [] } = {}) {
  if (readiness.hasMissingBom) {
    return "Approved BOM not found. Complete BOM before work order.";
  }
  if (readiness.hasMissingChildBom) {
    const names = readiness.fgSummary
      .flatMap((f) => f.missingChildBomNames ?? [])
      .filter(Boolean);
    if (names.length) {
      return `Child BOM missing. Complete SFG BOM before work order (${names.join(", ")}).`;
    }
    return "Child BOM missing. Complete SFG BOM before work order.";
  }
  if (pendingMaterialRequirements.length > 0 && readiness.totalShortageLines > 0) {
    const refs = pendingMaterialRequirements.map((m) => m.docNo || `#${m.id}`).join(", ");
    return `Material requirement is pending (${refs}). Complete purchase/GRN before creating work order.`;
  }
  if (readiness.totalShortageLines > 0) {
    return "Raw material shortage. Raise material requirement for Purchase before creating Work Order.";
  }
  if (readiness.rmSummary.length === 0) {
    return "No RM requirement calculated for planned production.";
  }
  return null;
}

const WO_PLANNING_SOURCE = "WORK_ORDER_PLANNING";

function roundForCaseSignature(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(3) : "0.000";
}

function buildWoPlanningCaseSignatureFromLines(lines = []) {
  return (lines || [])
    .map((line) => `${Number(line.rmItemId)}:${roundForCaseSignature(line.shortageQty ?? line.requiredQty)}`)
    .sort()
    .join("|");
}

function buildWoPlanningHeaderSignature(mr) {
  const fgItemId = Number(mr?.fgItemId ?? 0) || 0;
  const lineSig = buildWoPlanningCaseSignatureFromLines(mr?.lines || []);
  return `${fgItemId}:${lineSig}`;
}

function buildWoPlanningTargetSignature({ fgItemId = null, shortageLines = [] } = {}) {
  return `${Number(fgItemId ?? 0) || 0}:${buildWoPlanningCaseSignatureFromLines(shortageLines)}`;
}

async function findReusableWoPlanningMaterialRequirement({
  salesOrderId,
  workOrderId = null,
  fgItemId = null,
  plannedProductionQty = 0,
  shortageLines = [],
}, db = prisma) {
  const woId = workOrderId != null && Number(workOrderId) > 0 ? Number(workOrderId) : null;
  const workOrderFilter =
    woId != null
      ? {
          OR: [{ workOrderId: woId }, { workOrderId: null }],
        }
      : { workOrderId: null };

  const candidates = await db.materialRequirement.findMany({
    where: {
      salesOrderId,
      sourceType: WO_PLANNING_SOURCE,
      // CLOSED/CANCELLED are terminal; they do not participate in active loops or reuse.
      status: { notIn: ["CANCELLED", "CLOSED"] },
      ...workOrderFilter,
    },
    include: {
      lines: {
        include: {
          procurementLinks: {
            include: {
              rmPoLine: {
                include: {
                  rmPo: { select: { id: true, status: true } },
                  grnLines: { include: { grn: { select: { id: true, reversedAt: true } } } },
                },
              },
            },
          },
          purchaseRequestSourceLinks: {
            include: {
              purchaseRequestLine: {
                include: {
                  sourceLinks: true,
                  poLinks: {
                    include: {
                      rmPoLine: {
                        include: {
                          rmPo: { select: { id: true, status: true } },
                          grnLines: { include: { grn: { select: { id: true, reversedAt: true } } } },
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
    orderBy: { id: "desc" },
  });

  const targetSig = buildWoPlanningTargetSignature({ fgItemId, shortageLines });

  return candidates.find((mr) => {
    if (isMaterialRequirementFullyReceived(mr)) return false;
    const storedFgItemId = Number(mr.fgItemId ?? 0) || 0;
    const targetLineSig = buildWoPlanningCaseSignatureFromLines(shortageLines);
    const storedLineSig = buildWoPlanningCaseSignatureFromLines(mr.lines || []);
    if (storedFgItemId > 0 && Number(fgItemId ?? 0) > 0 && storedFgItemId === Number(fgItemId) && storedLineSig === targetLineSig) {
      return true;
    }
    if (storedFgItemId === 0) {
      return storedLineSig === targetLineSig;
    }
    return buildWoPlanningHeaderSignature(mr) === targetSig;
  }) ?? null;
}

/**
 * Active RM Requisitions raised from Prepare Work Order for this SO (optional WO scope).
 */
async function findPendingWoPlanningMaterialRequirements(salesOrderId, { workOrderId = null } = {}, db = prisma) {
  const woId = workOrderId != null && Number(workOrderId) > 0 ? Number(workOrderId) : null;
  const workOrderFilter =
    woId != null
      ? {
          OR: [{ workOrderId: woId }, { workOrderId: null }],
        }
      : { workOrderId: null };
  const rows = await db.materialRequirement.findMany({
    where: {
      salesOrderId,
      // CLOSED/CANCELLED are terminal for operational loops; keep them in history only.
      status: { notIn: ["CANCELLED", "CLOSED"] },
      sourceType: WO_PLANNING_SOURCE,
      ...workOrderFilter,
    },
    include: {
      lines: {
        include: {
          procurementLinks: {
            include: {
              rmPoLine: {
                include: {
                  rmPo: { select: { id: true, status: true } },
                  grnLines: { include: { grn: { select: { id: true, reversedAt: true } } } },
                },
              },
            },
          },
          purchaseRequestSourceLinks: {
            include: {
              purchaseRequestLine: {
                include: {
                  sourceLinks: true,
                  poLinks: {
                    include: {
                      rmPoLine: {
                        include: {
                          rmPo: { select: { id: true, status: true } },
                          grnLines: { include: { grn: { select: { id: true, reversedAt: true } } } },
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
    orderBy: { id: "desc" },
  });
  const unique = new Map();
  for (const mr of rows.filter((row) => !isMaterialRequirementFullyReceived(row))) {
    const key = buildWoPlanningHeaderSignature(mr);
    if (!unique.has(key)) {
      unique.set(key, { id: mr.id, docNo: mr.docNo, workOrderId: mr.workOrderId, createdAt: mr.createdAt });
    }
  }
  return [...unique.values()];
}

/** Resolve optional work order for a REGULAR sales order (latest pending/in-progress WO). */
async function resolveWorkOrderIdForWoPlanning(salesOrderId, opts = {}, db = prisma) {
  const explicit = Number(opts.workOrderId);
  if (Number.isFinite(explicit) && explicit > 0) {
    const wo = await db.workOrder.findFirst({
      where: { id: explicit, salesOrderId },
      select: { id: true },
    });
    if (!wo) {
      const err = new Error("Work order not found for this sales order.");
      err.statusCode = 400;
      throw err;
    }
    return wo.id;
  }
  const latest = await db.workOrder.findFirst({
    where: { salesOrderId, status: { in: ["PENDING", "IN_PROGRESS"] } },
    orderBy: { id: "desc" },
    select: { id: true },
  });
  return latest?.id ?? null;
}

/**
 * WO Prepare material gate — uses plan qty when provided, else FG toProduce gap.
 */
async function evaluateWoPrepareReadiness(
  salesOrderId,
  { fgLines, planQtyByLineId = {}, planQtyByFgItemId = {}, workOrderId: workOrderIdOpt } = {},
  db = prisma,
) {
  await loadSalesOrderContext(salesOrderId, db);

  const fgInput = [];
  for (const f of fgLines ?? []) {
    if (f.note) continue;
    const fromLine = planQtyByLineId[f.lineId];
    const fromFg = planQtyByFgItemId[f.fgItemId];
    let qty;
    if (fromLine != null && Number.isFinite(Number(fromLine))) {
      qty = Math.max(0, Number(fromLine));
    } else if (fromFg != null && Number.isFinite(Number(fromFg))) {
      qty = Math.max(0, Number(fromFg));
    } else {
      qty = Math.max(0, Number(f.rmPlanningQty ?? f.plannedProductionQty ?? f.toProduce) || 0);
    }
    if (qty <= 0) continue;
    fgInput.push({
      lineId: f.lineId,
      fgItemId: f.fgItemId,
      fgName: f.fgName,
      fgQty: qty,
    });
  }

  const readiness = await buildMaterialReadinessForFgDemand(db, fgInput);

  const resolvedWorkOrderId = await resolveWorkOrderIdForWoPlanning(
    salesOrderId,
    { workOrderId: workOrderIdOpt },
    db,
  );
  const pendingMaterialRequirements = await findPendingWoPlanningMaterialRequirements(
    salesOrderId,
    { workOrderId: resolvedWorkOrderId },
    db,
  );

  const woBlockReason = resolveWoPrepareBlockReason(readiness, { pendingMaterialRequirements });
  const canCreateWorkOrder = woBlockReason == null;

  return {
    ...readiness,
    pendingMaterialRequirements,
    canCreateWorkOrder,
    woBlockReason,
  };
}

async function buildMaterialPlanningPreview({ quotationId, salesOrderId }, db = prisma) {
  let sourceType;
  let context;
  let fgInput;

  if (quotationId) {
    context = await loadQuotationContext(quotationId, db);
    sourceType = "QUOTATION";
    fgInput = fgLinesFromQuotation(context);
  } else if (salesOrderId) {
    context = await loadSalesOrderContext(salesOrderId, db);
    sourceType = "SALES_ORDER";
    const planningView = await buildRegularSoPlanningSnapshotView(salesOrderId, db);
    fgInput = fgLinesFromSalesOrder(context, planningView);
  } else {
    const err = new Error("Provide quotationId or salesOrderId.");
    err.statusCode = 400;
    throw err;
  }

  const readiness = await buildMaterialReadinessForFgDemand(db, fgInput);

  const existingWhere =
    quotationId != null ? { quotationId } : salesOrderId != null ? { salesOrderId } : null;
  const materialRequirements = await loadMaterialRequirementsForPlanningState(db, existingWhere);
  const activeExistingRow = materialRequirements.find((mr) => mr.status !== "CANCELLED" && !isMaterialRequirementFullyReceived(mr)) ?? null;
  const completedExistingRow =
    activeExistingRow == null
      ? materialRequirements.find((mr) => mr.status !== "CANCELLED" && isMaterialRequirementFullyReceived(mr)) ?? null
      : null;
  const cancelledExistingRow = materialRequirements.find((mr) => mr.status === "CANCELLED") ?? null;
  const existingMaterialRequirement = mapExistingMaterialRequirement(activeExistingRow);
  const completedMaterialRequirement = mapExistingMaterialRequirement(completedExistingRow);
  const cancelledMaterialRequirement = mapExistingMaterialRequirement(cancelledExistingRow);

  let customerName = "";
  let referenceLabel = "";
  let referenceNo = "";

  if (sourceType === "QUOTATION") {
    customerName = customerDisplayName(context.enquiry?.customer);
    referenceLabel = "Quotation";
    referenceNo = context.quotationNo ?? `#${context.id}`;
  } else {
    customerName = customerDisplayName(context.customer);
    referenceLabel = "Sales order";
    referenceNo = context.docNo ?? `#${context.id}`;
  }

  const procurementCompleted = Boolean(completedExistingRow) && activeExistingRow == null;

  const operationalState = materialPlanningOperationalState({
    sourceType,
    context,
    readiness,
    activeMaterialRequirement: activeExistingRow,
    cancelledMaterialRequirement: cancelledExistingRow,
    procurementCompleted,
  });

  return {
    sourceType,
    quotationId: quotationId ?? null,
    salesOrderId: salesOrderId ?? null,
    customerName,
    referenceLabel,
    referenceNo,
    linkedSalesOrderId: sourceType === "QUOTATION" ? context.salesOrder?.id ?? null : context.id,
    linkedSalesOrderNo: sourceType === "QUOTATION" ? context.salesOrder?.docNo ?? null : context.docNo,
    linkedQuotationId: sourceType === "SALES_ORDER" ? context.quotation?.id ?? null : context.id,
    linkedQuotationNo: sourceType === "SALES_ORDER" ? context.quotation?.quotationNo ?? null : context.quotationNo,
    fgCount: readiness.fgCount,
    rmCount: readiness.rmCount,
    fgSummary: readiness.fgSummary,
    rmSummary: readiness.rmSummary,
    childBomsLinked: readiness.childBomsLinked,
    childBomWarnings: readiness.childBomWarnings,
    hasMissingBom: readiness.hasMissingBom,
    hasMissingChildBom: readiness.hasMissingChildBom,
    canRaiseRequirement:
      readiness.canRaiseRequirement &&
      !operationalState.sourceCompleted &&
      !operationalState.procurementCompleted &&
      !activeExistingRow,
    totalShortageLines: readiness.totalShortageLines,
    allRmAvailable: readiness.allRmAvailable,
    materialReadiness: readiness.materialReadiness,
    existingMaterialRequirement,
    completedMaterialRequirement,
    cancelledMaterialRequirement,
    operationalState,
  };
}

function mapExistingMaterialRequirement(row) {
  if (!row) return null;
  return {
    id: row.id,
    docNo: row.docNo,
    status: row.status,
    statusLabel: materialRequirementStatusLabel(row.status),
    createdAt: row.createdAt,
    fgItemId: row.fgItemId ?? null,
    plannedProductionQty: row.plannedProductionQty ?? null,
    lines: (row.lines ?? []).map((l) => ({
      rmItemId: l.rmItemId,
      itemName: l.rmItem?.itemName ?? "",
      unit: l.unitSnapshot ?? l.rmItem?.unit ?? "",
      requiredQty: n(l.requiredQty),
      shortageQty: n(l.shortageQty),
      availableQty: n(l.availableQtySnapshot),
    })),
  };
}

function materialRequirementStatusLabel(status) {
  return rmRequisitionStatusLabel(status);
}

function isSalesOrderCompleted(so) {
  return so?.internalStatus === "COMPLETED";
}

/**
 * Planning-only operational labels. Store issue / production readiness are owned by
 * RM Control Center, Material Issue, Prepare WO, and Production — never inferred from
 * procurementCompleted or MR lifecycle alone.
 */
function materialPlanningOperationalState({
  sourceType,
  context,
  readiness,
  activeMaterialRequirement,
  cancelledMaterialRequirement,
  procurementCompleted,
}) {
  const liveShortageLines = readiness.rmSummary.filter((r) => r.shortageQty > 0);
  const purchaseRequiredCount = liveShortageLines.length;
  const pendingProcurementQty = liveShortageLines.reduce((s, r) => s + Math.max(0, r.shortageQty), 0);
  const rmControlCenterHint = "Open RM Control Center for live store availability";

  if (sourceType === "SALES_ORDER" && isSalesOrderCompleted(context)) {
    return {
      key: "SO_COMPLETED",
      currentStage: "Sales Order completed — RM planning closed",
      purchaseRequiredCount: 0,
      pendingProcurementQty: 0,
      readyForProduction: false,
      procurementCompleted: Boolean(procurementCompleted),
      sourceCompleted: true,
      banner:
        cancelledMaterialRequirement && !activeMaterialRequirement
          ? "Duplicate RM Requisition cancelled"
          : "Sales Order completed — no further RM planning required",
      actionLabel: "SO completed",
    };
  }

  if (activeMaterialRequirement) {
    const activeStatusLabel = materialRequirementStatusLabel(activeMaterialRequirement.status);
    const unresolvedClosed = activeMaterialRequirement.status === "CLOSED";
    return {
      key: "PROCUREMENT_PENDING",
      currentStage: unresolvedClosed
        ? "Requisition closed — live shortage may remain"
        : "Procurement in progress",
      purchaseRequiredCount,
      pendingProcurementQty,
      readyForProduction: false,
      procurementCompleted: false,
      sourceCompleted: false,
      banner: unresolvedClosed
        ? "RM Requisition closed but shortage unresolved"
        : `RM Requisition ${activeStatusLabel}`,
      actionLabel: unresolvedClosed ? "Open RM Control Center" : "Track procurement in RM Control Center",
      nextActionLabel: rmControlCenterHint,
    };
  }

  if (procurementCompleted) {
    return {
      key: "PROCUREMENT_COMPLETED",
      currentStage: purchaseRequiredCount > 0
        ? "Procurement complete — live store shortage remains"
        : "Procurement complete — live RM demand covered",
      purchaseRequiredCount,
      pendingProcurementQty,
      readyForProduction: false,
      procurementCompleted: true,
      sourceCompleted: false,
      banner: purchaseRequiredCount > 0
        ? "Procurement completed — verify live stock in RM Control Center"
        : "Procurement completed — confirm availability in RM Control Center",
      actionLabel: "Open RM Control Center",
      nextActionLabel: rmControlCenterHint,
    };
  }

  if (readiness.hasMissingBom || readiness.hasMissingChildBom) {
    return {
      key: "BOM_PENDING",
      currentStage: "Resolve BOM first",
      purchaseRequiredCount: 0,
      pendingProcurementQty: 0,
      readyForProduction: false,
      procurementCompleted: false,
      sourceCompleted: false,
      banner: null,
      actionLabel: "Resolve BOM",
    };
  }

  if (purchaseRequiredCount > 0) {
    return {
      key: "PURCHASE_REQUIRED",
      currentStage: "RM shortage detected (live store)",
      purchaseRequiredCount,
      pendingProcurementQty,
      readyForProduction: false,
      procurementCompleted: false,
      sourceCompleted: false,
      banner: cancelledMaterialRequirement ? "Duplicate RM Requisition cancelled" : null,
      actionLabel: "Raise RM requirement or open RM Control Center",
      nextActionLabel: rmControlCenterHint,
    };
  }

  return {
    key: "RM_PLANNING",
    currentStage: readiness.allRmAvailable ? "RM demand covered (live store)" : "RM planning review",
    purchaseRequiredCount: 0,
    pendingProcurementQty: 0,
    readyForProduction: false,
    procurementCompleted: false,
    sourceCompleted: false,
    banner: cancelledMaterialRequirement ? "Duplicate RM Requisition cancelled" : null,
    actionLabel: "Open RM Control Center",
    nextActionLabel: rmControlCenterHint,
  };
}

async function loadMaterialRequirementsForPlanningState(db, where) {
  if (!where) return [];
  return db.materialRequirement.findMany({
    where,
    orderBy: { id: "desc" },
    include: {
      lines: {
        include: {
          rmItem: { select: { id: true, itemName: true, unit: true } },
          procurementLinks: {
            include: {
              rmPoLine: {
                include: {
                  rmPo: { select: { id: true, status: true } },
                  grnLines: { include: { grn: { select: { id: true, reversedAt: true } } } },
                },
              },
            },
          },
          purchaseRequestSourceLinks: {
            include: {
              purchaseRequestLine: {
                include: {
                  sourceLinks: true,
                  poLinks: {
                    include: {
                      rmPoLine: {
                        include: {
                          rmPo: { select: { id: true, status: true } },
                          grnLines: { include: { grn: { select: { id: true, reversedAt: true } } } },
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
}

/**
 * Create or update a purchase-visible material requirement from Prepare Work Order planned FG qty.
 *
 * @param {{
 *   salesOrderId: number;
 *   workOrderId?: number;
 *   planQtyByLineId?: Record<number, number>;
 *   createdByUserId?: number;
 *   confirmReuse?: boolean;
 *   confirmReopenClosed?: boolean;
 * }} input
 */
async function createMaterialRequirementFromWoPlanning(input, db = prisma) {
  const salesOrderId = Number(input.salesOrderId);
  if (!Number.isFinite(salesOrderId) || salesOrderId <= 0) {
    const err = new Error("Invalid salesOrderId");
    err.statusCode = 400;
    throw err;
  }

  const workOrderId = await resolveWorkOrderIdForWoPlanning(
    salesOrderId,
    { workOrderId: input.workOrderId },
    db,
  );

  const so = await db.salesOrder.findUnique({
    where: { id: salesOrderId },
    include: { lines: { include: { item: true } } },
  });
  if (!so) {
    const err = new Error("Sales order not found");
    err.statusCode = 404;
    throw err;
  }
  if (so.orderType === "NO_QTY") {
    const err = new Error("Material requirement from WO planning is not available for NO_QTY sales orders.");
    err.statusCode = 400;
    throw err;
  }

  const { computeFgGapLinesForSalesOrder } = require("./rmCheckService");
  const { fgLines } = await computeFgGapLinesForSalesOrder(so, db);
  const primaryFgLine =
    fgLines.find((f) => !f.note && Number(f.rmPlanningQty ?? f.toProduce ?? 0) > 0) ??
    fgLines.find((f) => !f.note) ??
    null;
  const readiness = await evaluateWoPrepareReadiness(
    salesOrderId,
    {
      fgLines,
      planQtyByLineId: input.planQtyByLineId ?? {},
      workOrderId,
    },
    db,
  );

  if (!readiness.canRaiseRequirement) {
    const err = new Error(
      readiness.hasMissingBom
        ? "Cannot raise material requirement: approved BOM missing for one or more FG items."
        : "Cannot raise material requirement: child BOM missing for one or more SFG components.",
    );
    err.statusCode = 400;
    throw err;
  }

  const shortageLines = readiness.rmSummary.filter((r) => r.shortageQty > 0);
  if (!shortageLines.length) {
    const err = new Error("No RM shortage for the current plan quantities.");
    err.statusCode = 400;
    throw err;
  }

  // If the previous requisition was intentionally CLOSED/CANCELLED, require explicit confirmation
  // before creating a new one for the same WO/SO shortage loop.
  const existingTerminal = await db.materialRequirement.findFirst({
    where: {
      salesOrderId,
      sourceType: WO_PLANNING_SOURCE,
      status: { in: ["CLOSED", "CANCELLED"] },
      ...(workOrderId != null ? { OR: [{ workOrderId }, { workOrderId: null }] } : { workOrderId: null }),
    },
    orderBy: { closedAt: "desc" },
    select: { id: true, docNo: true, status: true, closedAt: true },
  });
  if (existingTerminal && !input.confirmReopenClosed) {
    const err = new Error(
      `Previous RM Requisition ${existingTerminal.docNo || existingTerminal.id} was ${existingTerminal.status}. ` +
        "Reopen / raise a new requisition only with explicit confirmation.",
    );
    err.statusCode = 409;
    err.code = "REOPEN_CONFIRM_REQUIRED";
    err.existingMaterialRequirement = existingTerminal;
    throw err;
  }

  const existing = await findReusableWoPlanningMaterialRequirement({
    salesOrderId,
    workOrderId,
    fgItemId: primaryFgLine?.fgItemId ?? null,
    plannedProductionQty: Number(primaryFgLine?.plannedProductionQty ?? 0),
    shortageLines,
  }, db);

  const lineRows = shortageLines.map((r) => ({
    rmItemId: r.rmItemId,
    requiredQty: r.requiredQty,
    shortageQty: r.shortageQty,
    availableQtySnapshot: r.availableQty,
    unitSnapshot: r.unit,
  }));

  return db.$transaction(async (tx) => {
    const approvedAt = new Date();
    const approvedByUserId = input.createdByUserId ?? null;
    let header;
    if (existing) {
      header = await tx.materialRequirement.findUnique({ where: { id: existing.id } });
      await tx.materialRequirementLine.deleteMany({ where: { materialRequirementId: existing.id } });
      await tx.materialRequirementLine.createMany({
        data: lineRows.map((row) => ({
          materialRequirementId: existing.id,
          ...row,
        })),
      });
      await tx.materialRequirement.update({
        where: { id: existing.id },
        data: {
          status: "APPROVED",
          approvedAt,
          approvedByUserId,
          ...(workOrderId != null ? { workOrderId } : {}),
          ...(primaryFgLine?.fgItemId ? { fgItemId: primaryFgLine.fgItemId } : {}),
          ...(primaryFgLine?.plannedProductionQty != null
            ? { plannedProductionQty: primaryFgLine.plannedProductionQty }
            : {}),
          updatedAt: new Date(),
          ...(input.createdByUserId
            ? { createdByUserId: input.createdByUserId, raisedByUserId: input.createdByUserId }
            : {}),
        },
      });
    } else {
      const docNo = await allocateDocNo(tx, {
        docType: DocType.MATERIAL_REQUIREMENT,
        date: new Date(),
      });
      header = await tx.materialRequirement.create({
        data: {
          docNo,
          status: "APPROVED",
          sourceType: WO_PLANNING_SOURCE,
          salesOrderId,
          workOrderId,
          fgItemId: primaryFgLine?.fgItemId ?? null,
          plannedProductionQty: primaryFgLine?.plannedProductionQty ?? null,
          quotationId: null,
          createdByUserId: input.createdByUserId ?? null,
          raisedByUserId: input.createdByUserId ?? null,
          approvedAt,
          approvedByUserId,
          requisitionRemarks: workOrderId
            ? `Raised from Prepare Work Order (WO #${workOrderId})`
            : "Raised from Prepare Work Order",
          remarks: workOrderId
            ? `Raised from Prepare Work Order (WO #${workOrderId})`
            : "Raised from Prepare Work Order",
        },
      });
      await tx.materialRequirementLine.createMany({
        data: lineRows.map((row) => ({
          materialRequirementId: header.id,
          ...row,
        })),
      });
    }

    const full = await tx.materialRequirement.findUnique({
      where: { id: header.id },
      include: {
        lines: { include: { rmItem: { select: { id: true, itemName: true, unit: true } } } },
      },
    });

    return {
      materialRequirement: full,
      reused: Boolean(existing),
      readiness,
    };
  });
}

async function createMaterialRequirementDraft(
  { quotationId, salesOrderId, createdByUserId },
  db = prisma,
) {
  const preview = await buildMaterialPlanningPreview({ quotationId, salesOrderId }, db);
  if (!preview.canRaiseRequirement) {
    const err = new Error(
      preview.hasMissingBom
        ? "Cannot raise material requirement: approved BOM missing for one or more FG items."
        : "Cannot raise material requirement: child BOM missing for one or more SFG components.",
    );
    err.statusCode = 400;
    throw err;
  }

  const shortageLines = preview.rmSummary.filter((r) => r.shortageQty > 0);
  const linesToPersist =
    shortageLines.length > 0 ? shortageLines : preview.rmSummary.filter((r) => r.requiredQty > 0);

  if (!linesToPersist.length) {
    const err = new Error("No RM requirement lines to save.");
    err.statusCode = 400;
    throw err;
  }

  return db.$transaction(async (tx) => {
    const docNo = await allocateDocNo(tx, {
      docType: DocType.MATERIAL_REQUIREMENT,
      date: new Date(),
    });
    const header = await tx.materialRequirement.create({
      data: {
        docNo,
        status: "PENDING_APPROVAL",
        sourceType: preview.sourceType,
        quotationId: preview.quotationId,
        salesOrderId: preview.salesOrderId,
        createdByUserId: createdByUserId ?? null,
        raisedByUserId: createdByUserId ?? null,
        requisitionRemarks: "Raised from RM planning",
      },
    });
    await tx.materialRequirementLine.createMany({
      data: linesToPersist.map((r) => ({
        materialRequirementId: header.id,
        rmItemId: r.rmItemId,
        requiredQty: r.requiredQty,
        shortageQty: r.shortageQty,
        availableQtySnapshot: r.availableQty,
        unitSnapshot: r.unit,
      })),
    });
    const full = await tx.materialRequirement.findUnique({
      where: { id: header.id },
      include: {
        lines: { include: { rmItem: { select: { id: true, itemName: true, unit: true } } } },
      },
    });
    return {
      materialRequirement: full,
      preview,
    };
  });
}

async function listMaterialPlanningSources(db = prisma) {
  const [quotations, salesOrders] = await Promise.all([
    db.quotation.findMany({
      where: { workflowStatus: "APPROVED", flowTypeSnapshot: "REGULAR" },
      orderBy: { id: "desc" },
      select: {
        id: true,
        quotationNo: true,
        enquiry: { select: { customer: { select: { id: true, name: true } } } },
        salesOrder: { select: { id: true, docNo: true } },
      },
      take: 200,
    }),
    db.salesOrder.findMany({
      where: { orderType: { in: ["NORMAL", "REPLACEMENT"] } },
      orderBy: { id: "desc" },
      select: {
        id: true,
        docNo: true,
        internalStatus: true,
        customer: { select: { id: true, name: true } },
        quotation: { select: { id: true, quotationNo: true } },
      },
      take: 200,
    }),
  ]);

  return {
    quotations: quotations.map((q) => ({
      id: q.id,
      docNo: q.quotationNo,
      customerName: customerDisplayName(q.enquiry?.customer),
      hasSalesOrder: !!q.salesOrder,
      salesOrderId: q.salesOrder?.id ?? null,
      salesOrderNo: q.salesOrder?.docNo ?? null,
    })),
    salesOrders: salesOrders.map((s) => ({
      id: s.id,
      docNo: s.docNo,
      customerName: customerDisplayName(s.customer),
      internalStatus: s.internalStatus,
      quotationId: s.quotation?.id ?? null,
      quotationNo: s.quotation?.quotationNo ?? null,
    })),
  };
}

module.exports = {
  buildMaterialPlanningPreview,
  buildMaterialReadinessForFgDemand,
  fgLinesFromSalesOrder,
  evaluateWoPrepareReadiness,
  resolveWoPrepareBlockReason,
  findPendingWoPlanningMaterialRequirements,
  createMaterialRequirementFromWoPlanning,
  createMaterialRequirementDraft,
  loadQuotationContext,
  loadSalesOrderContext,
  listMaterialPlanningSources,
  rmLineStatus,
  buildRmSummaryLineFromAvailability,
  materialPlanningOperationalState,
  isSalesOrderCompleted,
  WO_PLANNING_SOURCE,
};
