/**
 * REGULAR_SO — create Work Order from Prepare WO, then hand off to Material Issue.
 * Created WO remains permanently accessible at `/work-orders/:id`.
 * Post-create back navigation must target the WO detail — never the editable Prepare screen.
 */

import { buildMaterialIssueDeepLink } from "./manufacturingNavigationContinuity";
import { formatPostWoCreateSuccessMessage } from "./materialWorkflowLinks";
import { displayWorkOrderNo } from "./docNoDisplay";
import { regularSoWorkOrderDetailHref } from "./drillDownRoutes";

/** Query `source` / origin when MI was opened immediately after Create WO. */
export const CREATE_WORK_ORDER_SOURCE = "create-work-order";

export type RegularSoCreateWoLine = { fgItemId: number; qty: number };

export type RegularSoCreateWoApiResult = {
  id: number;
  docNo?: string | null;
};

export function buildRegularSoPostCreateMaterialIssueHref(input: {
  workOrderId: number;
  pmrId?: number | null;
  salesOrderId: number;
  /** Business WO number for breadcrumb (optional). */
  workOrderNo?: string | null;
  source?: string;
}): string {
  return buildMaterialIssueDeepLink({
    workOrderId: input.workOrderId,
    pmrId: input.pmrId ?? null,
    returnTo: "work-order-detail",
    salesOrderId: input.salesOrderId,
    source: input.source ?? CREATE_WORK_ORDER_SOURCE,
    workOrderNo: input.workOrderNo ?? null,
    bucket: "readyToIssue",
  });
}

/** Permanent View Work Order path after create (refresh-safe). */
export function buildRegularSoViewWorkOrderHref(workOrderId: number): string {
  return regularSoWorkOrderDetailHref(workOrderId, { from: CREATE_WORK_ORDER_SOURCE });
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
