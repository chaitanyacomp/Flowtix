/**
 * REGULAR SO operational guidance — labels, next-step CTAs, and banner priority only.
 * No business logic / calculations.
 */

import type { ProductionRmReadiness } from "../components/erp/ProductionRmReadinessStrip";
import { isProductionBlockedByRmReadiness } from "../components/erp/ProductionRmReadinessStrip";
import { productionWorkspaceHref } from "./productionNavigation";
import type { ProductionScopedNavInput } from "./productionNavigation";
import { materialIssueWorkspaceHref, materialRequestsQueueHref } from "./materialWorkflowLinks";

export type RegularSoNextStepAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  testId?: string;
};

export type RegularSoNextStepModel = {
  statusTitle: string;
  statusSubtitle?: string;
  blockingReason?: string;
  primaryAction: RegularSoNextStepAction;
};

export function buildRmIssueNextStep(
  readiness: ProductionRmReadiness,
  returnTo = "work-orders",
): RegularSoNextStepModel {
  const woId = readiness.workOrderId;
  if (readiness.gate === "NO_PMR" || readiness.gate === "PMR_DRAFT_ONLY") {
    return {
      statusTitle: "Waiting for RM Issue",
      statusSubtitle: "Production material request must be submitted before Store can issue RM.",
      blockingReason: readiness.gate === "NO_PMR" ? "No open material request" : "Material request is still draft",
      primaryAction: {
        label: "Issue RM to Production",
        href: materialRequestsQueueHref({
          workOrderId: woId,
          returnTo,
          tab: "create",
        }),
        testId: "next-issue-rm-pmr",
      },
    };
  }
  if (readiness.gate === "WAITING_STORE_ISSUE") {
    const pmrId = readiness.latestPmrId;
    return {
      statusTitle: "Waiting for Store RM Issue",
      statusSubtitle: "Store must issue RM to production before you can save or approve production.",
      blockingReason: "PMR is open — waiting for store issue",
      primaryAction: {
        label: "Issue RM to Production",
        href:
          pmrId && pmrId > 0
            ? materialIssueWorkspaceHref({ pmrId, workOrderId: woId, returnTo: "production-workspace" })
            : `/material-issue?workOrderId=${encodeURIComponent(String(woId))}&returnTo=${encodeURIComponent(returnTo)}`,
        testId: "next-issue-rm-material-issue",
      },
    };
  }
  const pmrId = readiness.latestPmrId;
  return {
    statusTitle: "Waiting for RM Issue",
    statusSubtitle: "Store must issue allocated RM to Production before recording batches.",
    blockingReason: "RM not yet issued to production",
    primaryAction: {
      label: "Issue RM to Production",
      href:
        pmrId && pmrId > 0
          ? materialIssueWorkspaceHref({ pmrId, workOrderId: woId, returnTo })
          : `/material-issue?workOrderId=${encodeURIComponent(String(woId))}&returnTo=${encodeURIComponent(returnTo)}`,
      testId: "next-issue-rm-material-issue",
    },
  };
}

export function buildRmReadyProductionNextStep(
  workOrderId: number,
  workOrderLineId?: number,
  navCtx?: Pick<ProductionScopedNavInput, "salesOrderId" | "orderType" | "cycleId">,
): RegularSoNextStepModel {
  return {
    statusTitle: "RM Ready – Enter Production",
    statusSubtitle: "Material is issued. Record the next production batch.",
    primaryAction: {
      label: "Enter Production",
      href: productionWorkspaceHref(workOrderId, workOrderLineId, navCtx),
      testId: "next-enter-production",
    },
  };
}

export function buildCompleteQaNextStep(salesOrderId: number, productionId?: number | null): RegularSoNextStepModel {
  const q = new URLSearchParams({ salesOrderId: String(salesOrderId) });
  if (productionId && productionId > 0) q.set("productionId", String(productionId));
  return {
    statusTitle: "Production Approved – Complete QA",
    statusSubtitle: "QC is required before finished goods can be dispatched.",
    primaryAction: {
      label: "Complete QA",
      href: `/qc-entry?${q.toString()}`,
      testId: "next-complete-qa",
    },
  };
}

export function buildCreateSalesBillNextStep(dispatchId: number): RegularSoNextStepModel {
  return {
    statusTitle: "Dispatch Finalized – Create Sales Bill",
    statusSubtitle: "Billing can be raised against the finalized dispatch.",
    primaryAction: {
      label: "Create Sales Bill",
      href: `/sales-bills/new?dispatchId=${encodeURIComponent(String(dispatchId))}`,
      testId: "next-create-sales-bill",
    },
  };
}

export function buildExportTallyNextStep(salesBillId: number): RegularSoNextStepModel {
  return {
    statusTitle: "Sales Bill Created – Export to Tally",
    statusSubtitle: "Export the invoice to Tally when ready.",
    primaryAction: {
      label: "Export to Tally",
      href: `/sales-bills/${encodeURIComponent(String(salesBillId))}?export=tally`,
      testId: "next-export-tally",
    },
  };
}

export function buildGoToDispatchNextStep(salesOrderId: number): RegularSoNextStepModel {
  return {
    statusTitle: "Ready to Ship",
    statusSubtitle: "QC-accepted stock is available for dispatch.",
    primaryAction: {
      label: "Go to Dispatch",
      href: `/dispatch?salesOrderId=${encodeURIComponent(String(salesOrderId))}`,
      testId: "next-go-dispatch",
    },
  };
}

export function readinessBlocksProduction(readiness: ProductionRmReadiness | null): boolean {
  return isProductionBlockedByRmReadiness(readiness);
}

export type ProductionStickyContext = {
  salesOrderId: number;
  workOrderId: number;
  itemName: string;
  woDocNo?: string | null;
  soDocNo?: string | null;
};

/** Preserve SO/WO/item in chrome when WO line drops off pending-only picker after approval. */
export function resolveProductionStickyContext(args: {
  selected?: {
    salesOrderId: number;
    workOrderId: number;
    fgItem: { itemName: string };
  } | null;
  woId: number;
  wolId: number;
  workOrders: Array<{ id: number; salesOrderId: number; docNo?: string | null; lines?: Array<{ id: number; fgItem?: { itemName: string } }> }>;
  entries: Array<{
    workOrderLine?: {
      id: number;
      fgItem?: { itemName: string };
      workOrder?: { id: number; salesOrderId: number; docNo?: string | null };
    };
  }>;
  focusSo?: { id?: number; docNo?: string | null } | null;
}): ProductionStickyContext | null {
  if (args.selected) {
    const wo = args.workOrders.find((w) => w.id === args.selected!.workOrderId);
    return {
      salesOrderId: args.selected.salesOrderId,
      workOrderId: args.selected.workOrderId,
      itemName: args.selected.fgItem.itemName,
      woDocNo: wo?.docNo ?? null,
      soDocNo:
        args.focusSo?.id && args.selected.salesOrderId === args.focusSo.id ? args.focusSo?.docNo : undefined,
    };
  }
  const woFromUrl = args.woId > 0 ? args.workOrders.find((w) => w.id === args.woId) : null;
  const entryFromWol =
    args.wolId > 0
      ? args.entries.find((e) => Number(e.workOrderLine?.id ?? 0) === args.wolId)
      : args.entries.find((e) => Number(e.workOrderLine?.workOrder?.id ?? 0) === args.woId);
  const wol = entryFromWol?.workOrderLine;
  const woId = args.woId > 0 ? args.woId : Number(wol?.workOrder?.id ?? woFromUrl?.id ?? 0);
  const soId =
    woFromUrl?.salesOrderId ??
    Number(wol?.workOrder?.salesOrderId ?? 0) ??
    0;
  if (!(woId > 0) || !(soId > 0)) return null;
  const lineFromWo = woFromUrl?.lines?.find((l) => l.id === args.wolId) ?? woFromUrl?.lines?.[0];
  const itemName = wol?.fgItem?.itemName ?? lineFromWo?.fgItem?.itemName ?? "—";
  return {
    salesOrderId: soId,
    workOrderId: woId,
    itemName,
    woDocNo: woFromUrl?.docNo ?? wol?.workOrder?.docNo ?? null,
    soDocNo: args.focusSo?.docNo ?? null,
  };
}

export type ProductionStickyMetrics = {
  woLineQty: number;
  usedQty: number;
  remainingQty: number;
};

/** Keep planned/produced/remaining visible when WO line drops off pending-only picker. */
export function resolveProductionStickyMetrics(args: {
  selectedMetrics: ProductionStickyMetrics | null;
  wolId: number;
  flatLines: Array<{ id: number; qty: string | number; approvedProducedQty?: number; remainingQty?: number }>;
}): ProductionStickyMetrics | null {
  if (args.selectedMetrics) return args.selectedMetrics;
  if (!(args.wolId > 0)) return null;
  const line = args.flatLines.find((l) => Number(l.id) === Number(args.wolId));
  if (!line) return null;
  const woLineQty = Number(line.qty);
  const usedQty = line.approvedProducedQty ?? 0;
  const remainingQty =
    line.remainingQty != null ? Number(line.remainingQty) : Math.max(0, woLineQty - usedQty);
  if (!Number.isFinite(woLineQty)) return null;
  return { woLineQty, usedQty, remainingQty };
}
