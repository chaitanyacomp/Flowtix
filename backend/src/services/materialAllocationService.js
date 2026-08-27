const { prisma } = require("../utils/prisma");
const { qtyToNumber } = require("./rmPurchaseHelpers");

const ALLOCATION_EPS = 1e-6;
const ACTIVE_ALLOCATION_STATUSES = ["ACTIVE", "PARTIALLY_ISSUED"];

function n(v) {
  return qtyToNumber(v);
}

function round3(v) {
  return Math.round((Number(v) || 0) * 1000) / 1000;
}

function activeAllocationQty(row) {
  return round3(Math.max(0, n(row?.qtyAllocated) - n(row?.qtyIssued)));
}

function addToMap(map, key, qty) {
  const q = n(qty);
  if (Math.abs(q) <= ALLOCATION_EPS) return;
  map.set(key, round3((map.get(key) || 0) + q));
}

function deriveAllocationStatus(requiredQty, allocatedQty) {
  const required = Math.max(0, n(requiredQty));
  const allocated = Math.max(0, n(allocatedQty));
  if (allocated <= ALLOCATION_EPS) return "NOT_ALLOCATED";
  if (allocated + ALLOCATION_EPS >= required) return "FULLY_ALLOCATED";
  return "PARTIALLY_ALLOCATED";
}

async function loadActiveAllocatedByItem(db, itemIds, { excludePmrId } = {}) {
  if (!itemIds?.length || !db.materialAllocation?.findMany) return new Map();
  const where = {
    rmItemId: { in: itemIds },
    status: { in: ACTIVE_ALLOCATION_STATUSES },
  };
  if (excludePmrId != null) where.productionMaterialRequestId = { not: Number(excludePmrId) };

  const rows = await db.materialAllocation.findMany({
    where,
    select: { rmItemId: true, qtyAllocated: true, qtyIssued: true },
  });
  const out = new Map();
  for (const row of rows || []) addToMap(out, row.rmItemId, activeAllocationQty(row));
  return out;
}

async function loadPmrAllocationByItem(db, pmrId) {
  if (!pmrId || !db.materialAllocation?.findMany) return new Map();
  const rows = await db.materialAllocation.findMany({
    where: { productionMaterialRequestId: Number(pmrId) },
    select: {
      rmItemId: true,
      qtyAllocated: true,
      qtyIssued: true,
      status: true,
    },
  });
  const out = new Map();
  for (const row of rows || []) {
    const existing = out.get(row.rmItemId) || {
      allocatedQty: 0,
      activeAllocatedQty: 0,
      issuedQty: 0,
      statuses: new Set(),
    };
    existing.allocatedQty = round3(existing.allocatedQty + Math.max(0, n(row.qtyAllocated)));
    existing.activeAllocatedQty = round3(existing.activeAllocatedQty + activeAllocationQty(row));
    existing.issuedQty = round3(existing.issuedQty + Math.max(0, n(row.qtyIssued)));
    existing.statuses.add(row.status);
    out.set(row.rmItemId, existing);
  }
  for (const [itemId, value] of out.entries()) {
    out.set(itemId, { ...value, statuses: [...value.statuses] });
  }
  return out;
}

async function createAllocationsForPmr(tx, pmr, lines, actor = {}) {
  if (!tx.materialAllocation?.createMany || !pmr?.id || !lines?.length) return [];
  const { getMaterialAvailabilityByItems } = require("./materialAvailabilityService");
  const itemIds = [...new Set(lines.map((line) => Number(line.itemId)).filter(Boolean))];
  const requiredQtyByItemId = new Map();
  for (const line of lines) {
    addToMap(requiredQtyByItemId, Number(line.itemId), Math.max(0, n(line.requiredQty)));
  }

  const availabilityRows = await getMaterialAvailabilityByItems({
    db: tx,
    itemIds,
    requiredQtyByItemId,
    excludePmrId: pmr.id,
    includeIncoming: true,
    includeIssued: true,
  });
  const availabilityByItem = new Map(availabilityRows.map((row) => [row.itemId, row]));

  const rows = [];
  for (const line of lines) {
    const itemId = Number(line.itemId);
    const requiredQty = Math.max(0, n(line.requiredQty));
    const availability = availabilityByItem.get(itemId);
    const allocatableQty = round3(Math.min(requiredQty, Math.max(0, n(availability?.freeStockQty))));
    if (allocatableQty <= ALLOCATION_EPS) continue;
    rows.push({
      allocationNo: `MAL-${pmr.id}-${itemId}`,
      rmItemId: itemId,
      salesOrderId: pmr.salesOrderId ?? pmr.workOrder?.salesOrderId ?? null,
      workOrderId: pmr.workOrderId ?? null,
      workOrderLineId: null,
      productionMaterialRequestId: pmr.id,
      sourceLocationId: null,
      qtyAllocated: String(allocatableQty),
      qtyIssued: "0",
      status: "ACTIVE",
      priority: "NORMAL",
      allocationType: "PMR_CREATED",
      remarks:
        allocatableQty + ALLOCATION_EPS < requiredQty
          ? `Partial PMR allocation: ${allocatableQty} of ${requiredQty}`
          : "PMR-created allocation",
      createdByUserId: actor.userId ?? null,
    });
  }
  if (!rows.length) return [];
  await tx.materialAllocation.createMany({ data: rows });
  return rows;
}

/**
 * Idempotent allocation refresh for open-PMR reconcile.
 * Reuses existing MAL-{pmrId}-{itemId} rows (including CANCELLED) so soft-cancel + recreate
 * cannot hit unique allocationNo (Prisma P2002).
 */
async function refreshAllocationsForOpenPmrReconcile(tx, pmr, lines, actor = {}) {
  if (!tx.materialAllocation?.findFirst || !pmr?.id || !lines?.length) return [];
  const { getMaterialAvailabilityByItems } = require("./materialAvailabilityService");
  const itemIds = [...new Set(lines.map((line) => Number(line.itemId)).filter(Boolean))];
  const requiredQtyByItemId = new Map();
  for (const line of lines) {
    addToMap(requiredQtyByItemId, Number(line.itemId), Math.max(0, n(line.requiredQty)));
  }
  const availabilityRows = await getMaterialAvailabilityByItems({
    db: tx,
    itemIds,
    requiredQtyByItemId,
    excludePmrId: pmr.id,
    includeIncoming: true,
    includeIssued: true,
  });
  const availabilityByItem = new Map(availabilityRows.map((row) => [row.itemId, row]));
  const out = [];

  for (const line of lines) {
    const itemId = Number(line.itemId);
    if (!itemId) continue;
    const requiredQty = Math.max(0, n(line.requiredQty));
    const issuedOnLine = Math.max(0, n(line.issuedQty));
    const availability = availabilityByItem.get(itemId);
    const free = Math.max(0, n(availability?.freeStockQty));
    const allocationNo = `MAL-${pmr.id}-${itemId}`;
    const existing =
      (await tx.materialAllocation.findFirst({
        where: { allocationNo },
      })) ||
      (await tx.materialAllocation.findFirst({
        where: { productionMaterialRequestId: Number(pmr.id), rmItemId: itemId },
        orderBy: { id: "asc" },
      }));

    const priorIssued = existing ? Math.max(0, n(existing.qtyIssued)) : 0;
    const qtyIssued = round3(Math.max(priorIssued, Math.min(issuedOnLine, requiredQty)));
    const desiredAllocated = round3(
      Math.max(qtyIssued, Math.min(requiredQty, qtyIssued + free)),
    );
    if (desiredAllocated <= ALLOCATION_EPS && qtyIssued <= ALLOCATION_EPS) {
      if (existing && ACTIVE_ALLOCATION_STATUSES.includes(String(existing.status))) {
        await tx.materialAllocation.update({
          where: { id: existing.id },
          data: {
            status: "CANCELLED",
            releasedByUserId: actor.userId ?? null,
          },
        });
      }
      continue;
    }

    const status =
      qtyIssued + ALLOCATION_EPS >= desiredAllocated
        ? "ISSUED"
        : qtyIssued > ALLOCATION_EPS
          ? "PARTIALLY_ISSUED"
          : "ACTIVE";
    const payload = {
      allocationNo,
      rmItemId: itemId,
      salesOrderId: pmr.salesOrderId ?? pmr.workOrder?.salesOrderId ?? null,
      workOrderId: pmr.workOrderId ?? null,
      productionMaterialRequestId: Number(pmr.id),
      qtyAllocated: String(desiredAllocated),
      qtyIssued: String(qtyIssued),
      status,
      priority: "NORMAL",
      allocationType: "PMR_CREATED",
      remarks:
        desiredAllocated + ALLOCATION_EPS < requiredQty
          ? `Reconcile PMR allocation: ${desiredAllocated} of ${requiredQty}`
          : "Reconcile PMR allocation",
      createdByUserId: existing?.createdByUserId ?? actor.userId ?? null,
      releasedByUserId: null,
    };

    if (existing) {
      const updated = await tx.materialAllocation.update({
        where: { id: existing.id },
        data: payload,
      });
      out.push(updated);
    } else {
      const created = await tx.materialAllocation.create({ data: payload });
      out.push(created);
    }
  }
  return out;
}

async function cancelAllocationsForPmr(tx, pmrId, actor = {}) {
  if (!tx.materialAllocation?.updateMany || !pmrId) return { count: 0 };
  return tx.materialAllocation.updateMany({
    where: {
      productionMaterialRequestId: Number(pmrId),
      status: { in: ACTIVE_ALLOCATION_STATUSES },
    },
    data: {
      status: "CANCELLED",
      releasedByUserId: actor.userId ?? null,
    },
  });
}

/**
 * Sync PMR-linked allocations after issue / short-issue close.
 *
 * Stock movements always use issued qty only (Material Issue Note).
 * When Store accepts a short issue (`SHORT_ISSUE_ACCEPTED` / line `waivedQty`),
 * any unissued residual previously held as `qtyAllocated − qtyIssued` must be
 * released so free usable stock returns to RM Store availability — without
 * creating stock transactions for the short-issue qty.
 */
async function syncAllocationsForPmrIssueStatus(tx, pmrId) {
  if (!tx.materialAllocation?.findMany || !pmrId) return;
  const [pmr, allocations] = await Promise.all([
    tx.productionMaterialRequest.findUnique({
      where: { id: Number(pmrId) },
      include: { lines: true },
    }),
    tx.materialAllocation.findMany({
      where: { productionMaterialRequestId: Number(pmrId) },
    }),
  ]);
  if (!pmr || !allocations.length) return;

  const shortIssueClosed = String(pmr.status ?? "").toUpperCase() === "SHORT_ISSUE_ACCEPTED";
  const lineByItem = new Map((pmr.lines || []).map((line) => [line.itemId, line]));

  for (const allocation of allocations) {
    if (["CANCELLED", "RELEASED"].includes(String(allocation.status ?? ""))) continue;

    const line = lineByItem.get(allocation.rmItemId);
    const lineIssued = round3(Math.max(0, n(line?.issuedQty)));
    const lineWaived = round3(Math.max(0, n(line?.waivedQty)));
    const allocated = round3(Math.max(0, n(allocation.qtyAllocated)));
    const issuedQty = round3(Math.min(lineIssued, allocated));

    const lineDemandClosed =
      shortIssueClosed ||
      (lineWaived > ALLOCATION_EPS &&
        lineIssued + lineWaived + ALLOCATION_EPS >= n(line?.requiredQty));

    if (lineDemandClosed) {
      // Shrink allocation to issued qty only — residual unissued stays in RM Store (no StockTxn).
      const nextAllocated = issuedQty;
      const status = issuedQty > ALLOCATION_EPS ? "ISSUED" : "RELEASED";
      await tx.materialAllocation.update({
        where: { id: allocation.id },
        data: {
          qtyAllocated: String(nextAllocated),
          qtyIssued: String(issuedQty),
          status,
          remarks:
            lineWaived > ALLOCATION_EPS
              ? `Short issue closed — released unissued ${round3(Math.max(0, allocated - issuedQty))} (audit only; no stock movement).`
              : allocation.remarks ?? undefined,
        },
      });
      continue;
    }

    let status = "ACTIVE";
    if (issuedQty + ALLOCATION_EPS >= allocated) status = "ISSUED";
    else if (issuedQty > ALLOCATION_EPS) status = "PARTIALLY_ISSUED";
    await tx.materialAllocation.update({
      where: { id: allocation.id },
      data: {
        qtyIssued: String(issuedQty),
        status,
      },
    });
  }
}

module.exports = {
  ACTIVE_ALLOCATION_STATUSES,
  activeAllocationQty,
  deriveAllocationStatus,
  loadActiveAllocatedByItem,
  loadPmrAllocationByItem,
  createAllocationsForPmr,
  refreshAllocationsForOpenPmrReconcile,
  cancelAllocationsForPmr,
  syncAllocationsForPmrIssueStatus,
  prisma,
};
