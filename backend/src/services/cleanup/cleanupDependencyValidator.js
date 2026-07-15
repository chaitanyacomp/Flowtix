/**
 * Cleanup registry ↔ Prisma schema dependency validation.
 *
 * Fails when a new Restrict FK / transactional model is missing from the
 * canonical cleanup registry, or when delete order places a parent before a child.
 */

const {
  CLEANUP_REGISTRY,
  PRESERVED_MASTER_MODELS,
  getTransactionalRegistryEntries,
  findRegistryEntryByPrismaModel,
} = require("./cleanupRegistry");
const { loadPrismaSchemaGraph, getBlockingRelations } = require("./prismaSchemaGraph");

/** Transactional roots whose Restrict children must be registered. */
const TRANSACTION_ROOT_MODELS = Object.freeze([
  "CarryForwardPending",
  "SalesOrder",
  "WorkOrder",
  "RequirementSheet",
  "RequirementSheetLine",
  "ProductionEntry",
  "QcEntry",
  "Dispatch",
  "MonthlyProductionPlan",
  "MaterialRequirement",
  "PurchaseRequest",
  "RmPurchaseOrder",
  "NoQtySoWaiver",
  "NoQtyRsItemRecoveryDecision",
  "Grn",
  "PurchaseBill",
  "Enquiry",
  "Quotation",
  "CustomerPO",
  "StockTransaction",
  "ProductionMaterialRequest",
  "MaterialIssueNote",
  "MaterialReturnNote",
  "ProductionWorkOrderReport",
]);

/**
 * @typedef {object} CleanupValidationIssue
 * @property {'CLEANUP_REGISTRY_MISSING_MODEL' | 'INVALID_DELETE_ORDER' | 'UNKNOWN_REGISTRY_MODEL'} code
 * @property {string} message
 * @property {object} [details]
 */

/**
 * @param {{ schemaPath?: string }} [opts]
 * @returns {{
 *   ok: boolean;
 *   registeredModels: string[];
 *   detectedBlockingDeps: Array<{ from: string; to: string; field: string; onDelete: string }>;
 *   missingModels: CleanupValidationIssue[];
 *   invalidOrder: CleanupValidationIssue[];
 *   unknownRegistryModels: CleanupValidationIssue[];
 *   issues: CleanupValidationIssue[];
 * }}
 */
function validateCleanupRegistryAgainstSchema(opts = {}) {
  const graph = loadPrismaSchemaGraph(opts.schemaPath);
  const schemaModelSet = new Set(graph.models);
  const blocking = getBlockingRelations(graph.relations);
  const registered = getTransactionalRegistryEntries();
  const registeredByModel = new Map(registered.map((e) => [e.prismaModel, e]));
  const preserved = new Set(PRESERVED_MASTER_MODELS);
  const roots = new Set(TRANSACTION_ROOT_MODELS);

  /** @type {CleanupValidationIssue[]} */
  const missingModels = [];
  /** @type {CleanupValidationIssue[]} */
  const invalidOrder = [];
  /** @type {CleanupValidationIssue[]} */
  const unknownRegistryModels = [];

  for (const entry of registered) {
    if (!schemaModelSet.has(entry.prismaModel)) {
      unknownRegistryModels.push({
        code: "UNKNOWN_REGISTRY_MODEL",
        message: `CLEANUP_REGISTRY lists ${entry.prismaModel} but it is not in schema.prisma.`,
        details: { prismaModel: entry.prismaModel, clientKey: entry.clientKey },
      });
    }
  }

  const detectedBlockingDeps = [];

  for (const rel of blocking) {
    // Skip FKs into preserved masters (Item, User, …) — transaction reset keeps those parents.
    if (preserved.has(rel.toModel) && !registeredByModel.has(rel.toModel)) {
      continue;
    }

    // Self-referential Restrict FKs are cleared via clearTransactionSelfReferences before delete.
    if (rel.fromModel === rel.toModel) {
      continue;
    }

    const parentIsTransactional =
      registeredByModel.has(rel.toModel) || roots.has(rel.toModel);
    if (!parentIsTransactional) continue;

    detectedBlockingDeps.push({
      from: rel.fromModel,
      to: rel.toModel,
      field: rel.fieldName,
      onDelete: rel.onDelete,
      fromFields: rel.fromFields,
    });

    // Child must be registered when it Restrict-references a transactional parent/root.
    if (preserved.has(rel.fromModel)) continue;

    if (!registeredByModel.has(rel.fromModel)) {
      missingModels.push({
        code: "CLEANUP_REGISTRY_MISSING_MODEL",
        message:
          `CLEANUP_REGISTRY_MISSING_MODEL:\n` +
          `${rel.fromModel} references ${rel.toModel} but is not registered before its parent.`,
        details: {
          child: rel.fromModel,
          parent: rel.toModel,
          field: rel.fieldName,
          fromFields: rel.fromFields,
          onDelete: rel.onDelete,
        },
      });
      continue;
    }

    const child = registeredByModel.get(rel.fromModel);
    const parent = registeredByModel.get(rel.toModel);
    if (child && parent && child.phase >= parent.phase) {
      invalidOrder.push({
        code: "INVALID_DELETE_ORDER",
        message:
          `INVALID_DELETE_ORDER:\n` +
          `${rel.fromModel} (phase ${child.phase}) must be deleted before ` +
          `${rel.toModel} (phase ${parent.phase}) because ${rel.fieldName} uses onDelete: ${rel.onDelete}.`,
        details: {
          child: rel.fromModel,
          parent: rel.toModel,
          childPhase: child.phase,
          parentPhase: parent.phase,
          field: rel.fieldName,
        },
      });
    }
  }

  // Explicit recoverySourceId-style relations: every Restrict → CarryForwardPending child
  // must appear in the recovery cluster before CarryForwardPending.
  const cfpPhase = registeredByModel.get("CarryForwardPending")?.phase ?? Infinity;
  for (const rel of blocking) {
    if (rel.toModel !== "CarryForwardPending") continue;
    if (preserved.has(rel.fromModel)) continue;
    const child = registeredByModel.get(rel.fromModel);
    if (!child) {
      // already reported as missing
      continue;
    }
    if (child.phase >= cfpPhase) {
      invalidOrder.push({
        code: "INVALID_DELETE_ORDER",
        message:
          `INVALID_DELETE_ORDER:\n` +
          `${rel.fromModel} references CarryForwardPending via ${rel.fieldName} ` +
          `but is not registered before its parent.`,
        details: { child: rel.fromModel, parent: "CarryForwardPending", field: rel.fieldName },
      });
    }
  }

  const issues = [...missingModels, ...invalidOrder, ...unknownRegistryModels];

  return {
    ok: issues.length === 0,
    registeredModels: registered.map((e) => e.prismaModel),
    detectedBlockingDeps,
    missingModels,
    invalidOrder,
    unknownRegistryModels,
    issues,
  };
}

/**
 * Throw if registry is incomplete / mis-ordered (for tests / CI).
 * @param {{ schemaPath?: string }} [opts]
 */
function assertCleanupRegistryValid(opts = {}) {
  const result = validateCleanupRegistryAgainstSchema(opts);
  if (result.ok) return result;
  const detail = result.issues.map((i) => i.message).join("\n\n");
  const err = new Error(`Cleanup registry validation failed:\n\n${detail}`);
  err.code = "CLEANUP_REGISTRY_INVALID";
  err.issues = result.issues;
  throw err;
}

/**
 * Build a printable FK dependency graph for CarryForwardPending children.
 */
function describeCarryForwardPendingDependencyGraph(opts = {}) {
  const graph = loadPrismaSchemaGraph(opts.schemaPath);
  const blocking = getBlockingRelations(graph.relations).filter((r) => r.toModel === "CarryForwardPending");
  return blocking.map((r) => {
    const entry = findRegistryEntryByPrismaModel(r.fromModel);
    return {
      child: r.fromModel,
      field: r.fieldName,
      fromFields: r.fromFields,
      onDelete: r.onDelete,
      registryPhase: entry?.phase ?? null,
      registered: Boolean(entry),
    };
  });
}

module.exports = {
  TRANSACTION_ROOT_MODELS,
  validateCleanupRegistryAgainstSchema,
  assertCleanupRegistryValid,
  describeCarryForwardPendingDependencyGraph,
};
