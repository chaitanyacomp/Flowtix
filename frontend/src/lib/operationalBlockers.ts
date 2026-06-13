import type { ProcurementPendingRow } from "../components/erp/ProcurementPendingDashboardCard";
import type { WoPrepareDashboardQueues } from "../components/erp/WoPrepareOperationalQueuesCard";
import { productionWorkspaceHref } from "./materialWorkflowLinks";
import { GUIDED_WORKFLOW_CTA } from "./rmGuidedWorkflow";
import { buildRmControlCenterHref } from "./woProcurementContinuity";
import { woPreparePrepareHref } from "./woPrepareOperationalStage";

/** One dashboard row = one SO (or orphan MR) with a single next action. */
export type OperationalSoAction = {
  key: string;
  salesOrderId: number;
  salesOrderDocNo: string | null;
  primaryFgName: string | null;
  customerName?: string;
  stageLabel: string;
  detailLine?: string;
  statusLine?: string | null;
  actionLabel: string;
  actionTo: string;
  variant: "ready" | "blocker";
};

/** @deprecated Use OperationalSoAction — kept for tests migrating gradually. */
export type OperationalBlockerRow = OperationalSoAction & { blockedLabel: string };

export type OperationalBlockerReadyRow = {
  salesOrderId: number;
  salesOrderDocNo: string | null;
  primaryFgName: string | null;
  customerName: string;
};

const PRIORITY_READY = 0;
const PRIORITY_RM_SHORTAGE = 1;
const PRIORITY_STORE_ISSUE = 2;
const PRIORITY_ALLOCATION_FIRST = 3;
const PRIORITY_PROCUREMENT = 4;

function procurementBlockerDetail(row: {
  docNo?: string | null;
  materialRequirementId: number;
  shortageRmLineCount: number;
  pendingMrRefs?: string;
}): string {
  const mr = row.docNo ?? row.pendingMrRefs ?? `MR #${row.materialRequirementId}`;
  const count = row.shortageRmLineCount;
  if (count > 0) return `${mr} · ${count} RM shortage${count === 1 ? "" : "s"}`;
  return `${mr} pending`;
}


function isProcurementCompleteForDashboard(row: ProcurementPendingRow): boolean {
  if (row.operationalKey === "STORE_ISSUE_PENDING") return false;
  if (row.operationalKey === "RM_READY") return false;
  const remaining = row.totalRemainingQty;
  if (remaining != null && remaining <= 1e-9) {
    const po = (row.pendingPoStatus ?? "").toLowerCase();
    const grn = (row.pendingGrnStatus ?? "").toLowerCase();
    const noOpenPo = po.includes("complete") || po === "—" || po.includes("no po");
    const noOpenGrn = grn.includes("complete") || grn === "—" || grn.includes("no grn");
    if (noOpenPo && noOpenGrn) return false;
  }
  return false;
}

function actionDedupeKey(input: { workOrderId?: number | null; salesOrderId?: number | null; materialRequirementId?: number | null }) {
  const woId = Number(input.workOrderId ?? 0);
  if (woId > 0) return `wo:${woId}`;
  const soId = Number(input.salesOrderId ?? 0);
  if (soId > 0) return `so:${soId}`;
  const mrId = Number(input.materialRequirementId ?? 0);
  return mrId > 0 ? `mr:${mrId}` : "orphan:unknown";
}

function setDedupedAction(
  map: Map<string, OperationalSoAction & { priority: number }>,
  key: string,
  action: OperationalSoAction,
  priority: number,
) {
  const cur = map.get(key);
  if (!cur || priority < cur.priority) {
    map.set(key, { ...action, priority });
  }
}

/**
 * Merges procurement-pending + WO-prepare queues into one deduped list.
 * One work order (or SO before WO) = one primary action.
 * Priority: Ready for WO > Store issue > Allocation > Procurement monitoring.
 */
export function buildOperationalSoActions(
  procurement: ProcurementPendingRow[] | null | undefined,
  queues: WoPrepareDashboardQueues | null | undefined,
  storeIssuePending?: ProcurementPendingRow[] | null,
  allocationFirstPending?: Array<{
    workOrderId?: number | null;
    workOrderNo?: string | null;
    salesOrderId?: number | null;
    salesOrderDocNo?: string | null;
    primaryFgName?: string | null;
    materialRequirementId?: number | null;
    operationalKey?: string;
    operationalLabel?: string;
    nextActionKey?: string;
  }> | null,
): OperationalSoAction[] {
  const q = queues ?? { rmShortageBlocking: [], purchaseGrnPending: [], readyForWoCreation: [] };
  const readySoIds = new Set(q.readyForWoCreation.map((r) => r.salesOrderId));
  const byKey = new Map<string, OperationalSoAction & { priority: number }>();

  for (const row of allocationFirstPending ?? []) {
    const soId = Number(row.salesOrderId ?? 0);
    if (soId > 0 && readySoIds.has(soId)) continue;
    const woId = Number(row.workOrderId ?? 0);
    if (woId <= 0 && row.operationalKey !== "RM_RECEIVED" && row.nextActionKey !== "CREATE_WO") continue;
    const rowKey = actionDedupeKey({
      workOrderId: woId > 0 ? woId : undefined,
      salesOrderId: soId,
      materialRequirementId: row.materialRequirementId,
    });
    const label = String(row.operationalLabel ?? "Waiting RM");
    const stageLabel =
      row.operationalKey === "RM_RECEIVED"
        ? "RM received in Store"
        : row.operationalKey === "READY_FOR_ISSUE"
          ? "Ready for issue"
          : row.operationalKey === "PARTIALLY_ALLOCATED"
            ? "Partially allocated"
            : "Waiting RM";
    const issueHref = `/material-issue?workOrderId=${woId}&returnTo=dashboard`;
    const productionHref = productionWorkspaceHref(woId);
    const actionLabel =
      row.operationalKey === "READY_FOR_ISSUE"
        ? "Issue RM to Production"
        : row.operationalKey === "RM_RECEIVED" || row.nextActionKey === "CREATE_WO"
          ? "Create Work Order"
          : row.operationalKey === "READY_FOR_PRODUCTION"
            ? "Open Production Workspace"
            : row.operationalKey === "PARTIALLY_ALLOCATED"
              ? "Review Allocation"
              : "Open RM Control Center";
    const action: OperationalSoAction = {
      key: rowKey,
      salesOrderId: soId,
      salesOrderDocNo: row.salesOrderDocNo ?? null,
      primaryFgName: row.primaryFgName ?? null,
      stageLabel,
      detailLine: row.workOrderNo ? `${row.workOrderNo} · ${label}` : label,
      statusLine: label,
      actionLabel,
      actionTo:
        row.operationalKey === "READY_FOR_ISSUE"
          ? issueHref
          : row.operationalKey === "RM_RECEIVED" || row.nextActionKey === "CREATE_WO"
            ? woPreparePrepareHref(soId)
            : row.operationalKey === "READY_FOR_PRODUCTION"
              ? productionHref
              : buildRmControlCenterHref({
                  workOrderId: woId,
                  salesOrderId: soId > 0 ? soId : undefined,
                  materialRequirementId: row.materialRequirementId ?? undefined,
                  returnTo: "dashboard",
                }),
      variant: row.operationalKey === "RM_RECEIVED" ? "ready" : "blocker",
    };
    const priority =
      row.operationalKey === "RM_RECEIVED" || row.nextActionKey === "CREATE_WO"
        ? PRIORITY_READY
        : PRIORITY_ALLOCATION_FIRST;
    setDedupedAction(byKey, rowKey, action, priority);
  }

  for (const row of storeIssuePending ?? []) {
    const soId = row.salesOrderId ?? 0;
    if (soId > 0 && readySoIds.has(soId)) continue;
    const woId = Number(row.workOrderId ?? 0);
    const rowKey = actionDedupeKey({
      workOrderId: woId,
      salesOrderId: soId,
      materialRequirementId: row.materialRequirementId,
    });
    const action: OperationalSoAction = {
      key: rowKey,
      salesOrderId: soId,
      salesOrderDocNo: row.salesOrderDocNo,
      primaryFgName: row.primaryFgName,
      stageLabel: "RM ready in Store",
      detailLine: row.workOrderNo
        ? `${row.workOrderNo} · issue RM to Production`
        : "Issue RM to Production",
      statusLine: row.operationalLabel ?? null,
      actionLabel: "Issue RM to Production",
      actionTo: woId > 0 ? `/material-issue?workOrderId=${woId}&returnTo=dashboard` : buildRmControlCenterHref({
        salesOrderId: soId > 0 ? soId : undefined,
        materialRequirementId: row.materialRequirementId,
        returnTo: "dashboard",
      }),
      variant: "blocker",
    };
    setDedupedAction(byKey, rowKey, action, PRIORITY_STORE_ISSUE);
  }

  for (const row of procurement ?? []) {
    if (isProcurementCompleteForDashboard(row)) continue;
    const soId = row.salesOrderId ?? 0;
    if (soId > 0 && readySoIds.has(soId)) continue;
    const woId = Number(row.workOrderId ?? 0);
    const rowKey = actionDedupeKey({
      workOrderId: woId,
      salesOrderId: soId,
      materialRequirementId: row.materialRequirementId,
    });
    if (byKey.has(rowKey)) continue;

    const detailLine = procurementBlockerDetail(row);
    const action: OperationalSoAction = {
      key: rowKey,
      salesOrderId: soId,
      salesOrderDocNo: row.salesOrderDocNo,
      primaryFgName: row.primaryFgName,
      stageLabel: "Procurement blocked",
      detailLine,
      actionLabel: GUIDED_WORKFLOW_CTA.DASHBOARD_CONTINUE,
      actionTo: buildRmControlCenterHref({
        workOrderId: row.workOrderId ?? undefined,
        salesOrderId: soId > 0 ? soId : undefined,
        materialRequirementId: row.materialRequirementId,
        returnTo: "dashboard",
      }),
      variant: "blocker",
    };

    setDedupedAction(byKey, rowKey, action, PRIORITY_PROCUREMENT);
  }

  for (const row of q.rmShortageBlocking) {
    const soId = Number(row.salesOrderId ?? 0);
    if (soId <= 0) continue;
    if (readySoIds.has(soId)) continue;
    const rowKey = actionDedupeKey({ salesOrderId: soId });
    const shortageCount = Number(row.shortageRmCount ?? 0);
    const shortageDetail =
      shortageCount > 0
        ? `${shortageCount} RM shortage line${shortageCount === 1 ? "" : "s"}`
        : null;
    const mrDetail = row.pendingMrRefs ? `MR ${row.pendingMrRefs}` : null;
    const detailLine = [shortageDetail, mrDetail].filter(Boolean).join(" · ") || row.operationalLabel;
    setDedupedAction(
      byKey,
      rowKey,
      {
        key: rowKey,
        salesOrderId: soId,
        salesOrderDocNo: row.salesOrderDocNo,
        primaryFgName: row.primaryFgName,
        customerName: row.customerName,
        stageLabel: "RM shortage blocking Work Order",
        detailLine,
        statusLine: "Store Department · Raise RM Requirement",
        actionLabel: "Open RM Control Center",
        actionTo: buildRmControlCenterHref({
          salesOrderId: soId,
          onlyBlocked: true,
          returnTo: "dashboard",
        }),
        variant: "blocker",
      },
      PRIORITY_RM_SHORTAGE,
    );
  }

  for (const row of q.readyForWoCreation) {
    const rowKey = actionDedupeKey({ salesOrderId: row.salesOrderId });
    setDedupedAction(
      byKey,
      rowKey,
      {
        key: rowKey,
        salesOrderId: row.salesOrderId,
        salesOrderDocNo: row.salesOrderDocNo,
        primaryFgName: row.primaryFgName,
        customerName: row.customerName,
        stageLabel: "Ready for WO",
        actionLabel: "Create Work Order",
        actionTo: woPreparePrepareHref(row.salesOrderId),
        variant: "ready",
      },
      PRIORITY_READY,
    );
  }

  return Array.from(byKey.values())
    .sort((a, b) => a.priority - b.priority || a.salesOrderId - b.salesOrderId)
    .map(({ priority: _p, ...row }) => row);
}

/** @deprecated Prefer buildOperationalSoActions */
export function buildOperationalBlockerRows(
  procurement: ProcurementPendingRow[] | null | undefined,
  queues: WoPrepareDashboardQueues | null | undefined,
  storeIssuePending?: ProcurementPendingRow[] | null,
  allocationFirstPending?: Array<{
    workOrderId?: number | null;
    workOrderNo?: string | null;
    salesOrderId?: number | null;
    salesOrderDocNo?: string | null;
    primaryFgName?: string | null;
    materialRequirementId?: number | null;
    operationalKey?: string;
    operationalLabel?: string;
    nextActionKey?: string;
  }> | null,
): { blockers: OperationalBlockerRow[]; readyForWo: OperationalBlockerReadyRow[] } {
  const actions = buildOperationalSoActions(procurement, queues, storeIssuePending, allocationFirstPending);
  const blockers = actions
    .filter((a) => a.variant === "blocker")
    .map((a) => ({ ...a, blockedLabel: a.stageLabel }));
  const readyForWo = actions
    .filter((a) => a.variant === "ready")
    .map((a) => ({
      salesOrderId: a.salesOrderId,
      salesOrderDocNo: a.salesOrderDocNo,
      primaryFgName: a.primaryFgName,
      customerName: a.customerName ?? "—",
    }));
  return { blockers, readyForWo };
}
