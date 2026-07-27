/**
 * Shared procurement-stage signals for RM queue / pending actions / control tower.
 * Read-model only — no lifecycle mutations.
 */

const { QUEUE_EPS, qtyToNumber } = require("./rmPurchaseHelpers");
const { resolveDemandPoolForSourceType, normalizeDemandPoolKey } = require("./procurementDemandPoolService");
const { productionExecutionPendingActionLabel } = require("./productionExecutionService");
const { buildProductionWorkspaceHrefFromPendingMeta } = require("./productionWorkspaceHref");

const WAITING_FOR_PURCHASE_RM_PO = "Waiting for Purchase to prepare RM PO.";
const PREPARE_RM_PO = "Prepare RM PO";
const STORE_ISSUE_PENDING_ACTION = "Issue Material";
const RM_ISSUED_WAITING_FOR_PRODUCTION = "RM issued — waiting for Production";
const READY_TO_START_PRODUCTION = "Ready to Start Production";
const CREATE_PURCHASE_REQUEST_ACTION = "Create Purchase Request";
const CREATE_PURCHASE_REQUEST_REGULAR_SO_ACTION = "Create Purchase Request — Regular SO";
const APPROVE_MATERIAL_REQUIREMENT_ACTION = "Approve Material Requirement";

function isNoQtyOrderType(orderType) {
  return String(orderType ?? "").trim().toUpperCase() === "NO_QTY";
}

function isCreatePurchaseRequestAction(action) {
  const label = String(action ?? "").trim();
  return label === CREATE_PURCHASE_REQUEST_ACTION || label === CREATE_PURCHASE_REQUEST_REGULAR_SO_ACTION;
}

function isDraftOrPendingApprovalMrStatus(status) {
  const s = String(status ?? "").trim().toUpperCase();
  return s === "DRAFT" || s === "PENDING_APPROVAL";
}

/**
 * Regular SO Create-PR labeling — requires explicit Regular demand pool/source
 * and must never treat NO_QTY (SO/RS flow) as Regular, even when common stock was used.
 */
function isRegularSoProcurementStage(stageOrMeta) {
  if (isNoQtyOrderType(stageOrMeta?.orderType ?? stageOrMeta?.salesOrderOrderType)) {
    return false;
  }
  const pool = String(stageOrMeta?.procurementDemandPool ?? "").trim().toUpperCase();
  if (pool === "REGULAR_SO") return true;
  if (pool === "MPRS") return false;
  const sourceType = String(stageOrMeta?.sourceType ?? "").trim().toUpperCase();
  if (sourceType === "MONTHLY_PLAN") return false;
  return sourceType === "SALES_ORDER" || sourceType === "WORK_ORDER_PLANNING";
}

function createPurchaseRequestActionLabel(stageOrMeta) {
  return isRegularSoProcurementStage(stageOrMeta)
    ? CREATE_PURCHASE_REQUEST_REGULAR_SO_ACTION
    : CREATE_PURCHASE_REQUEST_ACTION;
}

function isPurchaseRole(role) {
  const r = String(role ?? "")
    .trim()
    .toUpperCase();
  return r === "PURCHASE" || r === "ADMIN";
}

function isProductionRole(role) {
  const r = String(role ?? "")
    .trim()
    .toUpperCase();
  return r === "PRODUCTION" || r === "ADMIN";
}

function n(v) {
  return qtyToNumber(v);
}

function deriveOperationalKeyFromCounts({ prLineCount = 0, poLineCount = 0, pendingGrnQty = 0, hasOpenMr = false } = {}) {
  const prCount = n(prLineCount);
  const poCount = n(poLineCount);
  const pendingGrn = n(pendingGrnQty);
  if (pendingGrn > QUEUE_EPS) {
    return { operationalKey: "GRN_PENDING", nextActionKey: "OPEN_GRN" };
  }
  if (poCount > 0) {
    return { operationalKey: "SUPPLIER_PENDING", nextActionKey: "OPEN_PO" };
  }
  if (prCount > 0) {
    return { operationalKey: "PR_PENDING_PO", nextActionKey: "CREATE_PO" };
  }
  if (hasOpenMr) {
    return { operationalKey: "PROCUREMENT_PENDING", nextActionKey: "CREATE_PR" };
  }
  return { operationalKey: null, nextActionKey: null };
}

function resolveProcurementDemandPool(sourceType) {
  const st = String(sourceType ?? "").trim();
  const pool = resolveDemandPoolForSourceType(st);
  if (pool) return pool;
  if (st === "MONTHLY_PLAN") return "MPRS";
  return "REGULAR_SO";
}

function summarizeProcurementStageFromTrace(trace, sourceType) {
  const prLineCount = (trace?.prLines || []).length;
  const poLines = trace?.poLines || [];
  const poLineCount = poLines.length;
  const pendingGrnQty = poLines.reduce((sum, line) => sum + n(line.pendingGrnQty), 0);
  const hasOpenMr = (trace?.openMrLines || []).length > 0;
  const { operationalKey, nextActionKey } = deriveOperationalKeyFromCounts({
    prLineCount,
    poLineCount,
    pendingGrnQty,
    hasOpenMr,
  });
  return {
    prLineCount,
    poLineCount,
    pendingGrnQty,
    operationalKey,
    nextActionKey,
    procurementDemandPool: resolveProcurementDemandPool(sourceType),
  };
}

function summarizeProcurementStageFromMeta(meta) {
  const prLineCount = n(meta?.prLineCount);
  const poLineCount = n(meta?.poLineCount);
  const pendingGrnQty = n(meta?.pendingGrnQty);
  const hasOpenMr = Boolean(meta?.hasOpenMr);
  const derived = deriveOperationalKeyFromCounts({ prLineCount, poLineCount, pendingGrnQty, hasOpenMr });
  let operationalKey = derived.operationalKey;
  let nextActionKey = derived.nextActionKey;

  // Pending GRN qty overrides stale PR_PENDING_PO metadata after PO creation.
  if (pendingGrnQty > QUEUE_EPS) {
    operationalKey = "GRN_PENDING";
    nextActionKey = "OPEN_GRN";
  } else {
    const metaKey = String(meta?.operationalKey ?? "").trim();
    const metaNext = String(meta?.nextActionKey ?? "").trim();
    if (metaKey) {
      operationalKey = metaKey;
      nextActionKey = metaNext || derived.nextActionKey;
    }
  }

  return {
    prLineCount,
    poLineCount,
    pendingGrnQty,
    operationalKey: operationalKey || null,
    nextActionKey: nextActionKey || null,
    procurementDemandPool:
      normalizeDemandPoolKey(meta?.procurementDemandPool) ??
      resolveProcurementDemandPool(meta?.sourceType),
    materialRequirementId: meta?.materialRequirementId != null ? Number(meta.materialRequirementId) : null,
    sourceType: meta?.sourceType ?? null,
    workOrderId: meta?.workOrderId != null ? Number(meta.workOrderId) : null,
    salesOrderId: meta?.salesOrderId != null ? Number(meta.salesOrderId) : null,
    salesOrderDocNo: meta?.salesOrderDocNo ?? meta?.salesOrderNo ?? null,
  };
}

function buildMaterialRequirementApprovalHref(stage) {
  const params = new URLSearchParams({ returnTo: "pending-actions" });
  if (stage.materialRequirementId > 0) {
    params.set("materialRequirementId", String(stage.materialRequirementId));
  }
  if (stage.salesOrderId > 0) params.set("salesOrderId", String(stage.salesOrderId));
  const soDocNo = String(stage.salesOrderDocNo ?? "").trim();
  if (soDocNo) params.set("salesOrderDocNo", soDocNo);
  return `/material-planning?${params.toString()}`;
}

function buildProcurementWorkspaceHref(stage) {
  const params = new URLSearchParams({ returnTo: "pending-actions" });
  const pool = stage.procurementDemandPool || "REGULAR_SO";
  params.set("demandPool", pool);
  if (stage.materialRequirementId > 0) {
    params.set("materialRequirementId", String(stage.materialRequirementId));
  }
  if (stage.workOrderId > 0) params.set("workOrderId", String(stage.workOrderId));
  if (stage.salesOrderId > 0) params.set("salesOrderId", String(stage.salesOrderId));
  const soDocNo = String(stage.salesOrderDocNo ?? "").trim();
  if (soDocNo) params.set("salesOrderDocNo", soDocNo);
  return `/procurement-planning?${params.toString()}`;
}

function buildRmControlCenterHref(stage, rmItemId) {
  const params = new URLSearchParams({ returnTo: "pending-actions", onlyBlocked: "1" });
  if (stage.workOrderId > 0) params.set("workOrderId", String(stage.workOrderId));
  if (stage.salesOrderId > 0) params.set("salesOrderId", String(stage.salesOrderId));
  if (stage.materialRequirementId > 0) params.set("materialRequirementId", String(stage.materialRequirementId));
  if (rmItemId != null && Number(rmItemId) > 0) params.set("rmItemId", String(rmItemId));
  return `/reports/rm-shortage?${params.toString()}`;
}

/** REGULAR_SO — Create WO opens Prepare WO (does not create the WO). */
function buildRegularSoPrepareWoHref(salesOrderId, opts = {}) {
  const params = new URLSearchParams({
    salesOrderId: String(salesOrderId),
    source: "regular_so",
  });
  if (opts.from) params.set("from", String(opts.from));
  const itemId = opts.itemId != null ? Number(opts.itemId) : 0;
  if (itemId > 0) params.set("itemId", String(itemId));
  const fgItemId = opts.fgItemId != null ? Number(opts.fgItemId) : 0;
  if (fgItemId > 0) params.set("fgItemId", String(fgItemId));
  return `/work-orders/prepare?${params.toString()}`;
}

/**
 * Role-aware pending action label + href from RM risk metadata.
 * @param {object} meta
 * @param {object} [queueHints]
 * @param {string} [role] STORE | PURCHASE | ADMIN
 */
function resolveRmRiskPendingAction(meta, queueHints = {}, role = "STORE") {
  const stage = summarizeProcurementStageFromMeta(meta);
  const queueType = String(queueHints.queueType ?? meta?.queueType ?? "").toUpperCase();
  const freeStockQty = n(queueHints.freeStockQty ?? meta?.freeStockQty);
  const netShortage = n(queueHints.netShortageAfterIncomingQty ?? meta?.netShortageAfterIncomingQty);
  const rmItemId = meta?.rmItemId != null ? Number(meta.rmItemId) : null;
  const operationalKey = String(meta?.operationalKey ?? "").toUpperCase();
  const nextActionKey = String(meta?.nextActionKey ?? "").toUpperCase();

  const stockReadyForIssue =
    queueType === "RM_READY_FOR_ISSUE" || (queueType === "PMR_WAITING_ISSUE" && freeStockQty > QUEUE_EPS);

  if (stockReadyForIssue) {
    const params = new URLSearchParams({
      bucket: "readyToIssue",
      returnTo: "pending-actions",
      from: "pending-actions",
    });
    if (stage.workOrderId > 0) params.set("workOrderId", String(stage.workOrderId));
    if (stage.salesOrderId > 0) params.set("salesOrderId", String(stage.salesOrderId));
    if (stage.materialRequirementId > 0) params.set("materialRequirementId", String(stage.materialRequirementId));
    return { action: STORE_ISSUE_PENDING_ACTION, href: `/material-issue?${params.toString()}` };
  }

  const procurementDone =
    Boolean(meta?.procurementCompletedForCase) || String(meta?.mrStatus ?? "").trim() === "FULLY_PROCURED";

  const createWoReady =
    !(stage.workOrderId > 0) &&
    stage.salesOrderId > 0 &&
    (queueType === "RM_RECEIVED_CREATE_WO" ||
      operationalKey === "RM_RECEIVED_CREATE_WO" ||
      operationalKey === "RM_RECEIVED" ||
      (nextActionKey === "CREATE_WO" && procurementDone));
  if (createWoReady) {
    return {
      action: "Create Work Order in Prepare WO",
      href: buildRegularSoPrepareWoHref(stage.salesOrderId, { from: "pending-actions" }),
    };
  }

  if (procurementDone && queueType === "READY_TO_RELEASE_WO") {
    const released = Boolean(meta?.materialReleasedToProduction);
    const executionStarted =
      String(meta?.productionExecutionStatus ?? "NOT_STARTED").trim().toUpperCase() !== "NOT_STARTED";
    const hasProductionEntry = Boolean(meta?.hasProductionEntry);
    if (isProductionRole(role)) {
      const execStatus = meta?.productionExecutionStatus ?? "NOT_STARTED";
      const action = productionExecutionPendingActionLabel(execStatus) ?? READY_TO_START_PRODUCTION;
      return {
        action,
        href: buildProductionWorkspaceHrefFromPendingMeta(
          {
            ...meta,
            workOrderId: stage.workOrderId,
            salesOrderId: stage.salesOrderId,
          },
          "pending-actions",
          { actionLabel: action },
        ),
      };
    }
    if (!isProductionRole(role)) {
      if (released || executionStarted || hasProductionEntry) {
        return {
          action: RM_ISSUED_WAITING_FOR_PRODUCTION,
          href: buildRmControlCenterHref(stage, rmItemId),
        };
      }
      return {
        action: "Release to Production",
        href: (() => {
          const params = new URLSearchParams({ returnTo: "pending-actions" });
          if (stage.workOrderId > 0) params.set("workOrderId", String(stage.workOrderId));
          return `/material-issue?${params.toString()}`;
        })(),
      };
    }
    return {
      action: RM_ISSUED_WAITING_FOR_PRODUCTION,
      href: buildRmControlCenterHref(stage, rmItemId),
    };
  }

  if (procurementDone) {
    return {
      action: queueHints.recommendedAction || meta?.blockerReason || "Track procurement",
      href: buildRmControlCenterHref(stage, rmItemId),
    };
  }

  if (stage.operationalKey === "GRN_PENDING" || stage.pendingGrnQty > QUEUE_EPS || queueType === "PO_WAITING_GRN") {
    const primaryPoId = meta?.primaryPoId != null ? Number(meta.primaryPoId) : 0;
    const href =
      primaryPoId > 0
        ? `/rm-po-grn/${primaryPoId}?openGrn=1&from=pending-actions`
        : "/rm-po-grn?focus=pending-requests&from=pending-actions";
    return { action: "Create GRN", href };
  }

  if (stage.operationalKey === "PR_PENDING_PO" || (stage.prLineCount > 0 && stage.poLineCount === 0)) {
    if (isPurchaseRole(role)) {
      return {
        action: PREPARE_RM_PO,
        href: buildProcurementWorkspaceHref(stage),
      };
    }
    return {
      action: WAITING_FOR_PURCHASE_RM_PO,
      href: buildProcurementWorkspaceHref(stage),
    };
  }

  const needsCreatePr =
    stage.operationalKey === "PROCUREMENT_PENDING" ||
    queueType === "WAITING_PURCHASE_ACTION" ||
    queueType === "WO_BLOCKED_RM_SHORTAGE" ||
    (queueType === "PMR_WAITING_ISSUE" && netShortage > QUEUE_EPS && stage.prLineCount === 0);

  if (needsCreatePr && stage.prLineCount === 0 && !procurementDone) {
    // NO_QTY procurement is Monthly Planning / MPRS — never emit Regular Create PR.
    if (isNoQtyOrderType(meta?.orderType ?? meta?.salesOrderOrderType ?? stage.orderType)) {
      return {
        action: null,
        href: buildRmControlCenterHref(stage, rmItemId),
        excludeFromPendingActions: true,
      };
    }

    const mrStatus = String(meta?.mrStatus ?? meta?.requisitionStatus ?? "").trim();
    if (isDraftOrPendingApprovalMrStatus(mrStatus) && stage.materialRequirementId > 0) {
      return {
        action: APPROVE_MATERIAL_REQUIREMENT_ACTION,
        href: buildMaterialRequirementApprovalHref(stage),
      };
    }

    const regularSo = isRegularSoProcurementStage({ ...stage, ...meta, orderType: meta?.orderType ?? stage.orderType });
    const hasPurchaseVisibleMr =
      Boolean(meta?.hasOpenMr) ||
      (stage.materialRequirementId > 0 && !isDraftOrPendingApprovalMrStatus(mrStatus));
    const regularSoShortageHandoff =
      regularSo &&
      stage.salesOrderId > 0 &&
      (hasPurchaseVisibleMr ||
        netShortage > QUEUE_EPS ||
        queueType === "WO_BLOCKED_RM_SHORTAGE" ||
        queueType === "WAITING_PURCHASE_ACTION" ||
        stage.operationalKey === "PROCUREMENT_PENDING");

    // Create PR only when Store can complete it in Procurement Workspace (MR or REGULAR_SO shortage).
    if (!hasPurchaseVisibleMr && !regularSoShortageHandoff) {
      return {
        action: queueHints.recommendedAction || "Raise Store Requisition",
        href: buildRmControlCenterHref(stage, rmItemId),
      };
    }

    return {
      action: createPurchaseRequestActionLabel({ ...stage, ...meta }),
      href: buildProcurementWorkspaceHref(stage),
    };
  }

  if (queueType === "WAITING_PURCHASE_ACTION" && !isPurchaseRole(role)) {
    return {
      action: WAITING_FOR_PURCHASE_RM_PO,
      href: buildProcurementWorkspaceHref(stage),
    };
  }

  return {
    action: queueHints.recommendedAction || meta?.blockerReason || "Open",
    href: buildRmControlCenterHref(stage, rmItemId),
  };
}

/** @deprecated Use resolveRmRiskPendingAction with role STORE */
function resolveRmRiskStorePendingAction(meta, queueHints = {}) {
  return resolveRmRiskPendingAction(meta, queueHints, "STORE");
}

module.exports = {
  WAITING_FOR_PURCHASE_RM_PO,
  PREPARE_RM_PO,
  RM_ISSUED_WAITING_FOR_PRODUCTION,
  READY_TO_START_PRODUCTION,
  CREATE_PURCHASE_REQUEST_ACTION,
  CREATE_PURCHASE_REQUEST_REGULAR_SO_ACTION,
  APPROVE_MATERIAL_REQUIREMENT_ACTION,
  deriveOperationalKeyFromCounts,
  summarizeProcurementStageFromTrace,
  summarizeProcurementStageFromMeta,
  resolveProcurementDemandPool,
  buildProcurementWorkspaceHref,
  buildRmControlCenterHref,
  buildRegularSoPrepareWoHref,
  resolveRmRiskPendingAction,
  resolveRmRiskStorePendingAction,
  isPurchaseRole,
  isCreatePurchaseRequestAction,
  isNoQtyOrderType,
  isRegularSoProcurementStage,
  createPurchaseRequestActionLabel,
};
