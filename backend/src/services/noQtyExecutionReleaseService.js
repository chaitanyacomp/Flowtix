/**
 * NO_QTY RS execution Work Order helpers.
 *
 * Monthly Plan Release creates procurement MR only. Store/manual WO placement
 * uses the remaining RS balance and can create multiple WOs per Requirement Sheet.
 */

const { DocType } = require("../prismaClientPackage");
const { allocateDocNo } = require("./docNoService");
const { aggregateRmDemandForFgLines, loadApprovedBomWithLines } = require("./bomExplosionService");
const { getMaterialAvailabilityByItems } = require("./materialAvailabilityService");
const { resolveNoQtyWoExecutableQty } = require("./noQtyWoQtyService");
const { roundFgQty, capFgQtyFromRmAvailability } = require("./itemQtyPrecision");
const {
  getExistingProductionMaterialRequestForWorkOrder,
} = require("./productionMaterialRequestService");

const NO_QTY_WO_PLACED_COUNT_STATUSES = Object.freeze([
  "PENDING",
  "IN_PROGRESS",
  "HOLD",
  "PAUSED",
  "COMPLETED",
  "CLOSED_WITH_SHORTFALL",
]);
const EPS = 1e-6;

function n(v) {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function isNoQtyWoPlacedStatusCounted(status) {
  return NO_QTY_WO_PLACED_COUNT_STATUSES.includes(String(status ?? ""));
}

function woLinePlacedQty(line) {
  return round3(n(line?.plannedQty ?? line?.qty));
}

async function loadFgItemUnitById(tx, itemId) {
  const id = Number(itemId);
  if (!(id > 0) || typeof tx?.item?.findFirst !== "function") return null;
  const row = await tx.item.findFirst({
    where: { id },
    select: {
      unit: true,
      unitRef: { select: { unitCode: true, unitName: true } },
    },
  });
  if (!row) return null;
  return row.unitRef?.unitCode ?? row.unitRef?.unitName ?? row.unit ?? null;
}

async function loadFgItemUnitMap(tx, itemIds) {
  const ids = [...new Set((itemIds ?? []).map((id) => Number(id)).filter((id) => id > 0))];
  const out = new Map();
  if (!ids.length || typeof tx?.item?.findMany !== "function") return out;
  const rows = await tx.item.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      unit: true,
      unitRef: { select: { unitCode: true, unitName: true } },
    },
  });
  for (const row of rows) {
    out.set(Number(row.id), row.unitRef?.unitCode ?? row.unitRef?.unitName ?? row.unit ?? null);
  }
  return out;
}

function sumPlacedQtyByItem(workOrders) {
  const out = new Map();
  for (const wo of workOrders ?? []) {
    if (!isNoQtyWoPlacedStatusCounted(wo.status)) continue;
    for (const line of wo.lines ?? []) {
      const itemId = Number(line.fgItemId);
      if (!(itemId > 0)) continue;
      out.set(itemId, round3((out.get(itemId) ?? 0) + woLinePlacedQty(line)));
    }
  }
  return out;
}

function normalizeRequestedPlacementLines(requestedLines, balanceLines) {
  const hasExplicitRequest = Array.isArray(requestedLines);
  if (!hasExplicitRequest) {
    return (balanceLines ?? [])
      .map((line) => ({
        itemId: Number(line.itemId ?? line.fgItemId),
        fgItemId: Number(line.itemId ?? line.fgItemId),
        qty: round3(n(line.rsBalanceQty ?? line.qty)),
      }))
      .filter((line) => line.qty > 0);
  }

  const merged = new Map();
  const order = [];
  for (const raw of requestedLines ?? []) {
    const itemId = Number(raw?.itemId ?? raw?.fgItemId);
    const qty = round3(n(raw?.qty ?? raw?.plannedQty ?? raw?.requirementQty ?? raw?.plannedQtySnapshot));
    if (!Number.isFinite(itemId) || itemId <= 0) continue;
    if (!order.includes(itemId)) order.push(itemId);
    merged.set(itemId, round3((merged.get(itemId) ?? 0) + qty));
  }
  return order.map((itemId) => ({ itemId, fgItemId: itemId, qty: round3(merged.get(itemId) ?? 0) }));
}

async function buildNoQtyPlacementLinePreview(tx, balanceLine) {
  const fgUnit = await loadFgItemUnitById(tx, balanceLine?.itemId);
  const rsBalanceQty = roundFgQty(n(balanceLine?.rsBalanceQty), fgUnit, { mode: "floor" });
  if (!(rsBalanceQty > 0)) {
    return {
      itemId: Number(balanceLine?.itemId),
      itemName: balanceLine?.itemName ?? `Item ${balanceLine?.itemId}`,
      rsDemandQty: round3(n(balanceLine?.rsDemandQty)),
      woPlacedQty: round3(n(balanceLine?.woPlacedQty)),
      rsBalanceQty,
      suggestedExecutableQty: 0,
      status: "ZERO_BALANCE",
      reason: "No RS balance remains for this FG line.",
      rmLines: [],
    };
  }

  if (
    typeof tx?.bom?.findFirst !== "function" ||
    typeof tx?.stockTransaction?.groupBy !== "function" ||
    typeof tx?.item?.findMany !== "function" ||
    typeof tx?.productionMaterialRequestLine?.findMany !== "function" ||
    typeof tx?.rmPurchaseOrder?.findMany !== "function"
  ) {
    return {
      itemId: Number(balanceLine.itemId),
      itemName: balanceLine.itemName ?? `Item ${balanceLine.itemId}`,
      rsDemandQty: round3(n(balanceLine.rsDemandQty)),
      woPlacedQty: round3(n(balanceLine.woPlacedQty)),
      rsBalanceQty,
      suggestedExecutableQty: 0,
      status: "MISSING_BOM",
      reason: "RM preview is unavailable in this context.",
      rmLines: [],
    };
  }

  const bom = await loadApprovedBomWithLines(tx, balanceLine.itemId);
  if (!bom?.lines?.length) {
    return {
      itemId: Number(balanceLine.itemId),
      itemName: balanceLine.itemName ?? `Item ${balanceLine.itemId}`,
      rsDemandQty: round3(n(balanceLine.rsDemandQty)),
      woPlacedQty: round3(n(balanceLine.woPlacedQty)),
      rsBalanceQty,
      suggestedExecutableQty: 0,
      status: "MISSING_BOM",
      reason: "Approved BOM is missing for this FG line.",
      rmLines: [],
    };
  }

  const explosion = await aggregateRmDemandForFgLines(tx, [
    { fgItemId: balanceLine.itemId, fgQty: 1, bomMissing: false },
  ]);
  const rmNeeded = explosion?.rmNeeded instanceof Map ? explosion.rmNeeded : new Map();
  if ((explosion?.missingChildBoms ?? []).length > 0) {
    return {
      itemId: Number(balanceLine.itemId),
      itemName: balanceLine.itemName ?? `Item ${balanceLine.itemId}`,
      rsDemandQty: round3(n(balanceLine.rsDemandQty)),
      woPlacedQty: round3(n(balanceLine.woPlacedQty)),
      rsBalanceQty,
      suggestedExecutableQty: 0,
      status: "MISSING_BOM",
      reason: "Approved BOM is incomplete for this FG line.",
      rmLines: [],
    };
  }

  if (!rmNeeded.size) {
    return {
      itemId: Number(balanceLine.itemId),
      itemName: balanceLine.itemName ?? `Item ${balanceLine.itemId}`,
      rsDemandQty: round3(n(balanceLine.rsDemandQty)),
      woPlacedQty: round3(n(balanceLine.woPlacedQty)),
      rsBalanceQty,
      suggestedExecutableQty: rsBalanceQty,
      status: "READY",
      reason: "No RM consumption was found for this FG line.",
      rmLines: [],
    };
  }

  const availabilityRows = await getMaterialAvailabilityByItems({
    db: tx,
    itemIds: [...rmNeeded.keys()],
    requiredQtyByItemId: rmNeeded,
    includeIncoming: true,
    includeIssued: false,
  });

  let executableQty = rsBalanceQty;
  let hasAvailableStock = false;
  let hasIncomingStock = false;

  const rmLines = (availabilityRows ?? []).map((row) => {
    const requiredPerFg = round3(n(rmNeeded.get(Number(row.itemId))));
    const availableQty = round3(n(row.freeStockQty ?? row.physicalUsableStockQty));
    const incomingQty = round3(n(row.incomingQty));
    const shortageQty = round3(Math.max(0, requiredPerFg - availableQty));
    if (availableQty > EPS) hasAvailableStock = true;
    if (incomingQty > EPS) hasIncomingStock = true;
    if (requiredPerFg > EPS) {
      const cap = capFgQtyFromRmAvailability(availableQty, requiredPerFg, fgUnit);
      executableQty = Math.min(executableQty, cap);
    }
    return {
      rmItemId: Number(row.itemId),
      rmItemName: row.itemName ?? `Item ${row.itemId}`,
      requiredQty: requiredPerFg,
      availableQty,
      shortageQty,
      incomingQty,
      status:
        shortageQty <= EPS ? "READY" : availableQty > EPS || incomingQty > EPS ? "PARTIALLY_READY" : "AWAITING_PROCUREMENT",
    };
  });

  executableQty = roundFgQty(Math.max(0, Math.min(rsBalanceQty, executableQty)), fgUnit, { mode: "floor" });
  let status = "READY";
  let reason = "All required RM is available for this FG line.";
  if (executableQty <= EPS) {
    status = hasIncomingStock && !hasAvailableStock ? "PARTIALLY_READY" : "AWAITING_PROCUREMENT";
    reason =
      status === "PARTIALLY_READY"
        ? "RM is still incoming, but no physical RM is available for placement yet."
        : "Required RM is not available yet.";
  } else if (executableQty + EPS < rsBalanceQty) {
    status = "PARTIALLY_READY";
    reason = "Some RM shortages remain for this FG line.";
  }

  return {
    itemId: Number(balanceLine.itemId),
    itemName: balanceLine.itemName ?? `Item ${balanceLine.itemId}`,
    rsDemandQty: round3(n(balanceLine.rsDemandQty)),
    woPlacedQty: round3(n(balanceLine.woPlacedQty)),
    rsBalanceQty,
    suggestedExecutableQty: executableQty,
    status,
    reason,
    rmLines,
  };
}

async function buildNoQtyWoBatchPlacementPreview(tx, sheet) {
  const linkedWorkOrders = await tx.workOrder.findMany({
    where: { requirementSheetId: sheet.id },
    select: {
      id: true,
      cycleId: true,
      status: true,
      lines: { select: { fgItemId: true, qty: true, plannedQty: true } },
    },
  });
  const placedByItem = sumPlacedQtyByItem(linkedWorkOrders);
  const balanceLines = (sheet.lines || [])
    .map((ln) => {
      const itemId = Number(ln.itemId);
      const rsDemandQty = round3(n(ln.requirementQty));
      const woPlacedQty = round3(placedByItem.get(itemId) ?? 0);
      const rsBalanceQty = round3(Math.max(0, rsDemandQty - woPlacedQty));
      return {
        itemId,
        itemName: ln.item?.itemName ?? `Item ${itemId}`,
        rsDemandQty,
        woPlacedQty,
        rsBalanceQty,
      };
    })
    .filter((line) => Number.isFinite(line.itemId) && line.itemId > 0);

  const lines = [];
  for (const line of balanceLines) {
    lines.push(await buildNoQtyPlacementLinePreview(tx, line));
  }

  const positiveLines = lines.filter((line) => line.rsBalanceQty > EPS);
  const executableLines = positiveLines.filter((line) => line.suggestedExecutableQty > EPS);
  const summary = {
    totalRsDemandQty: round3(balanceLines.reduce((sum, line) => sum + line.rsDemandQty, 0)),
    totalWoPlacedQty: round3(balanceLines.reduce((sum, line) => sum + line.woPlacedQty, 0)),
    totalRsBalanceQty: round3(balanceLines.reduce((sum, line) => sum + line.rsBalanceQty, 0)),
    totalExecutableQty: round3(lines.reduce((sum, line) => sum + line.suggestedExecutableQty, 0)),
  };

  let status = "ZERO_BALANCE";
  let reason = "No RS balance remains.";
  if (positiveLines.length > 0) {
    const anyMissingBom = positiveLines.some((line) => line.status === "MISSING_BOM");
    const anyAwaiting = positiveLines.some((line) => line.status === "AWAITING_PROCUREMENT");
    const allReady = positiveLines.every((line) => line.status === "READY" && line.suggestedExecutableQty + EPS >= line.rsBalanceQty);
    if (allReady) {
      status = "READY";
      reason = "All remaining FG lines can be placed using current RM availability.";
    } else if (executableLines.length > 0) {
      status = "PARTIALLY_READY";
      reason = "Some FG lines can be placed now; others still need RM or BOM completion.";
    } else if (anyMissingBom) {
      status = "MISSING_BOM";
      reason = "One or more FG lines are missing approved BOM data.";
    } else if (anyAwaiting) {
      status = "AWAITING_PROCUREMENT";
      reason = "One or more FG lines are still waiting for procurement.";
    }
  }

  return {
    status,
    reason,
    canPlace: executableLines.length > 0,
    summary,
    lines,
  };
}

/**
 * Serialize WO placement for one Requirement Sheet.
 *
 * MySQL holds the row lock until the surrounding Prisma transaction commits, so
 * concurrent create-wo requests for the same RS cannot both read the same
 * pre-create balance. Unit-test mocks may omit $queryRaw; real callers use a
 * TransactionClient.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {number} requirementSheetId
 */
async function lockRequirementSheetForWoPlacement(tx, requirementSheetId) {
  const id = Number(requirementSheetId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error("Invalid requirement sheet id.");
    err.statusCode = 400;
    throw err;
  }
  if (typeof tx.$queryRaw !== "function") return;

  const rows = await tx.$queryRaw`SELECT id FROM RequirementSheet WHERE id = ${id} FOR UPDATE`;
  if (Array.isArray(rows) && rows.length === 0) {
    const err = new Error("Requirement sheet not found.");
    err.statusCode = 404;
    throw err;
  }
}

/**
 * Latest locked requirement sheet per SO+cycle for a planning period.
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {string} periodKey
 */
async function findLatestLockedSheetsForPeriod(tx, periodKey) {
  const pk = String(periodKey ?? "").trim();
  if (!pk) return [];

  const sheets = await tx.requirementSheet.findMany({
    where: { periodKey: pk, status: "LOCKED" },
    include: {
      salesOrder: { select: { id: true, orderType: true, customerReturnId: true } },
      lines: { select: { id: true, itemId: true, requirementQty: true } },
    },
    orderBy: [{ salesOrderId: "asc" }, { cycleId: "asc" }, { version: "desc" }, { id: "desc" }],
  });

  const latestByKey = new Map();
  for (const sheet of sheets) {
    if (sheet.salesOrder?.orderType !== "NO_QTY") continue;
    const cycleId = sheet.cycleId != null ? Number(sheet.cycleId) : 0;
    const key = `${sheet.salesOrderId}:${cycleId}`;
    if (!latestByKey.has(key)) latestByKey.set(key, sheet);
  }
  return [...latestByKey.values()];
}

/**
 * Balance-capped WO creation from a locked Requirement Sheet.
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 */
async function createNoQtyWorkOrderFromLockedSheet(tx, sheet, options = {}) {
  const activeCycleId = sheet.cycleId != null ? Number(sheet.cycleId) : null;
  if (!activeCycleId || !Number.isFinite(activeCycleId) || activeCycleId <= 0) {
    return { workOrderId: null, created: false, skippedReason: "NO_CYCLE" };
  }

  await lockRequirementSheetForWoPlacement(tx, sheet.id);

  const linkedWorkOrders = await tx.workOrder.findMany({
    where: { requirementSheetId: sheet.id },
    select: {
      id: true,
      cycleId: true,
      status: true,
      lines: { select: { fgItemId: true, qty: true, plannedQty: true } },
    },
  });
  for (const existing of linkedWorkOrders) {
    const woCycleId = existing.cycleId == null ? null : Number(existing.cycleId);
    if (!woCycleId || woCycleId !== activeCycleId) {
      await tx.workOrder.update({
        where: { id: existing.id },
        data: { cycleId: activeCycleId },
      });
    }
  }

  const soHead = sheet.salesOrder;
  if (soHead?.orderType === "REPLACEMENT" || soHead?.customerReturnId != null) {
    return { workOrderId: null, created: false, skippedReason: "REPLACEMENT_SO" };
  }

  const soLines = await tx.salesOrderLine.findMany({
    where: { soId: sheet.salesOrderId },
    select: { itemId: true, item: { select: { itemType: true } } },
  });
  const allowedFgItemIds = new Set((soLines || []).filter((l) => l.item?.itemType === "FG").map((l) => l.itemId));

  const placedByItem = sumPlacedQtyByItem(linkedWorkOrders);
  const fgUnitByItemId = await loadFgItemUnitMap(
    tx,
    (sheet.lines || []).map((ln) => ln.itemId),
  );
  const balanceLines = (sheet.lines || [])
    .map((ln) => {
      const demand = resolveNoQtyWoExecutableQty(ln);
      const placed = placedByItem.get(Number(ln.itemId)) ?? 0;
      const fgUnit = fgUnitByItemId.get(Number(ln.itemId)) ?? ln.item?.unit ?? null;
      const balance = roundFgQty(Math.max(0, round3(demand) - round3(placed)), fgUnit, { mode: "floor" });
      return { fgItemId: Number(ln.itemId), qty: balance, fgUnit };
    })
    .filter((x) => Number.isFinite(x.qty) && x.qty > 0);

  const requestedLines = normalizeRequestedPlacementLines(options?.requestedLines, balanceLines);
  const positiveLines = requestedLines.filter((line) => Number.isFinite(line.qty) && line.qty > EPS);

  if (!positiveLines.length) {
    return { workOrderId: null, created: false, skippedReason: "ZERO_EXECUTABLE_QTY" };
  }

  const shouldEnforceAllowedFgItemIds = Array.isArray(sheet?.salesOrder?.lines) && sheet.salesOrder.lines.length > 0;
  if (shouldEnforceAllowedFgItemIds && allowedFgItemIds.size > 0) {
    for (const l of positiveLines) {
      const fgItemId = Number(l.itemId ?? l.fgItemId);
      if (!allowedFgItemIds.has(fgItemId)) {
        const err = new Error("Requirement sheet contains an item that is not a finished good on the sales order.");
        err.statusCode = 409;
        throw err;
      }
    }
  }

  const hasRmValidationSupport =
    typeof tx?.bom?.findFirst === "function" &&
    typeof tx?.stockTransaction?.groupBy === "function" &&
    typeof tx?.item?.findMany === "function" &&
    typeof tx?.productionMaterialRequestLine?.findMany === "function" &&
    typeof tx?.rmPurchaseOrder?.findMany === "function";

  const placementUnitByItemId = await loadFgItemUnitMap(
    tx,
    positiveLines.map((line) => Number(line.itemId ?? line.fgItemId)),
  );

  if (hasRmValidationSupport) {
    const previewByItem = new Map();
    for (const line of balanceLines) {
      const sourceLine = (sheet.lines || []).find((ln) => Number(ln.itemId) === Number(line.fgItemId));
      previewByItem.set(
        line.fgItemId,
        await buildNoQtyPlacementLinePreview(
          tx,
          sourceLine
            ? {
                itemId: line.fgItemId,
                itemName: sourceLine.item?.itemName ?? `Item ${line.fgItemId}`,
                rsDemandQty: round3(n(sourceLine.requirementQty)),
                woPlacedQty: round3(n(placedByItem.get(line.fgItemId) ?? 0)),
                rsBalanceQty: line.qty,
              }
            : {
                itemId: line.fgItemId,
                itemName: `Item ${line.fgItemId}`,
                rsDemandQty: round3(line.qty),
                woPlacedQty: round3(n(placedByItem.get(line.fgItemId) ?? 0)),
                rsBalanceQty: line.qty,
              },
        ),
      );
    }

    for (const line of positiveLines) {
      const fgItemId = Number(line.itemId ?? line.fgItemId);
      const fgUnit = placementUnitByItemId.get(fgItemId) ?? null;
      const requestedQty = roundFgQty(line.qty, fgUnit, { mode: "floor" });
      const preview = previewByItem.get(fgItemId);
      const balanceLine = balanceLines.find((x) => Number(x.fgItemId) === fgItemId);
      if (!balanceLine) {
        const err = new Error("Requirement sheet line not found.");
        err.statusCode = 409;
        throw err;
      }
      const balanceCap = roundFgQty(balanceLine.qty, fgUnit, { mode: "floor" });
      if (requestedQty > balanceCap + EPS) {
        const err = new Error("RS balance changed while you were editing. Refresh and try again.");
        err.statusCode = 409;
        throw err;
      }
      if (preview?.status === "MISSING_BOM" && requestedQty > EPS) {
        const err = new Error("Approved BOM is missing for this FG line.");
        err.statusCode = 409;
        throw err;
      }
      if (
        preview &&
        requestedQty > roundFgQty(preview.suggestedExecutableQty, fgUnit, { mode: "floor" }) + EPS
      ) {
        const err = new Error("RS balance changed while you were editing. Refresh and try again.");
        err.statusCode = 409;
        throw err;
      }
    }

    const rmDemand = await aggregateRmDemandForFgLines(
      tx,
      positiveLines.map((line) => {
        const fgItemId = Number(line.itemId ?? line.fgItemId);
        const fgUnit = placementUnitByItemId.get(fgItemId) ?? null;
        return {
          fgItemId,
          fgQty: roundFgQty(line.qty, fgUnit, { mode: "floor" }),
          bomMissing: false,
        };
      }),
    );
    if ((rmDemand.missingChildBoms ?? []).length > 0) {
      const err = new Error("Approved BOM is missing for one or more FG lines.");
      err.statusCode = 409;
      throw err;
    }
    const requiredByItem = rmDemand?.rmNeeded instanceof Map ? rmDemand.rmNeeded : new Map();
    if (requiredByItem.size > 0) {
      const availabilityRows = await getMaterialAvailabilityByItems({
        db: tx,
        itemIds: [...requiredByItem.keys()],
        requiredQtyByItemId: requiredByItem,
        includeIncoming: true,
        includeIssued: false,
      });
      const shortageRows = (availabilityRows ?? []).filter((row) => {
        const requiredQty = round3(n(requiredByItem.get(Number(row.itemId))));
        const availableQty = round3(n(row.freeStockQty ?? row.physicalUsableStockQty));
        return requiredQty > availableQty + EPS;
      });
      if (shortageRows.length > 0) {
        const err = new Error("RS balance changed while you were editing. Refresh and try again.");
        err.statusCode = 409;
        throw err;
      }
    }
  }

  const createdWorkOrders = [];
  for (const line of positiveLines) {
    const fgItemId = Number(line.itemId ?? line.fgItemId);
    const fgUnit = placementUnitByItemId.get(fgItemId) ?? null;
    const qty = roundFgQty(line.qty, fgUnit, { mode: "floor" });
    if (!(qty > EPS)) continue;
    const created = await tx.workOrder.create({
      data: {
        salesOrderId: sheet.salesOrderId,
        requirementSheetId: sheet.id,
        cycleId: activeCycleId,
        status: "PENDING",
        docNo: await allocateDocNo(tx, { docType: DocType.WORK_ORDER, date: new Date() }),
        lines: {
          create: [
            {
              fgItemId,
              qty: String(qty),
              plannedQty: String(qty),
            },
          ],
        },
      },
      select: { id: true, docNo: true },
    });
    createdWorkOrders.push({
      workOrderId: created.id,
      workOrderDocNo: created.docNo ?? null,
      fgItemId,
      qty,
    });
  }

  const first = createdWorkOrders[0] ?? null;
  return {
    workOrderId: first?.workOrderId ?? null,
    workOrderDocNo: first?.workOrderDocNo ?? null,
    workOrderIds: createdWorkOrders.map((wo) => wo.workOrderId),
    workOrders: createdWorkOrders,
    created: createdWorkOrders.length > 0,
    skippedReason: null,
  };
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ periodKey: string }} input
 */
async function createWorkOrdersForPeriodRelease(tx, { periodKey }) {
  const sheets = await findLatestLockedSheetsForPeriod(tx, periodKey);
  const workOrders = [];
  for (const sheet of sheets) {
    const result = await createNoQtyWorkOrderFromLockedSheet(tx, sheet);
    const createdRows = Array.isArray(result.workOrders) && result.workOrders.length > 0
      ? result.workOrders
      : result.workOrderId
        ? [{ workOrderId: result.workOrderId, workOrderDocNo: result.workOrderDocNo ?? null }]
        : [];
    for (const row of createdRows) {
      workOrders.push({
        workOrderId: row.workOrderId,
        workOrderDocNo: row.workOrderDocNo ?? null,
        requirementSheetId: sheet.id,
        salesOrderId: sheet.salesOrderId,
        created: result.created,
        skippedReason: result.skippedReason,
      });
    }
  }
  return workOrders;
}

/**
 * All NO_QTY WOs for a released period (including pre-release grandfather rows).
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {string} periodKey
 */
async function listNoQtyWorkOrderIdsForPeriod(db, periodKey) {
  const pk = String(periodKey ?? "").trim();
  if (!pk) return [];

  const sheets = await db.requirementSheet.findMany({
    where: { periodKey: pk, status: "LOCKED" },
    select: { id: true },
  });
  const sheetIds = sheets.map((s) => s.id);
  if (!sheetIds.length) return [];

  const wos = await db.workOrder.findMany({
    where: {
      requirementSheetId: { in: sheetIds },
      status: { in: ["PENDING", "IN_PROGRESS", "HOLD", "PAUSED"] },
      salesOrder: { orderType: "NO_QTY" },
    },
    select: { id: true },
  });
  return wos.map((w) => w.id);
}

/**
 * Post-release PMR lookup for all execution WOs in the period.
 * Does not create PMRs; PMR auto-creation belongs to WO creation only.
 * @param {import("@prisma/client").PrismaClient} db
 * @param {{ periodKey: string, actor?: { userId?: number, role?: string } }} input
 */
async function ensurePmrsForPeriodExecution(db, { periodKey, actor = {} }) {
  void actor;
  const woIds = await listNoQtyWorkOrderIdsForPeriod(db, periodKey);
  const pmrs = [];
  for (const workOrderId of woIds) {
    try {
      const pmr = await getExistingProductionMaterialRequestForWorkOrder(workOrderId, db);
      if (!pmr) continue;
      pmrs.push({
        workOrderId,
        pmrId: pmr?.id ?? null,
        pmrDocNo: pmr?.docNo ?? null,
        status: pmr?.status ?? null,
      });
    } catch (err) {
      console.warn(`[NO_QTY_RELEASE] PMR lookup for WO ${workOrderId} failed:`, err?.message || err);
    }
  }
  return pmrs;
}

module.exports = {
  NO_QTY_WO_PLACED_COUNT_STATUSES,
  findLatestLockedSheetsForPeriod,
  buildNoQtyWoBatchPlacementPreview,
  createNoQtyWorkOrderFromLockedSheet,
  createWorkOrdersForPeriodRelease,
  listNoQtyWorkOrderIdsForPeriod,
  ensurePmrsForPeriodExecution,
  isNoQtyWoPlacedStatusCounted,
  lockRequirementSheetForWoPlacement,
  sumPlacedQtyByItem,
  woLinePlacedQty,
};
