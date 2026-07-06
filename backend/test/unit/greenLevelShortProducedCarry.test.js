const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveGreenShortageForPlanning,
  loadGreenLevelShortProducedCarryByItem,
} = require("../../src/services/greenLevelShortProducedCarryService");

describe("greenLevelShortProducedCarryService", () => {
  it("resolveGreenShortageForPlanning uses max to avoid double-counting stock gap and carry", () => {
    // WO planned 3000, produced 2868 — stock gap and carry both 132
    assert.equal(resolveGreenShortageForPlanning(132, 132), 132);
    // Stock not yet updated; carry should not inflate beyond stock gap
    assert.equal(resolveGreenShortageForPlanning(3000, 132), 3000);
    // At green target — carry absorbed; no phantom shortage after replenishment
    assert.equal(resolveGreenShortageForPlanning(0, 132), 0);
    assert.equal(resolveGreenShortageForPlanning(0, 0), 0);
    // Carry can raise planning qty when stock gap understates short-produced obligation
    assert.equal(resolveGreenShortageForPlanning(100, 132), 132);
  });

  it("loadGreenLevelShortProducedCarryByItem sums CARRY_FORWARD on completed GL WOs", async () => {
    const db = {
      productionShortfallResolution: {
        findMany: async () => [
          {
            remainderQty: "132",
            workOrderLine: { fgItemId: 101 },
          },
          {
            remainderQty: "50",
            workOrderLine: { fgItemId: 101 },
          },
          {
            remainderQty: "20",
            workOrderLine: { fgItemId: 202 },
          },
        ],
      },
    };

    const map = await loadGreenLevelShortProducedCarryByItem(db);
    assert.equal(map.get(101), 182);
    assert.equal(map.get(202), 20);
  });
});
