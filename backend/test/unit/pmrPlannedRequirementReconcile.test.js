/**
 * Regression: open-PMR reconcile must merge production+purge onto one RM line
 * and remain idempotent (no P2002 on PmrLine or MaterialAllocation.allocationNo).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  aggregateSuggestionLinesByRmItem,
  planOpenPmrPlannedRequirementReconcile,
  planPmrLinePlannedRequirementReconcile,
  expectedReconcileForPreMigrationOpenPmr,
  describePrismaUniqueViolation,
} = require("../../src/services/pmrPlannedRequirementReconcileService");

const kgItem = {
  id: 10,
  itemType: "RM",
  unit: "Kg",
  issueIncrement: 1,
  unitRef: { unitCode: "Kg", unitName: "Kilogram" },
};

describe("pmrPlannedRequirementReconcileService — merge + idempotency", () => {
  it("aggregates production + purge split rows for the same RM into one suggestion", () => {
    const merged = aggregateSuggestionLinesByRmItem([
      {
        itemId: 10,
        requiredQty: 270,
        productionRmQty: 270,
        purgingRmQty: 0,
        issueIncrement: 1,
        unit: "Kg",
      },
      {
        itemId: 10,
        requiredQty: 0.2,
        productionRmQty: 0,
        purgingRmQty: 0.2,
        issueIncrement: 1,
        unit: "Kg",
      },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].itemId, 10);
    assert.equal(merged[0].productionRmQty, 270);
    assert.equal(merged[0].purgingRmQty, 0.2);
    assert.equal(merged[0].requiredQty, 270.2);
  });

  it("does not double-count duplicate full merged suggestion rows", () => {
    const full = {
      itemId: 10,
      requiredQty: 270.2,
      productionRmQty: 270,
      purgingRmQty: 0.2,
      issueIncrement: 1,
    };
    const merged = aggregateSuggestionLinesByRmItem([full, { ...full }]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].requiredQty, 270.2);
  });

  it("keeps different RM items separate", () => {
    const merged = aggregateSuggestionLinesByRmItem([
      { itemId: 10, requiredQty: 270.2, productionRmQty: 270, purgingRmQty: 0.2 },
      { itemId: 11, requiredQty: 5, productionRmQty: 5, purgingRmQty: 0 },
    ]);
    assert.equal(merged.length, 2);
    assert.deepEqual(
      merged.map((r) => r.itemId).sort((a, b) => a - b),
      [10, 11],
    );
  });

  it("production+purge same RM → updates existing HDPE line only (no second line)", () => {
    const expected = expectedReconcileForPreMigrationOpenPmr({
      productionRmQty: 270,
      purgingRmQty: 0.2,
      issueIncrement: 1,
    });
    assert.equal(expected.plannedRequiredQty, 270.2);
    assert.equal(expected.roundedIssueTargetQty, 271);
    assert.equal(expected.roundingExcessQty, 0.8);

    const plan = planOpenPmrPlannedRequirementReconcile({
      pmr: {
        status: "REQUESTED",
        lines: [{ id: 1, itemId: 10, requiredQty: 270, issuedQty: 0, waivedQty: 0 }],
      },
      suggestionLines: [
        { itemId: 10, requiredQty: 270, productionRmQty: 270, purgingRmQty: 0, issueIncrement: 1 },
        { itemId: 10, requiredQty: 0.2, productionRmQty: 0, purgingRmQty: 0.2, issueIncrement: 1 },
      ],
      itemsById: new Map([[10, kgItem]]),
    });

    assert.equal(plan.changed, true);
    assert.equal(plan.addLinePlans.length, 0);
    assert.equal(plan.linePlans.length, 1);
    assert.equal(plan.linePlans[0].action, "UPDATE");
    assert.equal(plan.linePlans[0].plannedRequiredQty, 270.2);
    assert.equal(plan.linePlans[0].roundedIssueTargetQty, 271);
    assert.equal(plan.linePlans[0].roundingExcessQty, 0.8);
    assert.equal(plan.linePlans[0].patch.requiredQty, "270.2");
    assert.equal(plan.linePlans[0].patch.roundedIssueTargetQty, "271");
  });

  it("refresh twice remains one line / unchanged after first update", () => {
    const first = planOpenPmrPlannedRequirementReconcile({
      pmr: {
        status: "REQUESTED",
        lines: [{ id: 1, itemId: 10, requiredQty: 270, issuedQty: 0 }],
      },
      suggestionLines: [
        { itemId: 10, requiredQty: 270.2, productionRmQty: 270, purgingRmQty: 0.2, issueIncrement: 1 },
      ],
      itemsById: new Map([[10, kgItem]]),
    });
    assert.equal(first.linePlans[0].action, "UPDATE");

    const second = planOpenPmrPlannedRequirementReconcile({
      pmr: {
        status: "REQUESTED",
        lines: [
          {
            id: 1,
            itemId: 10,
            requiredQty: 270.2,
            issuedQty: 0,
            productionRmQty: 270,
            purgingRmQty: 0.2,
            issueIncrementSnapshot: 1,
            roundedIssueTargetQty: 271,
          },
        ],
      },
      suggestionLines: [
        { itemId: 10, requiredQty: 270.2, productionRmQty: 270, purgingRmQty: 0.2, issueIncrement: 1 },
        // Concurrent duplicate suggestion payload
        { itemId: 10, requiredQty: 270.2, productionRmQty: 270, purgingRmQty: 0.2, issueIncrement: 1 },
      ],
      itemsById: new Map([[10, kgItem]]),
    });
    assert.equal(second.changed, false);
    assert.equal(second.addLinePlans.length, 0);
    assert.equal(second.linePlans[0].action, "UNCHANGED");
    assert.equal(second.aggregatedSuggestionCount, 1);
  });

  it("partial-issued line preserves issued qty and recomputes remaining", () => {
    const plan = planPmrLinePlannedRequirementReconcile({
      line: {
        id: 1,
        itemId: 10,
        requiredQty: 270,
        issuedQty: 100,
        waivedQty: 0,
        roundedIssueTargetQty: 270,
      },
      suggestion: {
        itemId: 10,
        requiredQty: 270.2,
        productionRmQty: 270,
        purgingRmQty: 0.2,
        issueIncrement: 1,
      },
      item: kgItem,
    });
    assert.equal(plan.plannedRequiredQty, 270.2);
    assert.equal(plan.roundedIssueTargetQty, 271);
    assert.equal(plan.remainingIssueQty, 171);
    assert.equal(plan.reviewRequired, false);
  });

  it("describes Prisma P2002 unique violations for logging", () => {
    const allocation = describePrismaUniqueViolation({
      code: "P2002",
      meta: { modelName: "MaterialAllocation", target: ["allocationNo"] },
      message: "Unique constraint failed on the fields: (`allocationNo`)",
    });
    assert.equal(allocation.code, "P2002");
    assert.equal(allocation.model, "MaterialAllocation");
    assert.equal(allocation.target, "allocationNo");

    const pmrLine = describePrismaUniqueViolation({
      code: "P2002",
      meta: { modelName: "ProductionMaterialRequestLine", target: ["productionMaterialRequestId", "itemId"] },
      message: "Unique constraint failed on the constraint: `PmrLine_pmrId_itemId_key`",
    });
    assert.equal(pmrLine.model, "ProductionMaterialRequestLine");
    assert.match(pmrLine.target, /itemId/);
  });
});

describe("refreshAllocationsForOpenPmrReconcile idempotency", () => {
  it("reuses cancelled MAL-{pmr}-{item} instead of createMany duplicate", async () => {
    const { refreshAllocationsForOpenPmrReconcile } = require("../../src/services/materialAllocationService");
    const updates = [];
    const creates = [];
    const tx = {
      materialAllocation: {
        findFirst: async ({ where }) => {
          if (where.allocationNo === "MAL-26-10") {
            return {
              id: 99,
              allocationNo: "MAL-26-10",
              rmItemId: 10,
              qtyAllocated: "270",
              qtyIssued: "0",
              status: "CANCELLED",
              createdByUserId: 1,
            };
          }
          return null;
        },
        update: async ({ where, data }) => {
          updates.push({ where, data });
          return { id: where.id, ...data };
        },
        create: async ({ data }) => {
          creates.push(data);
          return { id: 100, ...data };
        },
      },
    };
    // Stub availability via module path used inside refresh — inject by monkeypatching require cache is heavy;
    // instead call with lines that need allocation and mock getMaterialAvailability through a minimal free path.
    // refresh loads getMaterialAvailabilityByItems — provide stock via prisma-less stub by patching.
    const availability = require("../../src/services/materialAvailabilityService");
    const original = availability.getMaterialAvailabilityByItems;
    availability.getMaterialAvailabilityByItems = async () => [
      { itemId: 10, freeStockQty: 500 },
    ];
    try {
      await refreshAllocationsForOpenPmrReconcile(
        tx,
        { id: 26, workOrderId: 1, salesOrderId: 1 },
        [{ itemId: 10, requiredQty: 270.2, issuedQty: 0 }],
        { userId: 1 },
      );
      assert.equal(creates.length, 0, "must not create duplicate allocationNo");
      assert.equal(updates.length, 1);
      assert.equal(updates[0].where.id, 99);
      assert.equal(Number(updates[0].data.qtyAllocated), 270.2);
      assert.equal(updates[0].data.status, "ACTIVE");
    } finally {
      availability.getMaterialAvailabilityByItems = original;
    }
  });
});
