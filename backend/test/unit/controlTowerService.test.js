const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildEmptyPanelMetricsData,
  validatePanelMetricsShape,
} = require("../../src/services/controlTowerService");

describe("controlTowerService (Prompt 1 — panel shape)", () => {
  it("buildEmptyPanelMetricsData includes all approved section keys", () => {
    const data = buildEmptyPanelMetricsData();
    assert.equal(validatePanelMetricsShape(data), true);

    assert.ok("liveFactoryPanel" in data);
    assert.ok("liveProcessBoard" in data);
    assert.ok("criticalAlerts" in data);
    assert.ok("noQtyControlPanel" in data);
    assert.ok("commercialControl" in data);
    assert.ok("roleBasedQueues" in data);

    assert.equal(data.roleBasedQueues.admin, null);
    assert.equal(data.roleBasedQueues.store, null);
    assert.equal(data.commercialControl.billingPending, null);
  });

  it("validatePanelMetricsShape rejects incomplete payloads", () => {
    assert.equal(validatePanelMetricsShape(null), false);
    assert.equal(validatePanelMetricsShape({ liveFactoryPanel: {} }), false);
    assert.equal(validatePanelMetricsShape(buildEmptyPanelMetricsData()), true);
  });
});
