function buildRequirementSheetHref(salesOrderId, { sheetId, cycleId, focusExecution = false } = {}) {
  const params = new URLSearchParams();
  params.set("source", "no_qty_so");
  params.set("salesOrderId", String(salesOrderId));
  if (sheetId != null && Number(sheetId) > 0) params.set("sheetId", String(sheetId));
  if (cycleId != null && Number(cycleId) > 0) params.set("cycleId", String(cycleId));
  if (focusExecution) params.set("focus", "execution");
  const qs = params.toString();
  return qs
    ? `/sales-orders/${salesOrderId}/requirement-sheets?${qs}`
    : `/sales-orders/${salesOrderId}/requirement-sheets`;
}

module.exports = {
  buildRequirementSheetHref,
};
