/**
 * Canonical transaction cleanup registry (SSOT).
 *
 * Every reset entry point must derive delete order from this registry.
 * When adding a Prisma model or Restrict FK, update this file — otherwise
 * `npm run verify:cleanup-dependencies` and unit tests fail.
 *
 * Kind:
 * - TRANSACTIONAL — deleted by Reset Transaction Data / scoped NO_QTY resets
 * - MASTER — preserved on transaction reset (listed for documentation / verify)
 * - SPECIAL — custom handler (e.g. opening stock revert, self-ref clear)
 */

/** @typedef {'TRANSACTIONAL' | 'MASTER' | 'SPECIAL'} CleanupKind */
/** @typedef {'GLOBAL' | 'NO_QTY_SCOPED' | 'MPRS' | 'FULL_DEMO'} CleanupProfile */

/**
 * @typedef {object} CleanupRegistryEntry
 * @property {string} prismaModel PascalCase Prisma model name
 * @property {string} clientKey camelCase Prisma client delegate key
 * @property {CleanupKind} kind
 * @property {number} phase Sort key within profile (lower = deleted earlier / children first)
 * @property {string[]} parentDeps Prisma model names this row Restrict-references (must delete after children)
 * @property {string} [notes]
 * @property {boolean} [verifyEmpty] Include in post-reset empty verification (default true for TRANSACTIONAL)
 * @property {CleanupProfile[]} [profiles] Which reset profiles must delete this (default TRANSACTIONAL profiles)
 */

/**
 * Master / auth data preserved by Reset Transaction Data.
 * Full Demo Reset may still wipe some of these — see FULL_DEMO_WIPED_MASTERS.
 */
const PRESERVED_MASTER_MODELS = Object.freeze([
  "User",
  "Item",
  "Unit",
  "Customer",
  "Supplier",
  "Location",
  "Bom",
  "BomComponent",
  "BomRevision",
  "AppSetting",
  "OpeningStockEntry",
  "RateContract",
  "RateContractLine",
  "AuditLog",
  "ActivityLog",
  "DocSequence",
  "WastageType",
  "Machine",
  "Operator",
  "State",
]);

/**
 * Masters wiped by Full Demo Reset (in addition to all TRANSACTIONAL rows).
 * Children that Restrict-reference these must be deleted earlier in the Full Demo plan.
 */
const FULL_DEMO_WIPED_MASTERS = Object.freeze([
  "Item",
  "Unit",
  "Customer",
  "Supplier",
  "Bom",
  "BomLine",
  "OpeningStockEntry",
  "RateContractLine",
  "CustomerPO",
  "CustomerPOLine",
]);

/**
 * Intentionally preserved on Full Demo Reset (users, settings, reference masters).
 */
const FULL_DEMO_PRESERVED_MODELS = Object.freeze([
  "User",
  "AppSetting",
  "State",
  "Location",
  "AuditLog",
  "ActivityLog",
  "WastageType",
  "Machine",
  "Operator",
]);

/**
 * Canonical child-first order for the NO_QTY recovery / waiver / CFP cluster.
 * Phase 2B: decision lines + decisions MUST precede CarryForwardPending (Restrict FKs).
 */
const RECOVERY_CLUSTER_CLIENT_KEYS = Object.freeze([
  "noQtyRsItemRecoveryDecisionLine",
  "noQtyRsItemRecoveryDecision",
  "recoveryAllocation",
  "noQtySoWaiverLine",
  "noQtySoWaiver",
  "noQtyAcceptedFgDisposition",
  "carryForwardPending",
  "productionShortfallResolution",
]);

/**
 * Full transactional delete order for Reset Transaction Data (children first).
 * `phase` is the authoritative sequence index.
 *
 * @type {CleanupRegistryEntry[]}
 */
const CLEANUP_REGISTRY = Object.freeze([
  // —— Commercial out ——
  { prismaModel: "SalesBillReceipt", clientKey: "salesBillReceipt", kind: "TRANSACTIONAL", phase: 10, parentDeps: ["SalesBill"] },
  { prismaModel: "SalesBillLine", clientKey: "salesBillLine", kind: "TRANSACTIONAL", phase: 20, parentDeps: ["SalesBill", "Item"] },
  {
    prismaModel: "SalesBillDispatchAllocation",
    clientKey: "salesBillDispatchAllocation",
    kind: "TRANSACTIONAL",
    phase: 25,
    parentDeps: ["SalesBill", "SalesBillLine", "Dispatch"],
    notes: "Restrict → Dispatch; must delete before Dispatch (Cascade from SalesBill alone is not enough).",
  },
  { prismaModel: "SalesBill", clientKey: "salesBill", kind: "TRANSACTIONAL", phase: 30, parentDeps: ["Dispatch", "SalesOrder", "Supplier"], notes: "Optional Restrict → Supplier (transporterId); wipe SalesBill before Supplier." },
  { prismaModel: "CustomerReturn", clientKey: "customerReturn", kind: "TRANSACTIONAL", phase: 40, parentDeps: ["SalesOrder"] },
  {
    prismaModel: "DispatchFgTraceAllocation",
    clientKey: "dispatchFgTraceAllocation",
    kind: "TRANSACTIONAL",
    phase: 45,
    parentDeps: ["Dispatch", "Item", "WorkOrder", "ProductionEntry", "QcEntry"],
    notes: "NO_QTY WO/QC FIFO trace children; Cascade from Dispatch, Restrict on Item — delete before Dispatch/Item wipe.",
  },
  { prismaModel: "Dispatch", clientKey: "dispatch", kind: "TRANSACTIONAL", phase: 50, parentDeps: ["SalesOrder", "WorkOrder", "Item"] },

  // —— QC / Production ——
  { prismaModel: "QcReversal", clientKey: "qcReversal", kind: "TRANSACTIONAL", phase: 60, parentDeps: ["QcEntry"] },
  { prismaModel: "ScrapRecord", clientKey: "scrapRecord", kind: "TRANSACTIONAL", phase: 70, parentDeps: ["QcEntry", "Item"] },
  { prismaModel: "QcRejectedDisposition", clientKey: "qcRejectedDisposition", kind: "TRANSACTIONAL", phase: 80, parentDeps: ["QcEntry"] },
  { prismaModel: "QcEntry", clientKey: "qcEntry", kind: "TRANSACTIONAL", phase: 90, parentDeps: ["WorkOrder", "ProductionEntry"] },
  {
    prismaModel: "QcLegacyRejectedClassification",
    clientKey: "qcLegacyRejectedClassification",
    kind: "TRANSACTIONAL",
    phase: 85,
    parentDeps: ["QcEntry"],
    notes: "Optional legacy table; deleted when present before QcEntry",
    verifyEmpty: false,
  },
  {
    prismaModel: "ProductionEntryRmConsumption",
    clientKey: "productionEntryRmConsumption",
    kind: "TRANSACTIONAL",
    phase: 100,
    parentDeps: ["ProductionEntry", "Item"],
  },
  { prismaModel: "ProductionEntry", clientKey: "productionEntry", kind: "TRANSACTIONAL", phase: 110, parentDeps: ["WorkOrder"] },

  // —— Production report ——
  {
    prismaModel: "ProductionRmReturnPending",
    clientKey: "productionRmReturnPending",
    kind: "TRANSACTIONAL",
    phase: 120,
    parentDeps: ["WorkOrder", "ProductionWorkOrderReport"],
  },
  {
    prismaModel: "ProductionWorkOrderReportWastageDetail",
    clientKey: "productionWorkOrderReportWastageDetail",
    kind: "TRANSACTIONAL",
    phase: 125,
    parentDeps: ["ProductionWorkOrderReport", "Item", "WastageType"],
    notes: "Item Restrict FK (20260718120000); delete before report/Item. Cascade from report is not enough for Item wipe order certainty.",
  },
  {
    prismaModel: "ProductionWorkOrderReportLine",
    clientKey: "productionWorkOrderReportLine",
    kind: "TRANSACTIONAL",
    phase: 130,
    parentDeps: ["ProductionWorkOrderReport", "Item"],
  },
  {
    prismaModel: "ProductionWorkOrderReport",
    clientKey: "productionWorkOrderReport",
    kind: "TRANSACTIONAL",
    phase: 140,
    parentDeps: ["WorkOrder"],
  },

  // —— Phase 2B recovery cluster (before WO / RS / CFP parents) ——
  {
    prismaModel: "NoQtyRsItemRecoveryDecisionLine",
    clientKey: "noQtyRsItemRecoveryDecisionLine",
    kind: "TRANSACTIONAL",
    phase: 150,
    parentDeps: ["NoQtyRsItemRecoveryDecision", "CarryForwardPending"],
    notes: "Restrict → CarryForwardPending; must delete before CFP",
  },
  {
    prismaModel: "NoQtyRsItemRecoveryDecision",
    clientKey: "noQtyRsItemRecoveryDecision",
    kind: "TRANSACTIONAL",
    phase: 160,
    parentDeps: ["RequirementSheet", "Item"],
    notes: "Keep/Waive decisions; lines deleted first",
  },
  {
    prismaModel: "RecoveryAllocation",
    clientKey: "recoveryAllocation",
    kind: "TRANSACTIONAL",
    phase: 170,
    parentDeps: ["CarryForwardPending", "RequirementSheet", "RequirementSheetLine"],
  },
  {
    prismaModel: "NoQtySoWaiverLine",
    clientKey: "noQtySoWaiverLine",
    kind: "TRANSACTIONAL",
    phase: 180,
    parentDeps: ["NoQtySoWaiver", "CarryForwardPending", "Item"],
  },
  { prismaModel: "NoQtySoWaiver", clientKey: "noQtySoWaiver", kind: "TRANSACTIONAL", phase: 190, parentDeps: ["SalesOrder"] },
  {
    prismaModel: "NoQtyAcceptedFgDisposition",
    clientKey: "noQtyAcceptedFgDisposition",
    kind: "TRANSACTIONAL",
    phase: 200,
    parentDeps: ["SalesOrder", "Item"],
    notes: "Restrict → SalesOrder; required before SO delete",
  },
  {
    prismaModel: "NoQtyQcExcessCycleAdjustment",
    clientKey: "noQtyQcExcessCycleAdjustment",
    kind: "TRANSACTIONAL",
    phase: 205,
    parentDeps: ["SalesOrder", "Item", "SalesOrderCycle"],
    notes: "NO_QTY QC excess → next-cycle overlay; Restrict → Item",
  },
  {
    prismaModel: "CarryForwardPending",
    clientKey: "carryForwardPending",
    kind: "TRANSACTIONAL",
    phase: 210,
    parentDeps: ["SalesOrder", "Item", "WorkOrder"],
    notes: "Transaction root for recoverySourceId children",
  },
  {
    prismaModel: "ProductionShortfallResolution",
    clientKey: "productionShortfallResolution",
    kind: "TRANSACTIONAL",
    phase: 220,
    parentDeps: ["WorkOrder"],
  },

  {
    prismaModel: "WorkOrderProductionExecution",
    clientKey: "workOrderProductionExecution",
    kind: "TRANSACTIONAL",
    phase: 230,
    parentDeps: ["WorkOrder"],
  },

  // —— RM flow ——
  { prismaModel: "MaterialIssueLine", clientKey: "materialIssueLine", kind: "TRANSACTIONAL", phase: 240, parentDeps: ["MaterialIssueNote", "Item"] },
  { prismaModel: "MaterialIssueNote", clientKey: "materialIssueNote", kind: "TRANSACTIONAL", phase: 250, parentDeps: ["WorkOrder"] },
  { prismaModel: "MaterialWastageNote", clientKey: "materialWastageNote", kind: "TRANSACTIONAL", phase: 260, parentDeps: ["WorkOrder", "Item"] },
  {
    prismaModel: "RmAllowanceApprovalRequest",
    clientKey: "rmAllowanceApprovalRequest",
    kind: "TRANSACTIONAL",
    phase: 265,
    parentDeps: ["WorkOrder", "ProductionMaterialRequest", "ProductionMaterialRequestLine", "Item", "MaterialIssueNote"],
    notes: "Must delete before PMR lines / Item (Restrict FKs). Introduced 20260719110000.",
  },
  { prismaModel: "MaterialAllocation", clientKey: "materialAllocation", kind: "TRANSACTIONAL", phase: 270, parentDeps: ["WorkOrder", "Item"] },
  {
    prismaModel: "ProductionMaterialRequestLine",
    clientKey: "productionMaterialRequestLine",
    kind: "TRANSACTIONAL",
    phase: 280,
    parentDeps: ["ProductionMaterialRequest", "Item"],
  },
  {
    prismaModel: "ProductionMaterialRequest",
    clientKey: "productionMaterialRequest",
    kind: "TRANSACTIONAL",
    phase: 290,
    parentDeps: ["WorkOrder"],
  },
  { prismaModel: "MaterialReturnLine", clientKey: "materialReturnLine", kind: "TRANSACTIONAL", phase: 300, parentDeps: ["MaterialReturnNote", "Item"] },
  { prismaModel: "MaterialReturnNote", clientKey: "materialReturnNote", kind: "TRANSACTIONAL", phase: 310, parentDeps: ["WorkOrder"] },

  { prismaModel: "WorkOrderLine", clientKey: "workOrderLine", kind: "TRANSACTIONAL", phase: 320, parentDeps: ["WorkOrder", "Item"] },
  { prismaModel: "WorkOrder", clientKey: "workOrder", kind: "TRANSACTIONAL", phase: 330, parentDeps: ["SalesOrder", "RequirementSheet"] },

  {
    prismaModel: "MonthlyPlanRequirementCoverage",
    clientKey: "monthlyPlanRequirementCoverage",
    kind: "TRANSACTIONAL",
    phase: 335,
    parentDeps: ["MonthlyProductionPlan", "RequirementSheet", "RequirementSheetLine", "Item"],
    notes: "Plan coverage; SetNull on RS but Cascade on plan — clear before RS for safety",
  },

  { prismaModel: "RequirementSheetLine", clientKey: "requirementSheetLine", kind: "TRANSACTIONAL", phase: 340, parentDeps: ["RequirementSheet", "Item"] },
  { prismaModel: "RequirementSheet", clientKey: "requirementSheet", kind: "TRANSACTIONAL", phase: 350, parentDeps: ["SalesOrder"] },

  {
    prismaModel: "NoQtySoClosedShortageLine",
    clientKey: "noQtySoClosedShortageLine",
    kind: "TRANSACTIONAL",
    phase: 360,
    parentDeps: ["NoQtySoCloseSnapshot", "Item"],
  },
  {
    prismaModel: "NoQtySoCloseSnapshot",
    clientKey: "noQtySoCloseSnapshot",
    kind: "TRANSACTIONAL",
    phase: 370,
    parentDeps: ["SalesOrder"],
  },
  { prismaModel: "SalesOrderCycle", clientKey: "salesOrderCycle", kind: "TRANSACTIONAL", phase: 380, parentDeps: ["SalesOrder"] },
  {
    prismaModel: "RegularSoPlanningSnapshotLine",
    clientKey: "regularSoPlanningSnapshotLine",
    kind: "TRANSACTIONAL",
    phase: 390,
    parentDeps: ["RegularSoPlanningSnapshot", "Item"],
  },
  {
    prismaModel: "RegularSoBufferApprovalRequest",
    clientKey: "regularSoBufferApprovalRequest",
    kind: "TRANSACTIONAL",
    phase: 395,
    parentDeps: ["SalesOrder", "Item"],
    notes: "REGULAR_SO Prepare WO buffer approval. Delete before SalesOrder/User wipe (Restrict on requester).",
  },
  {
    prismaModel: "RegularSoPlanningSnapshot",
    clientKey: "regularSoPlanningSnapshot",
    kind: "TRANSACTIONAL",
    phase: 400,
    parentDeps: ["SalesOrder"],
  },
  { prismaModel: "SalesOrderLine", clientKey: "salesOrderLine", kind: "TRANSACTIONAL", phase: 410, parentDeps: ["SalesOrder", "Item"] },
  { prismaModel: "SalesOrder", clientKey: "salesOrder", kind: "TRANSACTIONAL", phase: 420, parentDeps: ["Customer"] },

  { prismaModel: "QuotationLine", clientKey: "quotationLine", kind: "TRANSACTIONAL", phase: 430, parentDeps: ["Quotation", "Item"] },
  { prismaModel: "Quotation", clientKey: "quotation", kind: "TRANSACTIONAL", phase: 440, parentDeps: ["Enquiry"] },
  { prismaModel: "Feasibility", clientKey: "feasibility", kind: "TRANSACTIONAL", phase: 450, parentDeps: ["Enquiry"] },
  { prismaModel: "EnquiryLine", clientKey: "enquiryLine", kind: "TRANSACTIONAL", phase: 460, parentDeps: ["Enquiry", "Item"] },
  { prismaModel: "Enquiry", clientKey: "enquiry", kind: "TRANSACTIONAL", phase: 470, parentDeps: ["Customer"] },

  { prismaModel: "PurchaseBillPayment", clientKey: "purchaseBillPayment", kind: "TRANSACTIONAL", phase: 480, parentDeps: ["PurchaseBill"] },
  { prismaModel: "PurchaseBillLine", clientKey: "purchaseBillLine", kind: "TRANSACTIONAL", phase: 490, parentDeps: ["PurchaseBill", "Item"] },
  { prismaModel: "PurchaseBill", clientKey: "purchaseBill", kind: "TRANSACTIONAL", phase: 500, parentDeps: ["Supplier", "Grn"] },
  { prismaModel: "GrnLine", clientKey: "grnLine", kind: "TRANSACTIONAL", phase: 510, parentDeps: ["Grn", "Item"] },
  { prismaModel: "Grn", clientKey: "grn", kind: "TRANSACTIONAL", phase: 520, parentDeps: ["RmPurchaseOrder"] },

  {
    prismaModel: "RmPoLineProcurementLink",
    clientKey: "rmPoLineProcurementLink",
    kind: "TRANSACTIONAL",
    phase: 530,
    parentDeps: ["RmPurchaseOrderLine", "PurchaseRequestLine", "MaterialRequirementLine"],
  },
  {
    prismaModel: "PurchaseRequestLineSourceLink",
    clientKey: "purchaseRequestLineSourceLink",
    kind: "TRANSACTIONAL",
    phase: 540,
    parentDeps: ["PurchaseRequestLine", "MaterialRequirementLine"],
  },
  {
    prismaModel: "MaterialRequirementLine",
    clientKey: "materialRequirementLine",
    kind: "TRANSACTIONAL",
    phase: 550,
    parentDeps: ["MaterialRequirement", "Item"],
  },
  { prismaModel: "MaterialRequirement", clientKey: "materialRequirement", kind: "TRANSACTIONAL", phase: 560, parentDeps: [] },
  { prismaModel: "PurchaseRequestLine", clientKey: "purchaseRequestLine", kind: "TRANSACTIONAL", phase: 570, parentDeps: ["PurchaseRequest", "Item"] },
  { prismaModel: "PurchaseRequest", clientKey: "purchaseRequest", kind: "TRANSACTIONAL", phase: 580, parentDeps: [] },

  { prismaModel: "RmPlanLine", clientKey: "rmPlanLine", kind: "TRANSACTIONAL", phase: 590, parentDeps: ["RmPlan", "Item"] },
  { prismaModel: "RmPlan", clientKey: "rmPlan", kind: "TRANSACTIONAL", phase: 600, parentDeps: ["MonthlyProductionPlan"] },
  {
    prismaModel: "MonthlyProductionPlanRevisionLine",
    clientKey: "monthlyProductionPlanRevisionLine",
    kind: "TRANSACTIONAL",
    phase: 610,
    parentDeps: ["MonthlyProductionPlan", "Item"],
  },
  {
    prismaModel: "MonthlyProductionPlanLine",
    clientKey: "monthlyProductionPlanLine",
    kind: "TRANSACTIONAL",
    phase: 620,
    parentDeps: ["MonthlyProductionPlan", "Item"],
  },
  { prismaModel: "MonthlyProductionPlan", clientKey: "monthlyProductionPlan", kind: "TRANSACTIONAL", phase: 630, parentDeps: [] },

  { prismaModel: "RmPurchaseOrderLine", clientKey: "rmPurchaseOrderLine", kind: "TRANSACTIONAL", phase: 640, parentDeps: ["RmPurchaseOrder", "Item"] },
  { prismaModel: "RmPurchaseOrder", clientKey: "rmPurchaseOrder", kind: "TRANSACTIONAL", phase: 650, parentDeps: ["Supplier"] },
  { prismaModel: "CustomerPOLine", clientKey: "customerPOLine", kind: "TRANSACTIONAL", phase: 660, parentDeps: ["CustomerPO", "Item"] },
  { prismaModel: "CustomerPO", clientKey: "customerPO", kind: "TRANSACTIONAL", phase: 670, parentDeps: ["Customer"] },

  {
    prismaModel: "StockAdjustmentQcEntry",
    clientKey: "stockAdjustmentQcEntry",
    kind: "TRANSACTIONAL",
    phase: 680,
    parentDeps: ["StockTransaction", "QcEntry"],
  },
  {
    prismaModel: "StockTransaction",
    clientKey: "stockTransaction",
    kind: "TRANSACTIONAL",
    phase: 690,
    parentDeps: ["Item", "Location"],
    notes: "Clear reversalOfId before deleteMany",
  },
]);

/** @returns {CleanupRegistryEntry[]} */
function getTransactionalRegistryEntries() {
  return CLEANUP_REGISTRY.filter((e) => e.kind === "TRANSACTIONAL").slice().sort((a, b) => a.phase - b.phase);
}

/** @returns {string[]} client keys in delete order */
function getTransactionalDeleteClientKeys() {
  return getTransactionalRegistryEntries().map((e) => e.clientKey);
}

/** @returns {string[]} Prisma model names in delete order */
function getTransactionalDeletePrismaModels() {
  return getTransactionalRegistryEntries().map((e) => e.prismaModel);
}

/** Recovery / CFP cluster client keys (SSOT for noQtyRecoveryCleanupService). */
function getRecoveryClusterClientKeys() {
  return [...RECOVERY_CLUSTER_CLIENT_KEYS];
}

/**
 * Tables that must be empty after Reset Transaction Data.
 * Excludes special non-table steps (opening stock revert is verified via APPROVED count separately).
 */
function getResetTransactionVerifyTables() {
  return getTransactionalRegistryEntries()
    .filter((e) => e.verifyEmpty !== false)
    .map((e) => e.clientKey);
}

/**
 * @param {string} clientKey
 * @returns {CleanupRegistryEntry | undefined}
 */
function findRegistryEntryByClientKey(clientKey) {
  return CLEANUP_REGISTRY.find((e) => e.clientKey === clientKey);
}

/**
 * @param {string} prismaModel
 * @returns {CleanupRegistryEntry | undefined}
 */
function findRegistryEntryByPrismaModel(prismaModel) {
  return CLEANUP_REGISTRY.find((e) => e.prismaModel === prismaModel);
}

module.exports = {
  CLEANUP_REGISTRY,
  PRESERVED_MASTER_MODELS,
  FULL_DEMO_WIPED_MASTERS,
  FULL_DEMO_PRESERVED_MODELS,
  RECOVERY_CLUSTER_CLIENT_KEYS,
  getTransactionalRegistryEntries,
  getTransactionalDeleteClientKeys,
  getTransactionalDeletePrismaModels,
  getRecoveryClusterClientKeys,
  getResetTransactionVerifyTables,
  findRegistryEntryByClientKey,
  findRegistryEntryByPrismaModel,
};
