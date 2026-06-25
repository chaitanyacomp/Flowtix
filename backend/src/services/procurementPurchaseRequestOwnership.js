/**
 * PR creation ownership: Store for REGULAR_SO / replenishment; Purchase for MPRS (MONTHLY_PLAN).
 */

const {
  MATERIAL_REQUISITION_WRITE_ROLES,
  PURCHASE_EXECUTION_ROLES,
} = require("../constants/erpRoles");
const {
  resolveDemandPoolForSourceType,
  PROCUREMENT_DEMAND_POOL,
} = require("./procurementDemandPoolService");

function normalizeActorRole(role) {
  return String(role ?? "")
    .trim()
    .toUpperCase();
}

function isMprsSourceType(sourceType) {
  return resolveDemandPoolForSourceType(sourceType) === PROCUREMENT_DEMAND_POOL.MPRS;
}

function demandPoolForSourceTypes(sourceTypes) {
  const pools = new Set(
    (sourceTypes || [])
      .map((st) => resolveDemandPoolForSourceType(st))
      .filter(Boolean),
  );
  return pools;
}

function actorMayCreatePurchaseRequestForSourceTypes(actorRole, sourceTypes) {
  const role = normalizeActorRole(actorRole);
  const pools = demandPoolForSourceTypes(sourceTypes);

  if (role === "ADMIN") return true;
  if (!pools.size) return MATERIAL_REQUISITION_WRITE_ROLES.includes(role);

  const mprsOnly = pools.size === 1 && pools.has(PROCUREMENT_DEMAND_POOL.MPRS);
  if (mprsOnly) return PURCHASE_EXECUTION_ROLES.includes(role);

  const nonMprsOnly = !pools.has(PROCUREMENT_DEMAND_POOL.MPRS);
  if (nonMprsOnly) return MATERIAL_REQUISITION_WRITE_ROLES.includes(role);

  return false;
}

function assertActorMayCreatePurchaseRequest(actor, sourceTypes) {
  if (actorMayCreatePurchaseRequestForSourceTypes(actor?.role, sourceTypes)) return;

  const pools = demandPoolForSourceTypes(sourceTypes);
  const mprsOnly = pools.size === 1 && pools.has(PROCUREMENT_DEMAND_POOL.MPRS);
  const err = new Error(
    mprsOnly
      ? "Monthly Planning procurement requests may only be created by Purchase."
      : "Purchase requests for this demand source may only be created by Store.",
  );
  err.statusCode = 403;
  throw err;
}

module.exports = {
  isMprsSourceType,
  actorMayCreatePurchaseRequestForSourceTypes,
  assertActorMayCreatePurchaseRequest,
};
