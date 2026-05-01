/**
 * Planning gap% vs threshold zones — no DB.
 * Run: npm test
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { Prisma } = require("@prisma/client");
const {
  DEFAULT_RED_THRESHOLD_PCT,
  DEFAULT_YELLOW_THRESHOLD_PCT,
  DEFAULT_ORDER_WISE_RED_BOUNDARY_PCT,
  DEFAULT_ORDER_WISE_YELLOW_BOUNDARY_PCT,
  toFiniteNumber,
  classifyPlanningZone,
  resolveOrderWiseBoundariesFromLegacyDbFields,
  resolveProductWiseBoundariesFromItem,
  computeZone,
  computeZoneItemWise,
} = require("../src/services/planningThresholds");

describe("classifyPlanningZone — unified rule: >= red ⇒ RED; else >= yellow ⇒ YELLOW; else GREEN", () => {
  it("higher gap% is worse (red before yellow before green)", () => {
    assert.equal(classifyPlanningZone(25, 10, 5), "RED");
    assert.equal(classifyPlanningZone(8, 10, 5), "YELLOW");
    assert.equal(classifyPlanningZone(3, 10, 5), "GREEN");
  });

  it("exact equality uses inclusive boundaries (>=)", () => {
    assert.equal(classifyPlanningZone(10, 10, 5), "RED");
    assert.equal(classifyPlanningZone(5, 10, 5), "YELLOW");
    assert.equal(classifyPlanningZone(4.99, 10, 5), "GREEN");
  });

  it("negative gap (excess stock) is EXCESS", () => {
    assert.equal(classifyPlanningZone(-1, 10, 5), "EXCESS");
  });
});

describe("computeZone (order-wise) — legacy DB columns mapped to red/yellow boundaries", () => {
  it("matches classifyPlanningZone after mapping defaults 50/30", () => {
    assert.equal(computeZone(60, 50, 30), "RED");
    assert.equal(computeZone(40, 50, 30), "YELLOW");
    assert.equal(computeZone(20, 50, 30), "GREEN");
  });
});

/**
 * Regression: zone logic used strict inequality (gap > red) for RED, so gap === red fell through to YELLOW.
 * Unified inclusive rule (gap >= red) matches product-wise and requirement-sheet UX: exact boundary hits that zone.
 */
describe("Regression — inclusive thresholds vs historical strict-inequality behavior", () => {
  it("exact red boundary returns RED; exact yellow boundary returns YELLOW (50/30 item thresholds)", () => {
    assert.equal(
      computeZone(50, 50, 30),
      "RED",
      "gap 50% with red boundary 50% must be RED (historically was YELLOW when red used strict >)",
    );
    assert.equal(
      computeZone(30, 50, 30),
      "YELLOW",
      "gap 30% with yellow boundary 30% must be YELLOW (historically was GREEN when yellow used strict >)",
    );
  });
});

describe("resolveOrderWiseBoundariesFromLegacyDbFields", () => {
  it("maps misnamed planningGapGreen… to redBoundaryPercent", () => {
    const b = resolveOrderWiseBoundariesFromLegacyDbFields(
      new Prisma.Decimal("50"),
      new Prisma.Decimal("30"),
    );
    assert.equal(b.redBoundaryPercent, 50);
    assert.equal(b.yellowBoundaryPercent, 30);
  });
});

describe("prisma Decimal and string thresholds", () => {
  it("toFiniteNumber accepts Prisma.Decimal", () => {
    assert.equal(toFiniteNumber(new Prisma.Decimal("12.5")), 12.5);
  });

  it("computeZoneItemWise uses Decimal like API-loaded Item rows", () => {
    assert.equal(computeZoneItemWise(25, new Prisma.Decimal("10"), new Prisma.Decimal("5")), "RED");
    assert.equal(computeZoneItemWise(7, new Prisma.Decimal("10"), new Prisma.Decimal("5")), "YELLOW");
  });

  it("computeZone accepts string thresholds (JSON serialization)", () => {
    assert.equal(computeZone(45, "50", "30"), "YELLOW");
    assert.equal(computeZoneItemWise(10, "10", "5"), "RED");
    assert.equal(computeZoneItemWise(9, "10", "5"), "YELLOW");
  });
});

describe("computeZoneItemWise — null raw thresholds → defaults 10 / 5", () => {
  it("uses DEFAULT_RED_THRESHOLD_PCT and DEFAULT_YELLOW_THRESHOLD_PCT", () => {
    assert.equal(DEFAULT_RED_THRESHOLD_PCT, 10);
    assert.equal(DEFAULT_YELLOW_THRESHOLD_PCT, 5);
    assert.equal(computeZoneItemWise(10, null, null), "RED");
    assert.equal(computeZoneItemWise(9, null, null), "YELLOW");
    assert.equal(computeZoneItemWise(4, null, null), "GREEN");
  });
});

describe("resolveProductWiseBoundariesFromItem", () => {
  it("prefers redThresholdPercent over legacy planning gap red column", () => {
    const b = resolveProductWiseBoundariesFromItem({
      redThresholdPercent: 15,
      yellowThresholdPercent: 8,
      legacyPlanningGapRedBoundaryPercent: 50,
      legacyPlanningGapYellowBoundaryPercent: 30,
    });
    assert.equal(b.redBoundaryPercent, 15);
    assert.equal(b.yellowBoundaryPercent, 8);
  });

  it("falls back to legacy gap columns when new fields are null", () => {
    const b = resolveProductWiseBoundariesFromItem({
      redThresholdPercent: null,
      yellowThresholdPercent: null,
      legacyPlanningGapRedBoundaryPercent: 40,
      legacyPlanningGapYellowBoundaryPercent: 20,
    });
    assert.equal(b.redBoundaryPercent, 40);
    assert.equal(b.yellowBoundaryPercent, 20);
  });

  it("RM-style all null → server defaults 10 / 5", () => {
    const b = resolveProductWiseBoundariesFromItem({
      redThresholdPercent: null,
      yellowThresholdPercent: null,
      legacyPlanningGapRedBoundaryPercent: null,
      legacyPlanningGapYellowBoundaryPercent: null,
    });
    assert.equal(b.redBoundaryPercent, 10);
    assert.equal(b.yellowBoundaryPercent, 5);
  });
});

describe("order-wise undefined thresholds → defaults 50 / 30", () => {
  it("computeZone uses DEFAULT_ORDER_WISE boundaries when thresholds are undefined", () => {
    assert.equal(DEFAULT_ORDER_WISE_RED_BOUNDARY_PCT, 50);
    assert.equal(DEFAULT_ORDER_WISE_YELLOW_BOUNDARY_PCT, 30);
    assert.equal(computeZone(55, undefined, undefined), "RED");
    assert.equal(computeZone(35, undefined, undefined), "YELLOW");
    assert.equal(computeZone(20, undefined, undefined), "GREEN");
  });

  it("gap equal to default yellow (30) is YELLOW", () => {
    assert.equal(computeZone(30, undefined, undefined), "YELLOW");
  });
});
