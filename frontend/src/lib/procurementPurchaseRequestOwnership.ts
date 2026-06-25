import {
  hasErpRole,
  MATERIAL_REQUISITION_WRITE_ROLES,
  PURCHASE_EXECUTION_ROLES,
} from "../config/erpRoles";
import type { ProcurementDemandPoolKey } from "./procurementWorkspaceQueues";

export function isMprsMaterialRequirement(row: {
  sourceType?: string | null;
  source?: { type?: string | null } | null;
}): boolean {
  const type = row.source?.type ?? row.sourceType ?? null;
  return type === "MONTHLY_PLAN";
}

export function canRoleCreatePurchaseRequestForMr(
  role: string | undefined,
  row: { sourceType?: string | null; source?: { type?: string | null } | null },
  demandPool?: ProcurementDemandPoolKey | null,
): boolean {
  const mprs = demandPool === "MPRS" || isMprsMaterialRequirement(row);
  if (mprs) return hasErpRole(role, PURCHASE_EXECUTION_ROLES);
  return hasErpRole(role, MATERIAL_REQUISITION_WRITE_ROLES);
}
