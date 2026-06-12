const { prisma } = require("../utils/prisma");
const { DocType } = require("../prismaClientPackage");
const { allocateDocNo } = require("./docNoService");
const { qtyToNumber } = require("./rmPurchaseHelpers");
const { aggregateRmDemandForFgLines, round3 } = require("./bomExplosionService");
const { getMaterialAvailabilityByItems } = require("./materialAvailabilityService");
const { RM_REQUISITION_ACTIVE_STATUSES } = require("./rmRequisitionLifecycle");
const { assertWorkOrderProcurementDemandAllowed } = require("./procurementPipelineFirewall");
const {
  REGULAR_SO_PROCUREMENT_SOURCE,
  regularSoProcurementSourceTypes,
} = require("./regularSoProcurementSource");

/** Legacy WO-anchored MR source (read-only compatibility). */
const WO_PLANNING_SOURCE = "WORK_ORDER_PLANNING";
const EPS = 1e-6;

function n(v) {
  return qtyToNumber(v);
}

function round3Qty(v) {
  return Math.round((Number(v) || 0) * 1000) / 1000;
}

function isShortRmLine(line) {
  return line.netShortageAfterIncomingQty > EPS || line.shortageAfterReservationQty > EPS;
}

function shortageQtyForMrLine(line) {
  const qty = n(line.netShortageAfterIncomingQty) || n(line.shortageAfterReservationQty);
  return round3Qty(qty);
}

function mapMrHeader(materialRequirement) {
  const lines = materialRequirement?.lines || [];
  return {
    id: materialRequirement.id,
    docNo: materialRequirement.docNo,
    sourceType: materialRequirement.sourceType,
    status: materialRequirement.status,
    workOrderId: materialRequirement.workOrderId,
    salesOrderId: materialRequirement.salesOrderId,
    lineCount: lines.length,
    lines: lines.map((ln) => ({
      id: ln.id,
      rmItemId: ln.rmItemId,
      requiredQty: n(ln.requiredQty),
      shortageQty: n(ln.shortageQty),
    })),
  };
}

async function loadWoRmShortageCandidates(db, workOrderId, deps = {}) {
  const aggregateRmDemand = deps.aggregateRmDemandForFgLines || aggregateRmDemandForFgLines;
  const getAvailability = deps.getMaterialAvailabilityByItems || getMaterialAvailabilityByItems;

  await assertWorkOrderProcurementDemandAllowed(db, workOrderId);

  const workOrder = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      docNo: true,
      salesOrderId: true,
      lines: {
        select: {
          fgItemId: true,
          qty: true,
          plannedQty: true,
        },
      },
    },
  });
  if (!workOrder) {
    const err = new Error("Work order not found.");
    err.statusCode = 404;
    throw err;
  }

  const fgLines = (workOrder.lines || []).map((line) => ({
    fgItemId: line.fgItemId,
    fgQty: n(line.plannedQty) > EPS ? n(line.plannedQty) : n(line.qty),
    bomMissing: false,
  }));
  const demand = await aggregateRmDemand(db, fgLines);
  const requiredQtyByItemId = new Map();
  for (const [rmItemId, qty] of demand.rmNeeded || []) {
    requiredQtyByItemId.set(rmItemId, round3Qty(qty));
  }

  const availability = await getAvailability({
    db,
    itemIds: [...requiredQtyByItemId.keys()],
    requiredQtyByItemId,
  });

  return availability
    .map((line) => ({
      rmItemId: line.itemId,
      requiredQty: n(line.requiredQty),
      freeStockQty: round3Qty(Math.max(0, n(line.freeStockQty))),
      shortageAfterReservationQty: n(line.shortageAfterReservationQty),
      netShortageAfterIncomingQty: n(line.netShortageAfterIncomingQty),
    }))
    .filter(isShortRmLine)
    .map((line) => ({
      ...line,
      shortageQty: shortageQtyForMrLine(line),
    }))
    .filter((line) => line.shortageQty > EPS);
}

async function findOpenSoProcurementMr(tx, salesOrderId) {
  if (!salesOrderId) return null;
  return tx.materialRequirement.findFirst({
    where: {
      salesOrderId,
      sourceType: { in: regularSoProcurementSourceTypes() },
      status: { in: RM_REQUISITION_ACTIVE_STATUSES },
    },
    include: { lines: true },
    orderBy: { id: "desc" },
  });
}

async function findLatestTerminalSoProcurementMr(tx, salesOrderId) {
  if (!salesOrderId) return null;
  return tx.materialRequirement.findFirst({
    where: {
      salesOrderId,
      sourceType: { in: regularSoProcurementSourceTypes() },
      status: { in: ["CLOSED", "CANCELLED"] },
    },
    orderBy: [{ closedAt: "desc" }, { id: "desc" }],
    select: { id: true, docNo: true, status: true, closedAt: true },
  });
}

async function addShortageLineToMr(tx, { materialRequirement, rmItemId, shortageQty, freeStockQty, item }) {
  if ((materialRequirement.lines || []).some((line) => line.rmItemId === rmItemId)) {
    return { lineCreated: false, materialRequirement };
  }
  await tx.materialRequirementLine.create({
    data: {
      materialRequirementId: materialRequirement.id,
      rmItemId,
      requiredQty: String(shortageQty),
      shortageQty: String(shortageQty),
      availableQtySnapshot: String(freeStockQty),
      unitSnapshot: item.unit || null,
    },
  });
  const refreshed = await tx.materialRequirement.findUnique({
    where: { id: materialRequirement.id },
    include: { lines: true },
  });
  return { lineCreated: true, materialRequirement: refreshed };
}

async function ensureSoProcurementMrHeader(tx, { workOrder, actor, remarks, firstLine }) {
  let materialRequirement = await findOpenSoProcurementMr(tx, workOrder.salesOrderId);
  if (materialRequirement) {
    if (workOrder.id && materialRequirement.workOrderId !== workOrder.id) {
      materialRequirement = await tx.materialRequirement.update({
        where: { id: materialRequirement.id },
        data: { workOrderId: workOrder.id },
        include: { lines: true },
      });
    }
    return { materialRequirement, created: false };
  }

  const terminal = await findLatestTerminalSoProcurementMr(tx, workOrder.salesOrderId);
  if (terminal && !actor?.confirmReopenClosed) {
    const err = new Error(
      `Previous RM Requisition ${terminal.docNo || terminal.id} was ${terminal.status}. ` +
        "Reopen / raise a new requisition only with explicit confirmation.",
    );
    err.statusCode = 409;
    err.code = "REOPEN_CONFIRM_REQUIRED";
    err.existingMaterialRequirement = terminal;
    throw err;
  }

  const docNo = await allocateDocNo(tx, { docType: DocType.MATERIAL_REQUIREMENT, date: new Date() });
  const now = new Date();
  // RM Control Center is the Store's operational escalation step: raising the WO shortage
  // requisition IS the Store approval. Create it purchase-visible (APPROVED) so the
  // Procurement Workspace shows it immediately. PENDING_APPROVAL would stay invisible to
  // Purchase (RM_REQUISITION_PURCHASE_VISIBLE_STATUSES excludes it), breaking the handoff.
  materialRequirement = await tx.materialRequirement.create({
    data: {
      docNo,
      status: "APPROVED",
      approvedByUserId: actor.userId ?? null,
      approvedAt: now,
      approvalRemarks: "Store-approved on RM requirement raise (RM Control Center).",
      sourceType: REGULAR_SO_PROCUREMENT_SOURCE,
      salesOrderId: workOrder.salesOrderId ?? null,
      workOrderId: workOrder.id,
      quotationId: null,
      createdByUserId: actor.userId ?? null,
      raisedByUserId: actor.userId ?? null,
      requisitionRemarks:
        remarks?.trim() ||
        `Production shortage from RM Control Center for ${workOrder.docNo || `WO-${workOrder.id}`}.`,
      remarks:
        remarks?.trim() ||
        `Production shortage from RM Control Center for ${workOrder.docNo || `WO-${workOrder.id}`}.`,
      lines: {
        create: [
          {
            rmItemId: firstLine.rmItemId,
            requiredQty: String(firstLine.shortageQty),
            shortageQty: String(firstLine.shortageQty),
            availableQtySnapshot: String(firstLine.freeStockQty),
            unitSnapshot: firstLine.unit || null,
          },
        ],
      },
    },
    include: { lines: true },
  });
  return { materialRequirement, created: true };
}

async function createOrReuseProductionShortageMr(input, actor = {}, db = prisma) {
  const workOrderId = Number(input.workOrderId);
  const rmItemId = Number(input.rmItemId);
  const shortageQty = round3Qty(n(input.shortageQty));
  const freeStockQty = round3Qty(Math.max(0, n(input.freeStockQty)));

  if (!Number.isFinite(workOrderId) || workOrderId <= 0) {
    const err = new Error("workOrderId is required.");
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isFinite(rmItemId) || rmItemId <= 0) {
    const err = new Error("rmItemId is required.");
    err.statusCode = 400;
    throw err;
  }
  if (shortageQty <= EPS) {
    const err = new Error("shortageQty must be greater than zero.");
    err.statusCode = 400;
    throw err;
  }

  return db.$transaction(async (tx) => {
    await assertWorkOrderProcurementDemandAllowed(tx, workOrderId);

    const [workOrder, item] = await Promise.all([
      tx.workOrder.findUnique({
        where: { id: workOrderId },
        select: { id: true, docNo: true, salesOrderId: true },
      }),
      tx.item.findUnique({
        where: { id: rmItemId },
        select: { id: true, itemName: true, itemType: true, unit: true },
      }),
    ]);
    if (!workOrder) {
      const err = new Error("Work order not found.");
      err.statusCode = 404;
      throw err;
    }
    if (!item || item.itemType !== "RM") {
      const err = new Error("Only RM items can be added to a production shortage MR.");
      err.statusCode = 400;
      throw err;
    }

    let materialRequirement = await findOpenSoProcurementMr(tx, workOrder.salesOrderId);
    let created = false;
    let lineCreated = false;

    if (!materialRequirement) {
      const ensured = await ensureSoProcurementMrHeader(tx, {
        workOrder,
        actor: { ...actor, confirmReopenClosed: Boolean(input.confirmReopenClosed) },
        remarks: input.remarks,
        firstLine: { rmItemId, shortageQty, freeStockQty, unit: item.unit },
      });
      materialRequirement = ensured.materialRequirement;
      created = true;
      lineCreated = true;
    } else {
      const added = await addShortageLineToMr(tx, {
        materialRequirement,
        rmItemId,
        shortageQty,
        freeStockQty,
        item,
      });
      materialRequirement = added.materialRequirement;
      lineCreated = added.lineCreated;
    }

    const line = (materialRequirement.lines || []).find((row) => row.rmItemId === rmItemId) || null;
    const woCaseAlreadyActive = !created;
    const additionalLineAdded = lineCreated && woCaseAlreadyActive;
    return {
      materialRequirement: mapMrHeader(materialRequirement),
      line: line
        ? {
            id: line.id,
            rmItemId: line.rmItemId,
            requiredQty: n(line.requiredQty),
            shortageQty: n(line.shortageQty),
          }
        : null,
      created,
      lineCreated,
      escalation: {
        woCaseAlreadyActive,
        additionalLineAdded,
        procurementInitiated: true,
      },
    };
  });
}

async function bulkAddProductionShortageMrLines(input, actor = {}, db = prisma) {
  const workOrderId = Number(input.workOrderId);
  if (!Number.isFinite(workOrderId) || workOrderId <= 0) {
    const err = new Error("workOrderId is required.");
    err.statusCode = 400;
    throw err;
  }

  await assertWorkOrderProcurementDemandAllowed(db, workOrderId);

  const candidates = await loadWoRmShortageCandidates(db, workOrderId, input.deps);
  if (!candidates.length) {
    const err = new Error("No RM shortage lines detected for this work order.");
    err.statusCode = 400;
    throw err;
  }

  return db.$transaction(async (tx) => {
    const workOrder = await tx.workOrder.findUnique({
      where: { id: workOrderId },
      select: { id: true, docNo: true, salesOrderId: true },
    });
    if (!workOrder) {
      const err = new Error("Work order not found.");
      err.statusCode = 404;
      throw err;
    }

    let materialRequirement = await findOpenSoProcurementMr(tx, workOrder.salesOrderId);
    const onCase = new Set((materialRequirement?.lines || []).map((ln) => ln.rmItemId));
    const toAdd = candidates.filter((c) => !onCase.has(c.rmItemId));

    if (!toAdd.length) {
      const header = materialRequirement ? mapMrHeader(materialRequirement) : null;
      return {
        status: "ALREADY_UP_TO_DATE",
        message: "All shortage lines already on WO case",
        materialRequirement: header,
        caseSummary: {
          workOrderId,
          detectedShortLineCount: candidates.length,
          linesAdded: 0,
          linesSkippedDuplicate: candidates.length,
          linesOnCaseAfter: onCase.size,
        },
        created: false,
        linesAdded: 0,
        escalation: {
          woCaseAlreadyActive: Boolean(materialRequirement),
          additionalLineAdded: false,
          procurementInitiated: Boolean(materialRequirement),
        },
      };
    }

    const rmIds = [...new Set(toAdd.map((c) => c.rmItemId))];
    const items = await tx.item.findMany({
      where: { id: { in: rmIds } },
      select: { id: true, itemName: true, itemType: true, unit: true },
    });
    const itemById = new Map(items.map((row) => [row.id, row]));

    let created = false;
    let linesAdded = 0;
    const addedLines = [];
    const skippedInvalid = [];

    for (const candidate of toAdd) {
      const item = itemById.get(candidate.rmItemId);
      if (!item || item.itemType !== "RM") {
        skippedInvalid.push(candidate.rmItemId);
        continue;
      }

      if (!materialRequirement) {
        const ensured = await ensureSoProcurementMrHeader(tx, {
          workOrder,
          actor: { ...actor, confirmReopenClosed: Boolean(input.confirmReopenClosed) },
          remarks: input.remarks,
          firstLine: {
            rmItemId: candidate.rmItemId,
            shortageQty: candidate.shortageQty,
            freeStockQty: candidate.freeStockQty,
            unit: item.unit,
          },
        });
        materialRequirement = ensured.materialRequirement;
        created = ensured.created;
        linesAdded += 1;
        addedLines.push({
          rmItemId: candidate.rmItemId,
          shortageQty: candidate.shortageQty,
          lineCreated: true,
        });
        continue;
      }

      const added = await addShortageLineToMr(tx, {
        materialRequirement,
        rmItemId: candidate.rmItemId,
        shortageQty: candidate.shortageQty,
        freeStockQty: candidate.freeStockQty,
        item,
      });
      materialRequirement = added.materialRequirement;
      if (added.lineCreated) {
        linesAdded += 1;
        addedLines.push({
          rmItemId: candidate.rmItemId,
          shortageQty: candidate.shortageQty,
          lineCreated: true,
        });
      }
    }

    if (!materialRequirement) {
      const err = new Error("No RM lines could be added to the WO shortage case.");
      err.statusCode = 400;
      throw err;
    }

    const woCaseAlreadyActive = !created;
    return {
      status: linesAdded > 0 ? (created ? "CASE_CREATED" : "LINES_ADDED") : "ALREADY_UP_TO_DATE",
      message:
        linesAdded > 0
          ? created
            ? `Procurement case created with ${linesAdded} shortage line(s).`
            : `${linesAdded} shortage line(s) added to existing WO case.`
          : "All shortage lines already on WO case",
      materialRequirement: mapMrHeader(materialRequirement),
      caseSummary: {
        workOrderId,
        detectedShortLineCount: candidates.length,
        linesAdded,
        linesSkippedDuplicate: candidates.length - toAdd.length,
        linesSkippedInvalid: skippedInvalid.length,
        linesOnCaseAfter: (materialRequirement.lines || []).length,
        addedRmItemIds: addedLines.map((l) => l.rmItemId),
      },
      created,
      linesAdded,
      addedLines,
      escalation: {
        woCaseAlreadyActive,
        additionalLineAdded: linesAdded > 0 && woCaseAlreadyActive,
        procurementInitiated: true,
      },
    };
  });
}

module.exports = {
  WO_PLANNING_SOURCE,
  REGULAR_SO_PROCUREMENT_SOURCE,
  EPS,
  isShortRmLine,
  shortageQtyForMrLine,
  loadWoRmShortageCandidates,
  createOrReuseProductionShortageMr,
  bulkAddProductionShortageMrLines,
};
