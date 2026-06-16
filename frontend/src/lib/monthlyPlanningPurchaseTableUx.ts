/**
 * P8F-A11B-9 / P8F-A11B-10A — Purchase Planning RM table presentation (operational vs audit columns).
 */

import type { ReceiptCoverageStatus } from "./monthlyPlanningReceiptCoverageUx";
import { MP_PROCUREMENT, MP_RELEASE_STATUS_META, type MpReleaseStatus } from "./monthlyPlanningProcurementLabels";

export const PURCHASE_PLANNING_DEFAULT_TABLE_HEADERS = [
  "RM Item",
  "Unit",
  "Required",
  "Released",
  "Ordered",
  "Received",
  "Pending / Over",
  "Status",
] as const;

export const PURCHASE_PLANNING_AUDIT_TABLE_HEADERS = [
  MP_PROCUREMENT.ADDITIONAL_REQUIREMENT,
  "Reduction",
  MP_PROCUREMENT.SUGGESTED_BUY_QTY,
  MP_PROCUREMENT.LINE_RECEIPT_COVERAGE_PCT,
  "Release Status",
  "Warnings",
] as const;

const EPS = 1e-6;

export type PurchasePlanningLineOperationalStatus = {
  label: string;
  cls: string;
};

/** Combined receipt + release status for the default operational Status column. */
export function purchasePlanningLineOperationalStatus(input: {
  procurementStatus: MpReleaseStatus | string;
  receiptCoverageStatus: ReceiptCoverageStatus | string;
  additionalRequirementQty: number;
  poQty: number;
}): PurchasePlanningLineOperationalStatus {
  const receipt = String(input.receiptCoverageStatus ?? "NOT_RECEIVED").trim();
  const release = String(input.procurementStatus ?? "NOT_RELEASED").trim() as MpReleaseStatus;
  const additional = Math.max(0, Number(input.additionalRequirementQty ?? 0));
  const poQty = Math.max(0, Number(input.poQty ?? 0));

  if (receipt === "OVER_COVERED") {
    return { label: "Over Received", cls: "bg-sky-100 text-sky-900" };
  }
  if (receipt === "FULLY_COVERED") {
    return { label: "Received", cls: "bg-emerald-100 text-emerald-800" };
  }
  if (receipt === "PARTIALLY_COVERED") {
    return { label: "Partially Received", cls: "bg-amber-100 text-amber-800" };
  }
  if (poQty > EPS) {
    return { label: "Ordered", cls: "bg-blue-100 text-blue-900" };
  }
  if (additional > EPS || release === "NOT_RELEASED" || release === "PARTIALLY_RELEASED") {
    return { label: "Pending Release", cls: "bg-violet-100 text-violet-900" };
  }
  if (release === "FULLY_RELEASED") {
    return { label: "Released", cls: MP_RELEASE_STATUS_META.FULLY_RELEASED.cls };
  }
  if (release === "OVER_RELEASED") {
    return { label: MP_RELEASE_STATUS_META.OVER_RELEASED.label, cls: MP_RELEASE_STATUS_META.OVER_RELEASED.cls };
  }
  return { label: "Not Ordered", cls: "bg-slate-100 text-slate-600" };
}

export function purchasePlanningTableColumnCount(showAuditColumns: boolean): number {
  return PURCHASE_PLANNING_DEFAULT_TABLE_HEADERS.length + (showAuditColumns ? PURCHASE_PLANNING_AUDIT_TABLE_HEADERS.length : 0);
}

export function purchasePlanningDefaultTableHeaders(): readonly string[] {
  return PURCHASE_PLANNING_DEFAULT_TABLE_HEADERS;
}

export function purchasePlanningAuditTableHeaders(): readonly string[] {
  return PURCHASE_PLANNING_AUDIT_TABLE_HEADERS;
}
