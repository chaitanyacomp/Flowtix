/**
 * Central read-only RM availability engine.
 *
 * This service intentionally does not create stock transactions, allocations, PMRs,
 * purchase documents, or schema-backed reservations. It standardizes the current
 * derived availability view so future operational screens can share one source.
 */

const { prisma } = require("../utils/prisma");
const { resolveLocationReadScope } = require("./locationService");
const { qtyToNumber } = require("./rmPurchaseHelpers");
const {
  deriveAllocationStatus,
  loadActiveAllocatedByItem,
} = require("./materialAllocationService");

const STOCK_EPS = 1e-6;
const LEGACY_PMR_RESERVATION_STATUSES = ["REQUESTED", "PARTIALLY_ISSUED"];
const NON_USABLE_BUCKETS = ["QC_HOLD", "QC_PENDING", "REWORK", "SCRAP"];
const PRODUCTION_LOCATION_TYPES = ["PRODUCTION", "WIP"];

function n(v) {
  return qtyToNumber(v);
}

function round3(v) {
  return Math.round((Number(v) || 0) * 1000) / 1000;
}

function normalizeItemIds(itemIds, requiredQtyByItemId = {}) {
  const out = new Set();
  for (const id of itemIds || []) {
    const x = Number(id);
    if (Number.isFinite(x) && x > 0) out.add(x);
  }
  for (const id of Object.keys(requiredQtyByItemId || {})) {
    const x = Number(id);
    if (Number.isFinite(x) && x > 0) out.add(x);
  }
  if (requiredQtyByItemId instanceof Map) {
    for (const id of requiredQtyByItemId.keys()) {
      const x = Number(id);
      if (Number.isFinite(x) && x > 0) out.add(x);
    }
  }
  return [...out];
}

function requiredQtyForItem(requiredQtyByItemId, itemId) {
  if (requiredQtyByItemId instanceof Map) return n(requiredQtyByItemId.get(itemId));
  return n(requiredQtyByItemId?.[itemId]);
}

function addToMap(map, key, qty) {
  const q = n(qty);
  if (Math.abs(q) <= STOCK_EPS) return;
  map.set(key, round3((map.get(key) || 0) + q));
}

function stockQtyFromGroup(row) {
  return n(row?._sum?.qtyIn) - n(row?._sum?.qtyOut);
}

function calculateAvailabilityLine({
  itemId,
  requiredQty,
  physicalUsableStockQty,
  activeAllocatedQty = 0,
  legacyReservedQty,
  incomingQty,
  issuedToProductionQty,
  warnings = [],
  reservationBreakdown = [],
}) {
  const required = round3(Math.max(0, n(requiredQty)));
  const physical = round3(Math.max(0, n(physicalUsableStockQty)));
  const activeAllocated = round3(Math.max(0, n(activeAllocatedQty)));
  const legacyReserved = round3(Math.max(0, n(legacyReservedQty)));
  const effectiveReserved = round3(activeAllocated + legacyReserved);
  const incoming = round3(Math.max(0, n(incomingQty)));
  const issued = round3(Math.max(0, n(issuedToProductionQty)));
  const free = round3(Math.max(0, physical - effectiveReserved));
  const shortageNow = round3(Math.max(0, required - physical));
  const shortageAfterReservation = round3(Math.max(0, required - free));
  const coveredByIncoming = round3(Math.min(shortageAfterReservation, incoming));
  // Incoming/open PO is informational until explicit allocation — do not reduce operational shortage.
  const netShortageAfterIncoming = shortageAfterReservation;
  const allocationCoverage = round3(Math.min(required, activeAllocated));
  const allocationShortage = round3(Math.max(0, required - activeAllocated));
  const nextWarnings = [...warnings];

  if (effectiveReserved > physical + STOCK_EPS) {
    nextWarnings.push({
      code: "LEGACY_RESERVATION_EXCEEDS_PHYSICAL",
      message: "Active allocation or legacy PMR reservation is higher than physical usable stock.",
    });
  }
  if (shortageAfterReservation > STOCK_EPS && incoming > STOCK_EPS) {
    nextWarnings.push({
      code: "INCOMING_PO_INFORMATIONAL",
      message: "Open PO / incoming qty is shown for reference only and does not reduce calculated RM shortage.",
    });
  }

  return {
    itemId,
    requiredQty: required,
    physicalUsableStockQty: physical,
    activeAllocatedQty: activeAllocated,
    legacyReservedQty: legacyReserved,
    effectiveReservedQty: effectiveReserved,
    freeStockQty: free,
    incomingQty: incoming,
    issuedToProductionQty: issued,
    shortageNowQty: shortageNow,
    shortageAfterReservationQty: shortageAfterReservation,
    coveredByIncomingQty: coveredByIncoming,
    netShortageAfterIncomingQty: netShortageAfterIncoming,
    allocationCoverageQty: allocationCoverage,
    allocationShortageQty: allocationShortage,
    allocationStatus: deriveAllocationStatus(required, activeAllocated),
    reservationBreakdown,
    warnings: nextWarnings,
  };
}

async function resolveAvailabilityLocationScope(db, locationScope = {}) {
  if (locationScope?.where) return locationScope.where;
  return resolveLocationReadScope(db, {
    locationId: locationScope?.locationId,
    allLocations: locationScope?.allLocations,
  });
}

async function loadPhysicalUsableByItem(db, itemIds, locationWhere) {
  if (!itemIds.length) return new Map();
  const rows = await db.stockTransaction.groupBy({
    by: ["itemId"],
    where: {
      itemId: { in: itemIds },
      stockBucket: "USABLE",
      reversedAt: null,
      ...locationWhere,
    },
    _sum: { qtyIn: true, qtyOut: true },
  });
  const out = new Map();
  for (const row of rows || []) {
    out.set(row.itemId, round3(Math.max(0, stockQtyFromGroup(row))));
  }
  return out;
}

async function loadLegacyNullUsableByItem(db, itemIds) {
  if (!itemIds.length) return new Map();
  const rows = await db.stockTransaction.groupBy({
    by: ["itemId", "locationId"],
    where: {
      itemId: { in: itemIds },
      stockBucket: "USABLE",
      reversedAt: null,
      locationId: null,
    },
    _sum: { qtyIn: true, qtyOut: true },
  });
  const out = new Map();
  for (const row of rows || []) {
    addToMap(out, row.itemId, Math.max(0, stockQtyFromGroup(row)));
  }
  return out;
}

async function loadNonUsableStockByItem(db, itemIds) {
  if (!itemIds.length) return new Map();
  const rows = await db.stockTransaction.groupBy({
    by: ["itemId", "stockBucket"],
    where: {
      itemId: { in: itemIds },
      stockBucket: { in: NON_USABLE_BUCKETS },
      reversedAt: null,
    },
    _sum: { qtyIn: true, qtyOut: true },
  });
  const out = new Map();
  for (const row of rows || []) {
    addToMap(out, row.itemId, Math.max(0, stockQtyFromGroup(row)));
  }
  return out;
}

async function loadLegacyReservedByItem(db, itemIds, { excludePmrId } = {}) {
  if (!itemIds.length) return new Map();
  const rows = await db.productionMaterialRequestLine.findMany({
    where: {
      itemId: { in: itemIds },
      productionMaterialRequest: {
        status: { in: LEGACY_PMR_RESERVATION_STATUSES },
        materialAllocations: { none: {} },
        ...(excludePmrId != null ? { id: { not: Number(excludePmrId) } } : {}),
      },
    },
    select: {
      itemId: true,
      requiredQty: true,
      issuedQty: true,
    },
  });
  const out = new Map();
  for (const row of rows || []) {
    const pending = Math.max(0, n(row.requiredQty) - n(row.issuedQty));
    addToMap(out, row.itemId, pending);
  }
  return out;
}

async function loadLegacyReservationBreakdownByItem(db, itemIds, { excludePmrId } = {}) {
  if (!itemIds.length) return new Map();
  const rows = await db.productionMaterialRequestLine.findMany({
    where: {
      itemId: { in: itemIds },
      productionMaterialRequest: {
        status: { in: LEGACY_PMR_RESERVATION_STATUSES },
        materialAllocations: { none: {} },
        ...(excludePmrId != null ? { id: { not: Number(excludePmrId) } } : {}),
      },
    },
    select: {
      itemId: true,
      requiredQty: true,
      issuedQty: true,
      productionMaterialRequest: {
        select: {
          id: true,
          docNo: true,
          status: true,
          workOrderId: true,
          workOrder: { select: { docNo: true } },
        },
      },
    },
  });
  const out = new Map();
  for (const row of rows || []) {
    const reservedQty = round3(Math.max(0, n(row.requiredQty) - n(row.issuedQty)));
    if (reservedQty <= STOCK_EPS) continue;
    const pmr = row.productionMaterialRequest;
    const arr = out.get(row.itemId) || [];
    arr.push({
      sourceType: "PMR",
      reservationType: "LEGACY_PMR",
      pmrId: pmr?.id ?? null,
      pmrDocNo: pmr?.docNo ?? (pmr?.id ? `PMR-${pmr.id}` : null),
      pmrStatus: pmr?.status ?? null,
      workOrderId: pmr?.workOrderId ?? null,
      workOrderNo: pmr?.workOrder?.docNo ?? null,
      requiredQty: round3(Math.max(0, n(row.requiredQty))),
      issuedQty: round3(Math.max(0, n(row.issuedQty))),
      reservedQty,
    });
    out.set(row.itemId, arr);
  }
  return out;
}

async function loadAllocationReservationBreakdownByItem(db, itemIds, { excludePmrId } = {}) {
  if (!itemIds.length || !db.materialAllocation?.findMany) return new Map();
  const where = {
    rmItemId: { in: itemIds },
    status: { in: ["ACTIVE", "PARTIALLY_ISSUED"] },
  };
  if (excludePmrId != null) where.productionMaterialRequestId = { not: Number(excludePmrId) };
  const rows = await db.materialAllocation.findMany({
    where,
    select: {
      allocationNo: true,
      rmItemId: true,
      productionMaterialRequestId: true,
      workOrderId: true,
      qtyAllocated: true,
      qtyIssued: true,
      status: true,
      productionMaterialRequest: {
        select: {
          id: true,
          docNo: true,
          status: true,
          workOrder: { select: { docNo: true } },
        },
      },
      workOrder: { select: { docNo: true } },
    },
  });
  const out = new Map();
  for (const row of rows || []) {
    const reservedQty = round3(Math.max(0, n(row.qtyAllocated) - n(row.qtyIssued)));
    if (reservedQty <= STOCK_EPS) continue;
    const pmr = row.productionMaterialRequest;
    const arr = out.get(row.rmItemId) || [];
    arr.push({
      sourceType: "ALLOCATION",
      reservationType: "MATERIAL_ALLOCATION",
      allocationNo: row.allocationNo ?? null,
      pmrId: row.productionMaterialRequestId ?? null,
      pmrDocNo: pmr?.docNo ?? (row.productionMaterialRequestId ? `PMR-${row.productionMaterialRequestId}` : null),
      pmrStatus: pmr?.status ?? null,
      workOrderId: row.workOrderId ?? null,
      workOrderNo: row.workOrder?.docNo ?? pmr?.workOrder?.docNo ?? null,
      allocatedQty: round3(Math.max(0, n(row.qtyAllocated))),
      issuedQty: round3(Math.max(0, n(row.qtyIssued))),
      reservedQty,
      allocationStatus: row.status,
    });
    out.set(row.rmItemId, arr);
  }
  return out;
}

async function loadReservationBreakdownByItem(db, itemIds, { excludePmrId } = {}) {
  const [legacy, allocations] = await Promise.all([
    loadLegacyReservationBreakdownByItem(db, itemIds, { excludePmrId }),
    loadAllocationReservationBreakdownByItem(db, itemIds, { excludePmrId }),
  ]);
  const out = new Map();
  for (const itemId of itemIds) {
    const rows = [...(legacy.get(itemId) || []), ...(allocations.get(itemId) || [])].sort((a, b) =>
      String(a.pmrDocNo || a.allocationNo || "").localeCompare(String(b.pmrDocNo || b.allocationNo || "")),
    );
    if (rows.length) out.set(itemId, rows);
  }
  return out;
}

async function loadIncomingByItem(db, itemIds) {
  if (!itemIds.length) return new Map();
  const pos = await db.rmPurchaseOrder.findMany({
    where: { status: { in: ["PENDING", "PARTIAL"] } },
    include: {
      lines: {
        where: { itemId: { in: itemIds } },
        include: { grnLines: { include: { grn: { select: { reversedAt: true } } } } },
      },
    },
  });
  const out = new Map();
  for (const po of pos || []) {
    for (const line of po.lines || []) {
      const ordered = n(line.qty);
      const received = (line.grnLines || []).reduce((sum, gl) => {
        if (gl.grn?.reversedAt) return sum;
        return sum + n(gl.receivedQty);
      }, 0);
      addToMap(out, line.itemId, Math.max(0, ordered - received));
    }
  }
  return out;
}

async function loadProductionLocationIds(db) {
  const rows = await db.location.findMany({
    where: { isActive: true, locationType: { in: PRODUCTION_LOCATION_TYPES } },
    select: { id: true },
  });
  return (rows || []).map((r) => r.id).filter((id) => Number.isFinite(Number(id)));
}

async function loadRmItemMetadata(db, itemIds) {
  if (!itemIds.length) return { rmItemIds: [], warningsByItem: new Map() };
  const rows = await db.item.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, itemType: true, unit: true },
  });
  const byId = new Map((rows || []).map((row) => [row.id, row]));
  const rmItemIds = [];
  const warningsByItem = new Map();

  for (const itemId of itemIds) {
    const item = byId.get(itemId);
    const warnings = [];
    if (!item) {
      warnings.push({
        code: "ITEM_NOT_FOUND",
        message: "Item master row was not found; availability is treated as zero.",
      });
    } else if (item.itemType !== "RM") {
      warnings.push({
        code: "ITEM_NOT_RM",
        message: "Item is not an RM item; RM availability calculation excludes its stock.",
      });
    } else {
      rmItemIds.push(itemId);
      if (!String(item.unit || "").trim()) {
        warnings.push({
          code: "ITEM_UNIT_MISSING",
          message: "Item unit is missing; quantity math is still calculated but unit display may be incomplete.",
        });
      }
    }
    if (warnings.length) warningsByItem.set(itemId, warnings);
  }

  return { rmItemIds, warningsByItem };
}

async function loadIssuedToProductionByItem(db, itemIds) {
  if (!itemIds.length) return new Map();
  const locationIds = await loadProductionLocationIds(db);
  if (!locationIds.length) return new Map();
  const rows = await db.stockTransaction.groupBy({
    by: ["itemId"],
    where: {
      itemId: { in: itemIds },
      stockBucket: "USABLE",
      reversedAt: null,
      locationId: { in: locationIds },
    },
    _sum: { qtyIn: true, qtyOut: true },
  });
  const out = new Map();
  for (const row of rows || []) {
    out.set(row.itemId, round3(Math.max(0, stockQtyFromGroup(row))));
  }
  return out;
}

function pushStockWarnings(warningsByItem, itemId, warnings) {
  if (!warnings.length) return;
  const arr = warningsByItem.get(itemId) || [];
  arr.push(...warnings);
  warningsByItem.set(itemId, arr);
}

async function getMaterialAvailabilityByItems({
  itemIds,
  requiredQtyByItemId = {},
  excludePmrId = null,
  locationScope = {},
  includeIncoming = true,
  includeIssued = true,
  db = prisma,
} = {}) {
  const ids = normalizeItemIds(itemIds, requiredQtyByItemId);
  const { rmItemIds, warningsByItem } = await loadRmItemMetadata(db, ids);
  const locationWhere = await resolveAvailabilityLocationScope(db, locationScope);

  const [
    physicalByItem,
    activeAllocatedByItem,
    legacyReservedByItem,
    reservationBreakdownByItem,
    incomingByItem,
    issuedByItem,
    nonUsableByItem,
    legacyNullByItem,
  ] = await Promise.all([
    loadPhysicalUsableByItem(db, rmItemIds, locationWhere),
    loadActiveAllocatedByItem(db, rmItemIds, { excludePmrId }),
    loadLegacyReservedByItem(db, rmItemIds, { excludePmrId }),
    loadReservationBreakdownByItem(db, rmItemIds, { excludePmrId }),
    includeIncoming ? loadIncomingByItem(db, rmItemIds) : Promise.resolve(new Map()),
    includeIssued ? loadIssuedToProductionByItem(db, rmItemIds) : Promise.resolve(new Map()),
    loadNonUsableStockByItem(db, rmItemIds),
    loadLegacyNullUsableByItem(db, rmItemIds),
  ]);

  for (const itemId of ids) {
    if ((nonUsableByItem.get(itemId) || 0) > STOCK_EPS) {
      pushStockWarnings(warningsByItem, itemId, [
        {
          code: "NON_USABLE_STOCK_EXISTS",
          message: "Stock exists outside USABLE buckets and is excluded from availability.",
        },
      ]);
    }
    if ((issuedByItem.get(itemId) || 0) > STOCK_EPS) {
      pushStockWarnings(warningsByItem, itemId, [
        {
          code: "STOCK_IN_PRODUCTION_LOCATION",
          message: "Stock exists in Production/WIP location and is not store-free stock.",
        },
      ]);
    }
    if ((legacyNullByItem.get(itemId) || 0) > STOCK_EPS) {
      pushStockWarnings(warningsByItem, itemId, [
        {
          code: "LEGACY_NULL_LOCATION_INCLUDED",
          message: "Current calculation includes legacy stock rows with no location.",
        },
      ]);
    }
  }

  return ids.map((itemId) =>
    calculateAvailabilityLine({
      itemId,
      requiredQty: requiredQtyForItem(requiredQtyByItemId, itemId),
      physicalUsableStockQty: physicalByItem.get(itemId) || 0,
      activeAllocatedQty: activeAllocatedByItem.get(itemId) || 0,
      legacyReservedQty: legacyReservedByItem.get(itemId) || 0,
      incomingQty: incomingByItem.get(itemId) || 0,
      issuedToProductionQty: issuedByItem.get(itemId) || 0,
      reservationBreakdown: reservationBreakdownByItem.get(itemId) || [],
      warnings: warningsByItem.get(itemId) || [],
    }),
  );
}

module.exports = {
  LEGACY_PMR_RESERVATION_STATUSES,
  NON_USABLE_BUCKETS,
  PRODUCTION_LOCATION_TYPES,
  calculateAvailabilityLine,
  getMaterialAvailabilityByItems,
  loadLegacyReservedByItem,
  loadReservationBreakdownByItem,
  loadIncomingByItem,
};
