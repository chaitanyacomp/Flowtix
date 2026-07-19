const test = require("node:test");
const assert = require("node:assert/strict");
const { derivePmrIssueQueueState } = require("../../src/services/productionMaterialRequestService");

test("REQUESTED with pending and no issued → READY_TO_ISSUE", () => {
  assert.equal(derivePmrIssueQueueState("REQUESTED", 0, 30), "READY_TO_ISSUE");
});

test("PARTIALLY_ISSUED status → PARTIALLY_ISSUED", () => {
  assert.equal(derivePmrIssueQueueState("PARTIALLY_ISSUED", 15, 15), "PARTIALLY_ISSUED");
});

test("derived partial from issued+pending even if status lagging", () => {
  assert.equal(derivePmrIssueQueueState("REQUESTED", 15, 15), "PARTIALLY_ISSUED");
});

test("FULLY_ISSUED → COMPLETE", () => {
  assert.equal(derivePmrIssueQueueState("FULLY_ISSUED", 30, 0), "COMPLETE");
});

test("SHORT_ISSUE_ACCEPTED → SHORT_CLOSED", () => {
  assert.equal(derivePmrIssueQueueState("SHORT_ISSUE_ACCEPTED", 15, 0), "SHORT_CLOSED");
});
