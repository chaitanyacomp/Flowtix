const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  appendProductionBucketToProductionHref,
  buildProductionWorkspaceHrefFromPendingMeta,
  productionBucketForPendingActionLabel,
} = require("../../src/services/productionWorkspaceHref");
const { PRODUCTION_EXECUTION_PENDING_LABELS } = require("../../src/services/productionExecutionService");

describe("productionWorkspaceHref", () => {
  it("maps pending action labels to production bucket filters", () => {
    assert.equal(
      productionBucketForPendingActionLabel(PRODUCTION_EXECUTION_PENDING_LABELS.NOT_STARTED),
      "readyToStart",
    );
    assert.equal(
      productionBucketForPendingActionLabel(PRODUCTION_EXECUTION_PENDING_LABELS.RUNNING),
      "inProgress",
    );
  });

  it("builds scoped NO_QTY production workspace href with bucket", () => {
    const href = buildProductionWorkspaceHrefFromPendingMeta(
      {
        workOrderId: 307,
        workOrderLineId: 410,
        salesOrderId: 5,
        cycleId: 12,
        orderType: "NO_QTY",
      },
      "pending-actions",
      { actionLabel: PRODUCTION_EXECUTION_PENDING_LABELS.RUNNING },
    );
    assert.match(href, /productionBucket=inProgress/);
    assert.match(href, /pwSection=active/);
    assert.match(href, /workOrderId=307/);
    assert.match(href, /flow=NO_QTY/);
    assert.match(href, /from=pending-actions/);
  });

  it("appends bucket and normalizes returnTo to from on legacy production hrefs", () => {
    const href = appendProductionBucketToProductionHref(
      "/production?returnTo=pending-actions&workOrderId=1",
      PRODUCTION_EXECUTION_PENDING_LABELS.NOT_STARTED,
    );
    assert.match(href, /productionBucket=readyToStart/);
    assert.match(href, /pwSection=ready/);
    assert.match(href, /from=pending-actions/);
    assert.doesNotMatch(href, /returnTo=/);
  });

  it("routes Complete Production Report to exact WO report-pending (not Continue bucket)", () => {
    const href = buildProductionWorkspaceHrefFromPendingMeta(
      {
        workOrderId: 260001,
        workOrderLineId: 1,
        salesOrderId: 5,
        cycleId: 12,
        orderType: "NO_QTY",
        productionExecutionStatus: "SHORTFALL_PENDING",
        sourceNextAction: "PRODUCTION_SHORTFALL_DECISION",
      },
      "pending-actions",
      { actionLabel: PRODUCTION_EXECUTION_PENDING_LABELS.SHORTFALL_PENDING },
    );
    assert.match(href, /pwSection=reportPending/);
    assert.match(href, /focusReport=1/);
    assert.match(href, /workOrderId=260001/);
    assert.match(href, /from=pending-actions/);
    assert.match(href, /returnTo=pending-actions/);
    assert.doesNotMatch(href, /productionBucket=inProgress/);
    assert.doesNotMatch(href, /pwSection=active/);
  });
});
