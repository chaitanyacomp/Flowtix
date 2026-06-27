import { apiFetch } from "../services/api";

import { DRILL_QUERY } from "./drillDownRoutes";

import type { ProductionRmReadiness } from "../components/erp/ProductionRmReadinessStrip";

import { isProductionBlockedByRmReadiness } from "../components/erp/ProductionRmReadinessStrip";

import { buildRmIssueNextStep } from "./regularSoOperationalGuidance";

import { buildProductionScopedHref } from "./productionNavigation";

import type { RmPoRow } from "../pages/rmPurchase/rmPurchaseShared";



export const RM_PURCHASE_POST_GRN_MESSAGES = {

  fulfilledHeadline: "Goods receipt posted.",

  fulfilledDetail: "RM requirement for this sales order has been fulfilled.",

  fulfilledNextStep: "Next step: Create Work Order.",

  partialHeadline:

    "Goods receipt posted. Quantities from this receipt are in usable stock. Receive remaining lines when ready.",

  workflowCompleteHeadline: "Workflow complete.",

  workflowCompleteDetail: "Customer order fully dispatched.",

} as const;



export type PostGrnContinuitySnapshot = {

  salesOrderId: number;

  salesOrderDocNo: string | null;

  orderType: string | null;

  processStageKey: string;

  workOrderId: number | null;

  workOrderNo: string | null;

  workOrderLineId: number | null;

  allocationFirstKey: string | null;

  /** Any draft or approved production batch exists on this SO's work orders. */

  hasProductionEntry: boolean;

  /** Loaded when a WO line exists — drives gate-aware Issue RM links. */

  rmReadiness: ProductionRmReadiness | null;

};



export type PostGrnNextStep = {

  stageKey: string;

  headline: string;

  detail: string;

  nextStepLine: string;

  actionLabel: string;

  actionHref: string;

  secondaryLabel?: string;

  secondaryHref?: string;

  isWorkflowComplete: boolean;

};



export function buildContinueWoPreparationHref(salesOrderId: number): string {

  return `/work-orders?salesOrderId=${encodeURIComponent(String(salesOrderId))}&from=rm-purchase`;

}



export function buildCreateWorkOrderHref(salesOrderId: number): string {

  return `/work-orders/prepare?salesOrderId=${encodeURIComponent(String(salesOrderId))}`;

}



export function buildViewRmStockHref(): string {

  return "/stock";

}



export function buildViewWorkOrderHref(salesOrderId: number, workOrderId?: number | null): string {

  const q = new URLSearchParams({ salesOrderId: String(salesOrderId), from: "rm-purchase" });

  if (workOrderId && workOrderId > 0) q.set("workOrderId", String(workOrderId));

  return `/work-orders?${q.toString()}`;

}



function buildProductionHref(snapshot: PostGrnContinuitySnapshot): string {

  const woId = Number(snapshot.workOrderId ?? 0);

  const wolId = Number(snapshot.workOrderLineId ?? 0);

  return buildProductionScopedHref({

    orderType: snapshot.orderType,

    salesOrderId: snapshot.salesOrderId,

    workOrderId: woId > 0 ? woId : undefined,

    workOrderLineId: wolId > 0 ? wolId : undefined,

    from: "rm-purchase",

  });

}



export function buildRmPoDetailHref(

  poId: number,

  opts?: { salesOrderId?: number | null; from?: string },

): string {

  const q = new URLSearchParams();

  const soId = Number(opts?.salesOrderId ?? 0);

  if (Number.isFinite(soId) && soId > 0) q.set("salesOrderId", String(soId));

  if (opts?.from) q.set("from", opts.from);

  const qs = q.toString();

  return qs ? `/rm-po-grn/${poId}?${qs}` : `/rm-po-grn/${poId}`;

}



type PoProcurementMr = {

  salesOrderId?: number | null;

};



function collectSalesOrderIdsFromMr(mr: PoProcurementMr | null | undefined, ids: Set<number>) {

  const soId = Number(mr?.salesOrderId ?? 0);

  if (Number.isFinite(soId) && soId > 0) ids.add(soId);

}



/** Read-only: derive linked REGULAR SO from PO procurement traceability (no business rules). */

export function resolvePoLinkedSalesOrderIds(po: RmPoRow | null | undefined): number[] {

  const ids = new Set<number>();

  for (const line of po?.lines ?? []) {

    const links = (line as {

      procurementLinks?: Array<{

        materialRequirementLine?: { materialRequirement?: PoProcurementMr | null } | null;

        purchaseRequestLine?: {

          sourceLinks?: Array<{

            materialRequirementLine?: { materialRequirement?: PoProcurementMr | null } | null;

          }>;

        } | null;

      }>;

    }).procurementLinks;

    if (!links?.length) continue;

    for (const lk of links) {

      collectSalesOrderIdsFromMr(lk.materialRequirementLine?.materialRequirement, ids);

      for (const sl of lk.purchaseRequestLine?.sourceLinks ?? []) {

        collectSalesOrderIdsFromMr(sl.materialRequirementLine?.materialRequirement, ids);

      }

    }

  }

  return Array.from(ids);

}



export function resolvePoLinkedSalesOrderId(po: RmPoRow | null | undefined): number | null {

  const ids = resolvePoLinkedSalesOrderIds(po);

  return ids.length === 1 ? ids[0]! : ids[0] ?? null;

}



export function postGrnFulfilledMessage(): string {

  return `${RM_PURCHASE_POST_GRN_MESSAGES.fulfilledHeadline} ${RM_PURCHASE_POST_GRN_MESSAGES.fulfilledDetail}`;

}



function woExists(snapshot: PostGrnContinuitySnapshot): boolean {

  return Number(snapshot.workOrderId ?? 0) > 0;

}



function rmIssuedToProduction(snapshot: PostGrnContinuitySnapshot): boolean {

  if (snapshot.rmReadiness && !isProductionBlockedByRmReadiness(snapshot.rmReadiness)) {

    return true;

  }

  return snapshot.allocationFirstKey === "READY_FOR_PRODUCTION";

}



function rmIssueRequired(snapshot: PostGrnContinuitySnapshot): boolean {

  if (!woExists(snapshot)) return false;

  if (rmIssuedToProduction(snapshot)) return false;

  if (snapshot.rmReadiness && isProductionBlockedByRmReadiness(snapshot.rmReadiness)) {

    return true;

  }

  const alloc = snapshot.allocationFirstKey;

  return (

    alloc === "READY_FOR_ISSUE" ||

    alloc === "WAITING_RM" ||

    alloc === "PARTIALLY_ALLOCATED" ||

    (snapshot.processStageKey === "PRODUCTION_PENDING" && alloc !== "READY_FOR_PRODUCTION")

  );

}



function woCreationRequired(snapshot: PostGrnContinuitySnapshot): boolean {

  if (!woExists(snapshot)) return true;

  if (snapshot.processStageKey === "WO_PENDING") return true;

  if (snapshot.allocationFirstKey === "RM_RECEIVED") return true;

  return false;

}



function issueRmHref(snapshot: PostGrnContinuitySnapshot, returnTo: string): string {

  if (snapshot.rmReadiness && isProductionBlockedByRmReadiness(snapshot.rmReadiness)) {

    return buildRmIssueNextStep(snapshot.rmReadiness, returnTo).primaryAction.href ?? buildViewWorkOrderHref(snapshot.salesOrderId, snapshot.workOrderId);

  }

  const woId = Number(snapshot.workOrderId ?? 0);

  if (woId > 0) {

    return `/material-issue?workOrderId=${encodeURIComponent(String(woId))}&returnTo=${encodeURIComponent(returnTo)}`;

  }

  return buildViewWorkOrderHref(snapshot.salesOrderId);

}



/**

 * Single source of truth for post-GRN next actions on Regular SO flows.

 * Uses process stage, WO existence, RM issue readiness, and production entry presence — UX only.

 */

export function resolvePostGrnNextStep(

  snapshot: PostGrnContinuitySnapshot,

  opts?: { materialIssueReturnTo?: string },

): PostGrnNextStep {

  const sid = snapshot.salesOrderId;

  const sidEnc = encodeURIComponent(String(sid));

  const returnTo =

    opts?.materialIssueReturnTo && opts.materialIssueReturnTo.startsWith("/")

      ? opts.materialIssueReturnTo

      : "/rm-po-grn";

  const grnPosted = {

    headline: RM_PURCHASE_POST_GRN_MESSAGES.fulfilledHeadline,

    detail: RM_PURCHASE_POST_GRN_MESSAGES.fulfilledDetail,

  };



  if (snapshot.processStageKey === "COMPLETED") {

    return {

      stageKey: "COMPLETED",

      headline: RM_PURCHASE_POST_GRN_MESSAGES.workflowCompleteHeadline,

      detail: RM_PURCHASE_POST_GRN_MESSAGES.workflowCompleteDetail,

      nextStepLine: "",

      actionLabel: "View Completed Order",

      actionHref: `/sales-orders?${DRILL_QUERY.salesOrderId}=${sidEnc}`,

      isWorkflowComplete: true,

    };

  }



  if (snapshot.processStageKey === "SALES_BILL_PENDING") {

    return {

      stageKey: "SALES_BILL_PENDING",

      ...grnPosted,

      nextStepLine: "Next step: Complete sales billing for dispatched goods.",

      actionLabel: "Continue To Sales Billing",

      actionHref: `/sales-bills?salesOrderId=${sidEnc}`,

      isWorkflowComplete: false,

    };

  }



  if (snapshot.processStageKey === "DISPATCH_PENDING") {

    return {

      stageKey: "DISPATCH_PENDING",

      ...grnPosted,

      nextStepLine: "Next step: Dispatch finished goods to customer.",

      actionLabel: "Continue To Dispatch",

      actionHref: `/dispatch?salesOrderId=${sidEnc}&source=rm-purchase`,

      isWorkflowComplete: false,

    };

  }



  if (snapshot.processStageKey === "QC_PENDING") {

    return {

      stageKey: "QC_PENDING",

      ...grnPosted,

      nextStepLine: "Next step: Complete production quality inspection.",

      actionLabel: "Continue To QC",

      actionHref: `/qc-entry?salesOrderId=${sidEnc}`,

      secondaryLabel: woExists(snapshot) ? "View Work Order" : undefined,

      secondaryHref: woExists(snapshot) ? buildViewWorkOrderHref(sid, snapshot.workOrderId) : undefined,

      isWorkflowComplete: false,

    };

  }



  /** Case A — WO not created yet after GRN. */

  if (woCreationRequired(snapshot)) {

    return {

      stageKey: "CREATE_WO",

      ...grnPosted,

      nextStepLine: RM_PURCHASE_POST_GRN_MESSAGES.fulfilledNextStep,

      actionLabel: "Create Work Order",

      actionHref: buildCreateWorkOrderHref(sid),

      secondaryLabel: "View RM Stock",

      secondaryHref: buildViewRmStockHref(),

      isWorkflowComplete: false,

    };

  }



  /** Case B — WO exists but RM not issued to Production. */

  if (rmIssueRequired(snapshot)) {

    return {

      stageKey: "MATERIAL_ISSUE",

      ...grnPosted,

      nextStepLine: "Next step: Issue raw material from Store to Production.",

      actionLabel: "Issue RM to Production",

      actionHref: issueRmHref(snapshot, returnTo),

      secondaryLabel: "View Work Order",

      secondaryHref: buildViewWorkOrderHref(sid, snapshot.workOrderId),

      isWorkflowComplete: false,

    };

  }



  /** Case D — Production already started. */

  if (snapshot.hasProductionEntry) {

    return {

      stageKey: "CONTINUE_PRODUCTION",

      ...grnPosted,

      nextStepLine: "Next step: Continue recording production batches.",

      actionLabel: "Continue Production",

      actionHref: buildProductionHref(snapshot),

      secondaryLabel: "View Work Order",

      secondaryHref: buildViewWorkOrderHref(sid, snapshot.workOrderId),

      isWorkflowComplete: false,

    };

  }



  /** Case C — RM issued; production not yet started. */

  if (rmIssuedToProduction(snapshot)) {

    return {

      stageKey: "START_PRODUCTION",

      ...grnPosted,

      nextStepLine: "Next step: Start production against the work order.",

      actionLabel: "Start Production",

      actionHref: buildProductionHref(snapshot),

      secondaryLabel: "View Work Order",

      secondaryHref: buildViewWorkOrderHref(sid, snapshot.workOrderId),

      isWorkflowComplete: false,

    };

  }



  return {

    stageKey: "WO_PENDING",

    ...grnPosted,

    nextStepLine: RM_PURCHASE_POST_GRN_MESSAGES.fulfilledNextStep,

    actionLabel: "Create Work Order",

    actionHref: buildCreateWorkOrderHref(sid),

    secondaryLabel: "View RM Stock",

    secondaryHref: buildViewRmStockHref(),

    isWorkflowComplete: false,

  };

}



/** Loads processStage (sales order) + allocation-first WO case + production presence (read-only). */

export async function fetchPostGrnContinuitySnapshot(salesOrderId: number): Promise<PostGrnContinuitySnapshot> {

  const [so, workspace, workOrders, productionEntries] = await Promise.all([

    apiFetch<{

      id: number;

      docNo?: string | null;

      orderType?: string | null;

      processStage?: { key?: string };

    }>(`/api/sales-orders/${salesOrderId}`),

    apiFetch<{

      selectedWoShortageCase?: {

        workOrderId?: number | null;

        workOrderNo?: string | null;

        allocationFirstStatus?: { key?: string } | null;

      } | null;

      selectedDetail?: { workOrder?: { id?: number; docNo?: string | null } } | null;

    }>(`/api/material-availability/workspace?salesOrderId=${encodeURIComponent(String(salesOrderId))}`).catch(

      () => null,

    ),

    apiFetch<Array<{ id: number; status?: string; lines?: Array<{ id: number }> }>>(

      `/api/production/work-orders?salesOrderId=${encodeURIComponent(String(salesOrderId))}`,

    ).catch(() => []),

    apiFetch<Array<{ id: number }>>(

      `/api/production/production-entries?salesOrderId=${encodeURIComponent(String(salesOrderId))}`,

    ).catch(() => []),

  ]);



  const woCase = workspace?.selectedWoShortageCase ?? null;

  const woFromDetail = workspace?.selectedDetail?.workOrder ?? null;

  const activeWos = (Array.isArray(workOrders) ? workOrders : []).filter(

    (w) => String(w.status ?? "") !== "REJECTED",

  );

  const primaryWo = activeWos[0];

  const workOrderId =

    Number(woCase?.workOrderId ?? woFromDetail?.id ?? primaryWo?.id ?? 0) || null;

  const workOrderLineId = primaryWo?.lines?.[0]?.id ?? null;



  let rmReadiness: ProductionRmReadiness | null = null;

  if (workOrderLineId && workOrderLineId > 0) {

    try {

      const res = await apiFetch<ProductionRmReadiness | { skipped: boolean }>(

        `/api/production/work-order-lines/${workOrderLineId}/rm-readiness`,

      );

      if (!("skipped" in res && res.skipped)) {

        rmReadiness = res as ProductionRmReadiness;

      }

    } catch {

      rmReadiness = null;

    }

  }



  return {

    salesOrderId,

    salesOrderDocNo: so.docNo ?? null,

    orderType: so.orderType ?? null,

    processStageKey: so.processStage?.key ?? "UNKNOWN",

    workOrderId,

    workOrderNo: woCase?.workOrderNo ?? woFromDetail?.docNo ?? null,

    workOrderLineId,

    allocationFirstKey: woCase?.allocationFirstStatus?.key ?? null,

    hasProductionEntry: Array.isArray(productionEntries) && productionEntries.length > 0,

    rmReadiness,

  };

}


