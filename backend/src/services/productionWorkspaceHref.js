const { GREEN_LEVEL_WO_SOURCE_TYPE } = require("./greenLevelWorkOrderService");
const { PRODUCTION_EXECUTION_PENDING_LABELS } = require("./productionExecutionService");

function productionBucketForPendingActionLabel(actionLabel) {
  const label = String(actionLabel ?? "").trim();
  if (label === PRODUCTION_EXECUTION_PENDING_LABELS.NOT_STARTED) return "readyToStart";
  if (label === PRODUCTION_EXECUTION_PENDING_LABELS.RUNNING) return "inProgress";
  return null;
}

function buildProductionWorkspaceHrefFromPendingMeta(meta = {}, from = "pending-actions", options = {}) {
  const workOrderId = Number(meta.workOrderId ?? 0);
  const workOrderLineId = Number(meta.workOrderLineId ?? 0);
  const salesOrderId = Number(meta.salesOrderId ?? 0);
  const cycleId = Number(meta.cycleId ?? 0);
  const sourceType = String(meta.sourceType ?? "").trim().toUpperCase();
  const orderType = String(meta.orderType ?? "").trim().toUpperCase();
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (workOrderId > 0) params.set("workOrderId", String(workOrderId));
  if (workOrderLineId > 0) params.set("workOrderLineId", String(workOrderLineId));
  const bucket =
    options.productionBucket ??
    productionBucketForPendingActionLabel(options.actionLabel) ??
    null;
  if (bucket) params.set("productionBucket", bucket);
  if (sourceType === GREEN_LEVEL_WO_SOURCE_TYPE || orderType === "GREEN_LEVEL") {
    params.set("flow", "GREEN_LEVEL");
    return `/production?${params.toString()}`;
  }
  if (orderType === "NO_QTY" && salesOrderId > 0) {
    params.set("flow", "NO_QTY");
    params.set("salesOrderId", String(salesOrderId));
    params.set("source", "no_qty_so");
    if (cycleId > 0) params.set("cycleId", String(cycleId));
    return `/production?${params.toString()}`;
  }
  if (salesOrderId > 0) {
    params.set("flow", "REGULAR_SO");
    params.set("salesOrderId", String(salesOrderId));
  }
  return `/production?${params.toString()}`;
}

function appendProductionBucketToProductionHref(href, actionLabel) {
  const bucket = productionBucketForPendingActionLabel(actionLabel);
  if (!bucket) return href;
  try {
    const url = new URL(href, "http://erp.local");
    if (!url.pathname.endsWith("/production")) return href;
    url.searchParams.set("productionBucket", bucket);
    if (url.searchParams.has("returnTo") && !url.searchParams.has("from")) {
      url.searchParams.set("from", url.searchParams.get("returnTo"));
      url.searchParams.delete("returnTo");
    }
    return `${url.pathname}?${url.searchParams.toString()}`;
  } catch {
    return href;
  }
}

module.exports = {
  appendProductionBucketToProductionHref,
  buildProductionWorkspaceHrefFromPendingMeta,
  productionBucketForPendingActionLabel,
};
