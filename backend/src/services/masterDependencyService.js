/**
 * Central, read-only dependency analysis for destructive master-data actions.
 * Counts are intentionally conservative: uncertainty blocks deletion.
 */

async function count(db, model, where) {
  if (!db[model] || typeof db[model].count !== "function") {
    throw new Error(`Dependency checker is missing Prisma model ${model}`);
  }
  return db[model].count({ where });
}

function summarize(entityType, entity, rows) {
  const dependencies = rows.filter((row) => Number(row.count) > 0);
  return {
    entityType,
    entityId: entity.id,
    entityName: entity.itemName || entity.docNo || `#${entity.id}`,
    safeToDelete: dependencies.length === 0,
    canDeactivate: true,
    totalDependencies: dependencies.reduce((sum, row) => sum + Number(row.count), 0),
    dependencies,
  };
}

async function buildBomDependencySummary(db, bomOrId) {
  const bom = typeof bomOrId === "object"
    ? bomOrId
    : await db.bom.findUnique({
        where: { id: Number(bomOrId) },
        include: { fgItem: { select: { itemName: true } } },
      });
  if (!bom) return null;
  const fgItemId = bom.fgItemId;
  const specs = [
    ["monthlyPlanning", "Monthly Planning", "monthlyProductionPlanLine", { fgItemId }],
    ["monthlyPlanRevisions", "Monthly Plan Revisions", "monthlyProductionPlanRevisionLine", { fgItemId }],
    ["planningCoverage", "Planning Coverage", "monthlyPlanRequirementCoverage", { fgItemId }],
    ["workOrders", "Work Orders", "workOrderLine", { fgItemId }],
    ["pmrs", "PMRs", "productionMaterialRequest", { workOrder: { lines: { some: { fgItemId } } } }],
    ["materialIssues", "Material Issues", "materialIssueNote", { workOrder: { lines: { some: { fgItemId } } } }],
    ["productionEntries", "Production Entries", "productionEntry", { workOrderLine: { fgItemId } }],
    ["qcEntries", "QC Entries", "qcEntry", { production: { workOrderLine: { fgItemId } } }],
    ["dispatches", "Dispatches", "dispatch", { itemId: fgItemId }],
  ];
  const values = await Promise.all(specs.map(async ([key, label, model, where]) => ({
    key, label, count: await count(db, model, where),
  })));
  const summary = summarize("BOM", {
    ...bom,
    itemName: `${bom.docNo || "BOM"} Rev ${bom.revisionNo} — ${bom.fgItem?.itemName || `Item ${fgItemId}`}`,
  }, values);
  return { ...summary, status: bom.status, revisionNo: bom.revisionNo, approvedAt: bom.approvedAt };
}

async function buildItemDependencySummary(db, itemOrId) {
  const item = typeof itemOrId === "object"
    ? itemOrId
    : await db.item.findUnique({ where: { id: Number(itemOrId) } });
  if (!item) return null;
  const id = item.id;
  const specs = [
    ["bomsFg", "BOMs (Finished Good)", "bom", { fgItemId: id }],
    ["bomsRm", "BOM Components", "bomLine", { rmItemId: id }],
    ["monthlyPlanning", "Monthly Planning", "monthlyProductionPlanLine", { fgItemId: id }],
    ["monthlyPlanRevisions", "Monthly Plan Revisions", "monthlyProductionPlanRevisionLine", { fgItemId: id }],
    ["planningCoverage", "Planning Coverage", "monthlyPlanRequirementCoverage", { fgItemId: id }],
    ["rmPlanning", "RM Planning", "rmPlanLine", { rmItemId: id }],
    ["workOrders", "Work Orders", "workOrderLine", { fgItemId: id }],
    ["pmrLines", "PMR Lines", "productionMaterialRequestLine", { itemId: id }],
    ["materialIssues", "Material Issue Lines", "materialIssueLine", { itemId: id }],
    ["materialReturns", "Material Returns", "materialReturnLine", { itemId: id }],
    ["materialWastage", "Material Wastage Notes", "materialWastageNote", { itemId: id }],
    ["productionRm", "Production RM Consumption", "productionEntryRmConsumption", { itemId: id }],
    ["productionFg", "Production Entries", "productionEntry", { workOrderLine: { fgItemId: id } }],
    ["productionReports", "Production Reports", "productionWorkOrderReportLine", { itemId: id }],
    ["productionRmReturn", "Production RM Return Pending", "productionRmReturnPending", { itemId: id }],
    ["qcEntries", "QC Entries", "qcEntry", { production: { workOrderLine: { fgItemId: id } } }],
    ["qcRejections", "QC Rejected Dispositions", "qcRejectedDisposition", { itemId: id }],
    ["qcLegacy", "QC Legacy Classifications", "qcLegacyRejectedClassification", { itemId: id }],
    ["stockAdjustmentQc", "Stock Adjustment QC", "stockAdjustmentQcEntry", { itemId: id }],
    ["scrap", "Scrap Records", "scrapRecord", { fgItemId: id }],
    ["dispatches", "Dispatches", "dispatch", { itemId: id }],
    ["purchaseOrders", "Purchase Orders", "rmPurchaseOrderLine", { itemId: id }],
    ["purchaseRequests", "Purchase Requests", "purchaseRequestLine", { rmItemId: id }],
    ["purchaseBills", "Purchase Bills", "purchaseBillLine", { itemId: id }],
    ["inventoryTransactions", "Inventory Transactions", "stockTransaction", { itemId: id }],
    ["openingStock", "Opening Stock", "openingStockEntry", { itemId: id }],
    ["salesOrders", "Sales Orders", "salesOrderLine", { itemId: id }],
    ["salesBills", "Sales Bills", "salesBillLine", { itemId: id }],
    ["enquiries", "Enquiries", "enquiryLine", { itemId: id }],
    ["quotations", "Quotations", "quotationLine", { itemId: id }],
    ["customerPos", "Customer POs", "customerPOLine", { itemId: id }],
    ["rateContracts", "Rate Contracts", "rateContractLine", { itemId: id }],
    ["materialRequirements", "Material Requirements", "materialRequirementLine", { rmItemId: id }],
    ["requirementsAsFg", "FG Material Requirements", "materialRequirement", { fgItemId: id }],
    ["requirementSheets", "Requirement Sheets", "requirementSheetLine", { itemId: id }],
    ["allocations", "Material Allocations", "materialAllocation", { rmItemId: id }],
    ["customerReturns", "Customer Returns", "customerReturn", { itemId: id }],
    ["carryForward", "Carry Forward Pending", "carryForwardPending", { itemId: id }],
    ["recoveryDecisions", "NO_QTY Recovery Decisions", "noQtyRsItemRecoveryDecision", { itemId: id }],
    ["closedShortages", "NO_QTY Closed Shortages", "noQtySoClosedShortageLine", { itemId: id }],
    ["waivers", "NO_QTY Waivers", "noQtySoWaiverLine", { itemId: id }],
    ["acceptedFg", "NO_QTY Accepted FG", "noQtyAcceptedFgDisposition", { itemId: id }],
  ];
  const values = await Promise.all(specs.map(async ([key, label, model, where]) => ({
    key, label, count: await count(db, model, where),
  })));
  return { ...summarize("ITEM", item, values), isActive: item.isActive !== false };
}

module.exports = { buildBomDependencySummary, buildItemDependencySummary, summarize };
