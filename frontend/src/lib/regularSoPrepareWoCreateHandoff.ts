/**
 * REGULAR_SO — create Work Order from Prepare WO, then hand off to Material Issue.
 * Created WO remains permanently accessible at `/work-orders/:id`.
 */

import { buildMaterialIssueDeepLink } from "./manufacturingNavigationContinuity";
import { formatPostWoCreateSuccessMessage } from "./materialWorkflowLinks";
import { displayWorkOrderNo } from "./docNoDisplay";
import { regularSoWorkOrderDetailHref } from "./drillDownRoutes";

export type RegularSoCreateWoLine = { fgItemId: number; qty: number };

export type RegularSoCreateWoApiResult = {
  id: number;
  docNo?: string | null;
};

export function buildRegularSoPostCreateMaterialIssueHref(input: {
  workOrderId: number;
  pmrId?: number | null;
  salesOrderId: number;
  source?: string;
}): string {
  return buildMaterialIssueDeepLink({
    workOrderId: input.workOrderId,
    pmrId: input.pmrId ?? null,
    returnTo: "prepare-wo",
    salesOrderId: input.salesOrderId,
    source: input.source ?? "prepare-wo",
    bucket: "readyToIssue",
  });
}

/** Permanent View Work Order path after create (refresh-safe). */
export function buildRegularSoViewWorkOrderHref(workOrderId: number): string {
  return regularSoWorkOrderDetailHref(workOrderId, { from: "prepare-wo" });
}

export function regularSoCreateWoSuccessToast(
  wo: RegularSoCreateWoApiResult,
  pmrDocNo?: string | null,
): string {
  return formatPostWoCreateSuccessMessage(displayWorkOrderNo(wo.id, wo.docNo), pmrDocNo);
}

/** Prefer reusing an existing open WO for the SO instead of posting a duplicate. */
export function shouldReuseExistingRegularWo(existingWoId: number | null | undefined): boolean {
  return Number(existingWoId) > 0;
}
