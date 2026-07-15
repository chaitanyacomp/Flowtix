const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  floorFgQty,
  resolveWoIssuedAvailableQty,
  productionQtyExceedsRmAllowed,
  resolveReadinessGate,
  hasCompletedStoreIssueTransfer,
  resolveWorkOrderLinePlannedQty,
  resolveProductionBatchRmCap,
  SUBMITTED_PMR_STATUSES,
  aggregatePmrRequiredByItem,
  computeMaxProducibleFromPmrBasis,
} = require("../../src/services/productionRmReadinessService");
const { loadGrossIssuedByWorkOrder } = require("../../src/services/materialReturnService");

describe("productionRmReadinessService", () => {
  it("SUBMITTED_PMR_STATUSES includes store-issue states", () => {
    assert.ok(SUBMITTED_PMR_STATUSES.includes("REQUESTED"));
    assert.ok(SUBMITTED_PMR_STATUSES.includes("PARTIALLY_ISSUED"));
    assert.ok(SUBMITTED_PMR_STATUSES.includes("SHORT_ISSUE_ACCEPTED"));
    assert.ok(!SUBMITTED_PMR_STATUSES.includes("DRAFT"));
  });

  it("floorFgQty - max producible is limited by scarcest RM", () => {
    const ppCaps = floorFgQty(4000, 1);
    const powderCaps = floorFgQty(3000, 1);
    assert.equal(ppCaps, 4000);
    assert.equal(powderCaps, 3000);
    assert.equal(Math.min(ppCaps, powderCaps), 3000);
  });

  it("allows production qty equal to RM allowed qty", () => {
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 2000,
        productionAllowedNowQty: 2000,
      }),
      false,
    );
  });

  it("blocks only when production qty exceeds RM allowed qty", () => {
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 2001,
        productionAllowedNowQty: 2000,
      }),
      true,
    );
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 1000,
        productionAllowedNowQty: 2000,
      }),
      false,
    );
  });

  it("uses tolerance for decimal equality at the RM cap", () => {
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 2000.0000004,
        productionAllowedNowQty: 2000,
      }),
      false,
    );
  });

  it("resolveReadinessGate - no PMR when empty", () => {
    const g = resolveReadinessGate([], 0);
    assert.equal(g.gate, "NO_PMR");
  });

  it("resolveReadinessGate - waiting when submitted but zero issued", () => {
    const g = resolveReadinessGate([{ status: "REQUESTED" }], 0);
    assert.equal(g.gate, "WAITING_STORE_ISSUE");
  });

  it("resolveReadinessGate - waiting release when some issued but not released", () => {
    const g = resolveReadinessGate([{ status: "PARTIALLY_ISSUED" }], 100, false);
    assert.equal(g.gate, "WAITING_RELEASE_TO_PRODUCTION");
  });

  it("resolveReadinessGate - ready for production when released", () => {
    const g = resolveReadinessGate([{ status: "PARTIALLY_ISSUED" }], 100, true);
    assert.equal(g.gate, "READY_FOR_PRODUCTION");
  });

  it("resolveReadinessGate - ready for production when fully issued and released", () => {
    const g = resolveReadinessGate([{ status: "FULLY_ISSUED" }, { status: "FULLY_ISSUED" }], 500, true);
    assert.equal(g.gate, "READY_FOR_PRODUCTION");
  });

  it("resolveReadinessGate - waiting release when lines meet required but not released", () => {
    const g = resolveReadinessGate(
      [
        {
          status: "PARTIALLY_ISSUED",
          lines: [
            { requiredQty: "12.792", issuedQty: "12.792" },
            { requiredQty: "5", issuedQty: "5.1" },
          ],
        },
      ],
      17.892,
      false,
    );
    assert.equal(g.gate, "WAITING_RELEASE_TO_PRODUCTION");
  });

  it("resolveReadinessGate - ready when store issue is complete and PMR-linked material issue exists", () => {
    const pmrs = [
      {
        status: "FULLY_ISSUED",
        lines: [{ requiredQty: "10", issuedQty: "10", waivedQty: "0" }],
        materialIssueNotes: [{ id: 9001, docNo: "MIN-26-0001" }],
      },
    ];
    const g = resolveReadinessGate(pmrs, 10, false);
    assert.equal(hasCompletedStoreIssueTransfer(pmrs), true);
    assert.equal(g.gate, "READY_FOR_PRODUCTION");
    assert.equal(g.releasedByIssueTransfer, true);
  });

  it("resolveReadinessGate - ready when short issue is accepted and material issue exists", () => {
    const pmrs = [
      {
        status: "SHORT_ISSUE_ACCEPTED",
        lines: [{ requiredQty: "10", issuedQty: "8", waivedQty: "2" }],
        materialIssueNotes: [{ id: 9002, docNo: "MIN-26-0002" }],
      },
    ];
    const g = resolveReadinessGate(pmrs, 8, false);
    assert.equal(g.gate, "READY_FOR_PRODUCTION");
    assert.equal(g.releasedByIssueTransfer, true);
  });

  it("resolveReadinessGate - does not use material issue transfer when PMR is still short", () => {
    const pmrs = [
      {
        status: "PARTIALLY_ISSUED",
        lines: [{ requiredQty: "10", issuedQty: "8", waivedQty: "0" }],
        materialIssueNotes: [{ id: 9003, docNo: "MIN-26-0003" }],
      },
    ];
    const g = resolveReadinessGate(pmrs, 8, false);
    assert.equal(hasCompletedStoreIssueTransfer(pmrs), false);
    assert.equal(g.gate, "WAITING_RELEASE_TO_PRODUCTION");
  });

  it("resolveReadinessGate - waiting release when a line is still short", () => {
    const g = resolveReadinessGate(
      [
        {
          status: "PARTIALLY_ISSUED",
          lines: [{ requiredQty: "10", issuedQty: "8" }],
        },
      ],
      8,
      false,
    );
    assert.equal(g.gate, "WAITING_RELEASE_TO_PRODUCTION");
  });

  it("loadGrossIssuedByWorkOrder includes SHORT_ISSUE_ACCEPTED PMRs", async () => {
    let seenStatusFilter = [];
    const db = {
      productionMaterialRequest: {
        findMany: async (args) => {
          seenStatusFilter = args.where.status.in;
          return [
            {
              status: "SHORT_ISSUE_ACCEPTED",
              lines: [{ itemId: 10, issuedQty: "8" }],
            },
          ];
        },
      },
      materialIssueNote: {
        findMany: async () => [],
      },
    };
    const issued = await loadGrossIssuedByWorkOrder(db, 260004);
    assert.ok(seenStatusFilter.includes("SHORT_ISSUE_ACCEPTED"));
    assert.equal(issued.get(10), 8);
  });

  it("aggregatePmrRequiredByItem sums submitted PMR lines", () => {
    const map = aggregatePmrRequiredByItem([
      {
        lines: [
          { itemId: 10, requiredQty: "3.9" },
          { itemId: 10, requiredQty: 0 },
        ],
      },
      {
        lines: [{ itemId: 20, requiredQty: 2.34 }],
      },
    ]);
    assert.equal(map.get(10), 3.9);
    assert.equal(map.get(20), 2.34);
  });

  it("Dummy Plug — full PMR issue allows full WO production (1500)", () => {
    const max = computeMaxProducibleFromPmrBasis({
      woQty: 1500,
      totalWoQty: 1500,
      pmrRequiredByItem: new Map([[101, 3.9]]),
      availableByItem: new Map([[101, 3.9]]),
    });
    assert.equal(max, 1500);
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 1500,
        productionAllowedNowQty: max,
      }),
      false,
    );
  });

  it("Square Box — full PMR issue allows full WO production (500)", () => {
    const max = computeMaxProducibleFromPmrBasis({
      woQty: 500,
      totalWoQty: 500,
      pmrRequiredByItem: new Map([[102, 2.34]]),
      availableByItem: new Map([[102, 2.34]]),
    });
    assert.equal(max, 500);
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 500,
        productionAllowedNowQty: max,
      }),
      false,
    );
  });

  it("partial PMR issue limits production proportionally", () => {
    const max = computeMaxProducibleFromPmrBasis({
      woQty: 1500,
      totalWoQty: 1500,
      pmrRequiredByItem: new Map([[101, 3.9]]),
      availableByItem: new Map([[101, 1.95]]),
    });
    assert.equal(max, 750);
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 751,
        productionAllowedNowQty: max,
      }),
      true,
    );
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 750,
        productionAllowedNowQty: max,
      }),
      false,
    );
  });

  it("NO_QTY surplus: PMR basis can exceed WO qty when extra RM is issued", () => {
    const max = computeMaxProducibleFromPmrBasis({
      woQty: 4000,
      totalWoQty: 4000,
      pmrRequiredByItem: new Map([[10, 100]]),
      availableByItem: new Map([[10, 105]]),
      allowSurplus: true,
    });
    assert.equal(max, 4200);
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 4200,
        productionAllowedNowQty: max,
      }),
      false,
    );
  });

  it("REGULAR PMR basis stays capped at WO qty without allowSurplus", () => {
    const max = computeMaxProducibleFromPmrBasis({
      woQty: 4000,
      totalWoQty: 4000,
      pmrRequiredByItem: new Map([[10, 100]]),
      availableByItem: new Map([[10, 105]]),
      allowSurplus: false,
    });
    assert.equal(max, 4000);
  });

  it("incremental batch validation allows remaining WO qty when RM headroom is higher", () => {
    const batchAllowed = 350;
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 350,
        productionAllowedNowQty: batchAllowed,
        otherUnapprovedQty: 0,
      }),
      false,
    );
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 351,
        productionAllowedNowQty: batchAllowed,
        otherUnapprovedQty: 0,
      }),
      true,
    );
  });

  it("rejects cumulative NO_QTY misuse — batch cap is not lifetime produced total", () => {
    const batchAllowed = 350;
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 350,
        productionAllowedNowQty: batchAllowed,
        otherUnapprovedQty: 0,
      }),
      false,
    );
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 3500,
        productionAllowedNowQty: 482,
        otherUnapprovedQty: 0,
      }),
      true,
    );
  });

  it("PMR basis uses scarcest RM when multiple PMR lines exist", () => {
    const max = computeMaxProducibleFromPmrBasis({
      woQty: 1000,
      totalWoQty: 1000,
      pmrRequiredByItem: new Map([
        [10, 4000],
        [11, 3000],
      ]),
      availableByItem: new Map([
        [10, 4000],
        [11, 1500],
      ]),
    });
    assert.equal(max, 500);
  });

  it("BOM per-unit would under-count vs PMR — PMR basis restores full WO qty", () => {
    const issuedKg = 3.9;
    const woQty = 1500;
    const pmrRequiredKg = 3.9;
    const bomPerFgKg = 0.003;
    const bomCap = floorFgQty(issuedKg, bomPerFgKg);
    const pmrCap = computeMaxProducibleFromPmrBasis({
      woQty,
      totalWoQty: woQty,
      pmrRequiredByItem: new Map([[101, pmrRequiredKg]]),
      availableByItem: new Map([[101, issuedKg]]),
    });
    assert.equal(bomCap, 1300);
    assert.equal(pmrCap, 1500);
  });

  it("Square Box — BOM per-unit 5g would cap at 468; PMR basis allows 500", () => {
    const issuedKg = 2.34;
    const woQty = 500;
    const pmrRequiredKg = 2.34;
    const bomPerFgKg = 0.005;
    const bomCap = floorFgQty(issuedKg, bomPerFgKg);
    const pmrCap = computeMaxProducibleFromPmrBasis({
      woQty,
      totalWoQty: woQty,
      pmrRequiredByItem: new Map([[102, pmrRequiredKg]]),
      availableByItem: new Map([[102, issuedKg]]),
    });
    assert.equal(bomCap, 468);
    assert.equal(pmrCap, 500);
  });

  it("resolveWorkOrderLinePlannedQty prefers plannedQty over zero qty", () => {
    assert.equal(resolveWorkOrderLinePlannedQty({ qty: 0, plannedQty: 2500 }), 2500);
    assert.equal(resolveWorkOrderLinePlannedQty({ qty: 1500, plannedQty: null }), 1500);
    assert.equal(resolveWorkOrderLinePlannedQty({ qty: 0, plannedQty: 0 }), 0);
  });

  it("NO_QTY PMR basis allows full planned WO qty when issued RM matches PMR", () => {
    const woQty = 2500;
    const max = computeMaxProducibleFromPmrBasis({
      woQty,
      totalWoQty: woQty,
      pmrRequiredByItem: new Map([[101, 12.5]]),
      availableByItem: new Map([[101, 12.5]]),
      allowSurplus: true,
    });
    assert.equal(max, 2500);
  });

  it("computeMaxProducibleFromPmrBasis returns null when woQty is zero (planned qty must be used upstream)", () => {
    const max = computeMaxProducibleFromPmrBasis({
      woQty: 0,
      totalWoQty: 2500,
      pmrRequiredByItem: new Map([[101, 12.5]]),
      availableByItem: new Map([[101, 12.5]]),
      allowSurplus: true,
    });
    assert.equal(max, null);
  });

  it("resolveProductionBatchRmCap allows approving draft when RM supports full WO qty", () => {
    const readiness = {
      orderType: "NO_QTY",
      woQty: 2500,
      woRemainingQty: 2500,
      productionAllowedNowQty: 2500,
      maxAdditionalQty: 0,
    };
    const cap = resolveProductionBatchRmCap(readiness, 0);
    assert.equal(cap, 2500);
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 2500,
        productionAllowedNowQty: cap,
        otherUnapprovedQty: 0,
      }),
      false,
    );
  });

  it("resolveProductionBatchRmCap exposes the RM envelope; caller reserves other drafts once", () => {
    const readiness = {
      orderType: "NO_QTY",
      woQty: 2500,
      woRemainingQty: 2500,
      productionAllowedNowQty: 2500,
      maxAdditionalQty: 0,
    };
    const capWhenApprovingOwnDraft = resolveProductionBatchRmCap(readiness, 0);
    assert.equal(capWhenApprovingOwnDraft, 2500);
    const capWithOtherDraft = resolveProductionBatchRmCap(readiness, 500);
    assert.equal(capWithOtherDraft, 2500);
    assert.equal(productionQtyExceedsRmAllowed({ producedQty: 2000, productionAllowedNowQty: capWithOtherDraft, otherUnapprovedQty: 500 }), false);
    assert.equal(productionQtyExceedsRmAllowed({ producedQty: 2001, productionAllowedNowQty: capWithOtherDraft, otherUnapprovedQty: 500 }), true);
  });

  it("A: NO_QTY WO 2000, RM capacity 2050, production 2020 is allowed", () => {
    const cap = computeMaxProducibleFromPmrBasis({
      woQty: 2000,
      totalWoQty: 2000,
      pmrRequiredByItem: new Map([[10, 20]]),
      availableByItem: new Map([[10, 20.5]]),
      allowSurplus: true,
    });
    assert.equal(cap, 2050);
    assert.equal(productionQtyExceedsRmAllowed({ producedQty: 2020, productionAllowedNowQty: cap }), false);
  });

  it("B: NO_QTY WO 2000, RM capacity 2000, production 2020 is blocked", () => {
    assert.equal(productionQtyExceedsRmAllowed({ producedQty: 2020, productionAllowedNowQty: 2000 }), true);
  });

  it("C/D: after 1900 approved, remaining RM supports 150 but not 151", () => {
    assert.equal(productionQtyExceedsRmAllowed({ producedQty: 150, productionAllowedNowQty: 150 }), false);
    assert.equal(productionQtyExceedsRmAllowed({ producedQty: 151, productionAllowedNowQty: 150 }), true);
  });

  it("E: returned RM reduces remaining FG capacity", () => {
    assert.equal(floorFgQty(1.5, 0.01), 150);
    assert.equal(floorFgQty(1.4, 0.01), 140);
  });

  it("WO capacity never falls back to unrelated production-location stock", () => {
    assert.equal(resolveWoIssuedAvailableQty({ grossIssued: 10, consumed: 8, returned: 1, onHand: 50 }), 1);
    assert.equal(resolveWoIssuedAvailableQty({ grossIssued: 10, consumed: 9, returned: 1, onHand: 50 }), 0);
  });

  it("resolveProductionBatchRmCap partial issue caps supported qty", () => {
    const readiness = {
      orderType: "NO_QTY",
      woQty: 2500,
      woRemainingQty: 2500,
      productionAllowedNowQty: 1000,
      maxAdditionalQty: 0,
    };
    assert.equal(resolveProductionBatchRmCap(readiness, 0), 1000);
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 1001,
        productionAllowedNowQty: 1000,
        otherUnapprovedQty: 0,
      }),
      true,
    );
  });

  it("REGULAR WO resolveProductionBatchRmCap uses RM ceiling only", () => {
    const readiness = {
      orderType: "NORMAL",
      woQty: 2500,
      woRemainingQty: 2500,
      productionAllowedNowQty: 2000,
      maxAdditionalQty: 1500,
    };
    assert.equal(resolveProductionBatchRmCap(readiness, 500), 2000);
  });

  it("no RM issue blocks approval via zero productionAllowedNowQty", () => {
    const readiness = {
      orderType: "NO_QTY",
      woQty: 2500,
      woRemainingQty: 2500,
      productionAllowedNowQty: 0,
      gate: "WAITING_STORE_ISSUE",
    };
    assert.equal(resolveProductionBatchRmCap(readiness, 0), 0);
    assert.equal(
      productionQtyExceedsRmAllowed({
        producedQty: 1,
        productionAllowedNowQty: 0,
        otherUnapprovedQty: 0,
      }),
      true,
    );
  });
});
