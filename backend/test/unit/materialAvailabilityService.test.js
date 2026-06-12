const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  LEGACY_PMR_RESERVATION_STATUSES,
  calculateAvailabilityLine,
  getMaterialAvailabilityByItems,
  loadLegacyReservedByItem,
  loadIncomingByItem,
} = require("../../src/services/materialAvailabilityService");

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function matchesWhere(row, where = {}) {
  if (where.itemId?.in && !where.itemId.in.includes(row.itemId)) return false;
  if (where.stockBucket && typeof where.stockBucket === "string" && row.stockBucket !== where.stockBucket) return false;
  if (where.stockBucket?.in && !where.stockBucket.in.includes(row.stockBucket)) return false;
  if (Object.prototype.hasOwnProperty.call(where, "reversedAt") && where.reversedAt === null && row.reversedAt != null) return false;
  if (Object.prototype.hasOwnProperty.call(where, "locationId")) {
    const loc = where.locationId;
    if (loc === null && row.locationId !== null) return false;
    if (typeof loc === "number" && row.locationId !== loc) return false;
    if (loc?.in && !loc.in.includes(row.locationId)) return false;
  }
  if (where.OR?.length) {
    const ok = where.OR.some((clause) => matchesWhere(row, clause));
    if (!ok) return false;
  }
  return true;
}

function groupRows(rows, by) {
  const grouped = new Map();
  for (const row of rows) {
    const key = by.map((field) => String(row[field] ?? "null")).join("|");
    const current = grouped.get(key) || {
      _sum: { qtyIn: 0, qtyOut: 0 },
    };
    for (const field of by) current[field] = row[field] ?? null;
    current._sum.qtyIn += n(row.qtyIn);
    current._sum.qtyOut += n(row.qtyOut);
    grouped.set(key, current);
  }
  return [...grouped.values()];
}

function createMockDb({ allocations = [], allocatedPmrIds = [] } = {}) {
  const txns = [
    { itemId: 10, locationId: 1, stockBucket: "USABLE", qtyIn: 100, qtyOut: 0, reversedAt: null },
    { itemId: 10, locationId: 1, stockBucket: "QC_HOLD", qtyIn: 50, qtyOut: 0, reversedAt: null },
    { itemId: 10, locationId: 1, stockBucket: "SCRAP", qtyIn: 5, qtyOut: 0, reversedAt: null },
    { itemId: 10, locationId: 1, stockBucket: "REWORK", qtyIn: 3, qtyOut: 0, reversedAt: null },
    { itemId: 10, locationId: 1, stockBucket: "USABLE", qtyIn: 999, qtyOut: 0, reversedAt: new Date() },
    { itemId: 10, locationId: 2, stockBucket: "USABLE", qtyIn: 40, qtyOut: 0, reversedAt: null },
    { itemId: 20, locationId: null, stockBucket: "USABLE", qtyIn: 10, qtyOut: 0, reversedAt: null },
    { itemId: 30, locationId: 1, stockBucket: "USABLE", qtyIn: 5, qtyOut: 0, reversedAt: null },
  ];

  const pmrLines = [
    { itemId: 10, requiredQty: 30, issuedQty: 5, productionMaterialRequest: { id: 4, status: "REQUESTED" } },
    { itemId: 10, requiredQty: 10, issuedQty: 0, productionMaterialRequest: { id: 5, status: "PARTIALLY_ISSUED" } },
    { itemId: 10, requiredQty: 99, issuedQty: 0, productionMaterialRequest: { id: 6, status: "DRAFT" } },
    { itemId: 20, requiredQty: 100, issuedQty: 0, productionMaterialRequest: { id: 7, status: "REQUESTED" } },
    { itemId: 20, requiredQty: 25, issuedQty: 0, productionMaterialRequest: { id: 8, status: "REQUESTED" } },
  ];

  const pos = [
    {
      status: "PENDING",
      lines: [
        {
          itemId: 10,
          qty: 100,
          grnLines: [
            { receivedQty: 25, grn: { reversedAt: null } },
            { receivedQty: 10, grn: { reversedAt: new Date() } },
          ],
        },
        { itemId: 20, qty: 10, grnLines: [] },
      ],
    },
    {
      status: "COMPLETED",
      lines: [{ itemId: 10, qty: 500, grnLines: [] }],
    },
  ];

  return {
    stockTransaction: {
      groupBy: async (query) => groupRows(txns.filter((row) => matchesWhere(row, query.where)), query.by),
    },
    productionMaterialRequestLine: {
      findMany: async (query) => {
        const ids = query.where.itemId.in;
        const statuses = query.where.productionMaterialRequest.status.in;
        const excluded = query.where.productionMaterialRequest.id?.not;
        const excludeAllocatedPmrs = Boolean(query.where.productionMaterialRequest.materialAllocations?.none);
        return pmrLines
          .filter((line) => ids.includes(line.itemId))
          .filter((line) => statuses.includes(line.productionMaterialRequest.status))
          .filter((line) => excluded == null || line.productionMaterialRequest.id !== excluded)
          .filter((line) => !excludeAllocatedPmrs || !allocatedPmrIds.includes(line.productionMaterialRequest.id))
          .map(({ productionMaterialRequest: _pmr, ...line }) => line);
      },
    },
    materialAllocation: {
      findMany: async (query) => {
        const itemIds = query.where.rmItemId.in;
        const statuses = query.where.status.in;
        const excluded = query.where.productionMaterialRequestId?.not;
        return allocations
          .filter((row) => itemIds.includes(row.rmItemId))
          .filter((row) => statuses.includes(row.status))
          .filter((row) => excluded == null || row.productionMaterialRequestId !== excluded);
      },
    },
    rmPurchaseOrder: {
      findMany: async (query) => {
        const statuses = query.where.status.in;
        const itemIds = query.include.lines.where.itemId.in;
        return pos
          .filter((po) => statuses.includes(po.status))
          .map((po) => ({
            ...po,
            lines: po.lines.filter((line) => itemIds.includes(line.itemId)),
          }));
      },
    },
    location: {
      findFirst: async () => ({ id: 1 }),
      findMany: async (query) => {
        assert.deepEqual(query.where.locationType.in, ["PRODUCTION", "WIP"]);
        return [{ id: 2 }, { id: 3 }];
      },
    },
    item: {
      findMany: async (query) =>
        query.where.id.in
          .map((id) => {
            if (id === 10) return { id, itemType: "RM", unit: "KG" };
            if (id === 20) return { id, itemType: "RM", unit: "Nos" };
            if (id === 30) return { id, itemType: "FG", unit: "Nos" };
            if (id === 40) return { id, itemType: "RM", unit: "" };
            return null;
          })
          .filter(Boolean),
    },
  };
}

describe("materialAvailabilityService calculations", () => {
  it("implements standardized shortage formulas", () => {
    assert.deepEqual(
      calculateAvailabilityLine({
        itemId: 10,
        requiredQty: 100,
        physicalUsableStockQty: 80,
        legacyReservedQty: 30,
        incomingQty: 25,
        issuedToProductionQty: 12,
      }),
      {
        itemId: 10,
        requiredQty: 100,
        physicalUsableStockQty: 80,
        activeAllocatedQty: 0,
        legacyReservedQty: 30,
        effectiveReservedQty: 30,
        freeStockQty: 50,
        incomingQty: 25,
        issuedToProductionQty: 12,
        shortageNowQty: 20,
        shortageAfterReservationQty: 50,
        coveredByIncomingQty: 25,
        netShortageAfterIncomingQty: 50,
        allocationCoverageQty: 0,
        allocationShortageQty: 100,
        allocationStatus: "NOT_ALLOCATED",
        reservationBreakdown: [],
        warnings: [
          {
            code: "INCOMING_PO_INFORMATIONAL",
            message: "Open PO / incoming qty is shown for reference only and does not reduce calculated RM shortage.",
          },
        ],
      },
    );
  });

  it("derives PMR legacy reservation and can exclude the current PMR", async () => {
    const db = createMockDb();
    const reserved = await loadLegacyReservedByItem(db, [10, 20], { excludePmrId: 7 });
    assert.deepEqual(LEGACY_PMR_RESERVATION_STATUSES, ["REQUESTED", "PARTIALLY_ISSUED"]);
    assert.equal(reserved.get(10), 35);
    assert.equal(reserved.get(20), 25);
  });

  it("shows incoming procurement separately from physical availability", async () => {
    const db = createMockDb();
    const incoming = await loadIncomingByItem(db, [10, 20]);
    assert.equal(incoming.get(10), 75);
    assert.equal(incoming.get(20), 10);
  });

  it("subtracts active allocations from free stock", async () => {
    const db = createMockDb({
      allocations: [{ rmItemId: 10, productionMaterialRequestId: 101, qtyAllocated: 40, qtyIssued: 10, status: "ACTIVE" }],
    });
    const [row] = await getMaterialAvailabilityByItems({
      db,
      itemIds: [10],
      requiredQtyByItemId: { 10: 80 },
      includeIncoming: false,
      includeIssued: false,
    });

    assert.equal(row.activeAllocatedQty, 30);
    assert.equal(row.legacyReservedQty, 35);
    assert.equal(row.effectiveReservedQty, 65);
    assert.equal(row.freeStockQty, 35);
    assert.equal(row.shortageAfterReservationQty, 45);
    assert.equal(row.allocationCoverageQty, 30);
    assert.equal(row.allocationShortageQty, 50);
    assert.equal(row.allocationStatus, "PARTIALLY_ALLOCATED");
  });

  it("does not double reserve PMRs that already have allocation entries", async () => {
    const db = createMockDb({
      allocatedPmrIds: [4],
      allocations: [{ rmItemId: 10, productionMaterialRequestId: 4, qtyAllocated: 25, qtyIssued: 0, status: "ACTIVE" }],
    });
    const [row] = await getMaterialAvailabilityByItems({
      db,
      itemIds: [10],
      requiredQtyByItemId: { 10: 80 },
      includeIncoming: false,
      includeIssued: false,
    });

    assert.equal(row.activeAllocatedQty, 25);
    assert.equal(row.legacyReservedQty, 10);
    assert.equal(row.effectiveReservedQty, 35);
    assert.equal(row.freeStockQty, 65);
  });

  it("calculates physical usable, free stock, shortages, incoming cover, and warnings", async () => {
    const db = createMockDb();
    const rows = await getMaterialAvailabilityByItems({
      db,
      itemIds: [10, 20],
      requiredQtyByItemId: { 10: 100, 20: 20 },
      excludePmrId: 7,
    });

    const byItem = new Map(rows.map((row) => [row.itemId, row]));

    assert.deepEqual(byItem.get(10), {
      itemId: 10,
      requiredQty: 100,
      physicalUsableStockQty: 100,
      activeAllocatedQty: 0,
      legacyReservedQty: 35,
      effectiveReservedQty: 35,
      freeStockQty: 65,
      incomingQty: 75,
      issuedToProductionQty: 40,
      shortageNowQty: 0,
      shortageAfterReservationQty: 35,
      coveredByIncomingQty: 35,
      netShortageAfterIncomingQty: 35,
      allocationCoverageQty: 0,
      allocationShortageQty: 100,
      allocationStatus: "NOT_ALLOCATED",
      reservationBreakdown: [
        {
          sourceType: "PMR",
          reservationType: "LEGACY_PMR",
          pmrId: null,
          pmrDocNo: null,
          pmrStatus: null,
          workOrderId: null,
          workOrderNo: null,
          requiredQty: 30,
          issuedQty: 5,
          reservedQty: 25,
        },
        {
          sourceType: "PMR",
          reservationType: "LEGACY_PMR",
          pmrId: null,
          pmrDocNo: null,
          pmrStatus: null,
          workOrderId: null,
          workOrderNo: null,
          requiredQty: 10,
          issuedQty: 0,
          reservedQty: 10,
        },
      ],
      warnings: [
        {
          code: "NON_USABLE_STOCK_EXISTS",
          message: "Stock exists outside USABLE buckets and is excluded from availability.",
        },
        {
          code: "STOCK_IN_PRODUCTION_LOCATION",
          message: "Stock exists in Production/WIP location and is not store-free stock.",
        },
        {
          code: "INCOMING_PO_INFORMATIONAL",
          message: "Open PO / incoming qty is shown for reference only and does not reduce calculated RM shortage.",
        },
      ],
    });

    assert.deepEqual(byItem.get(20), {
      itemId: 20,
      requiredQty: 20,
      physicalUsableStockQty: 10,
      activeAllocatedQty: 0,
      legacyReservedQty: 25,
      effectiveReservedQty: 25,
      freeStockQty: 0,
      incomingQty: 10,
      issuedToProductionQty: 0,
      shortageNowQty: 10,
      shortageAfterReservationQty: 20,
      coveredByIncomingQty: 10,
      netShortageAfterIncomingQty: 20,
      allocationCoverageQty: 0,
      allocationShortageQty: 20,
      allocationStatus: "NOT_ALLOCATED",
      reservationBreakdown: [
        {
          sourceType: "PMR",
          reservationType: "LEGACY_PMR",
          pmrId: null,
          pmrDocNo: null,
          pmrStatus: null,
          workOrderId: null,
          workOrderNo: null,
          requiredQty: 25,
          issuedQty: 0,
          reservedQty: 25,
        },
      ],
      warnings: [
        {
          code: "LEGACY_NULL_LOCATION_INCLUDED",
          message: "Current calculation includes legacy stock rows with no location.",
        },
        {
          code: "LEGACY_RESERVATION_EXCEEDS_PHYSICAL",
          message: "Active allocation or legacy PMR reservation is higher than physical usable stock.",
        },
        {
          code: "INCOMING_PO_INFORMATIONAL",
          message: "Open PO / incoming qty is shown for reference only and does not reduce calculated RM shortage.",
        },
      ],
    });
  });

  it("can disable incoming and issued sections for lightweight callers", async () => {
    const db = createMockDb();
    const [row] = await getMaterialAvailabilityByItems({
      db,
      itemIds: [10],
      requiredQtyByItemId: new Map([[10, 120]]),
      includeIncoming: false,
      includeIssued: false,
    });

    assert.equal(row.incomingQty, 0);
    assert.equal(row.issuedToProductionQty, 0);
    assert.equal(row.coveredByIncomingQty, 0);
    assert.equal(row.netShortageAfterIncomingQty, row.shortageAfterReservationQty);
    assert.equal(row.warnings.some((w) => w.code === "STOCK_IN_PRODUCTION_LOCATION"), false);
  });

  it("includes only RM item stock and warns for item master problems", async () => {
    const db = createMockDb();
    const rows = await getMaterialAvailabilityByItems({
      db,
      itemIds: [30, 40, 999],
      requiredQtyByItemId: { 30: 5, 40: 2, 999: 1 },
      includeIncoming: false,
      includeIssued: false,
    });
    const byItem = new Map(rows.map((row) => [row.itemId, row]));

    assert.equal(byItem.get(30).physicalUsableStockQty, 0);
    assert.ok(byItem.get(30).warnings.some((w) => w.code === "ITEM_NOT_RM"));
    assert.ok(byItem.get(40).warnings.some((w) => w.code === "ITEM_UNIT_MISSING"));
    assert.ok(byItem.get(999).warnings.some((w) => w.code === "ITEM_NOT_FOUND"));
  });
});
