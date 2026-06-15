/**
 * Control Tower normalized operational row contract (Prompt 2–3).
 * Maps existing dashboard queue DTOs into a single read-model shape — no workflow changes.
 */

const {
  CONTROL_TOWER_STATUSES,
  mapSourceToCurrentStatus,
  buildSourceLineageMetadata,
} = require("./controlTowerStatusMap");

const ROW_TYPES = Object.freeze({
  RM_RISK: "RM_RISK",
  PRODUCTION_QUEUE: "PRODUCTION_QUEUE",
  QA_QUEUE: "QA_QUEUE",
  QA_REWORK: "QA_REWORK",
  DISPATCH_BACKLOG: "DISPATCH_BACKLOG",
  CONTINUE_WORKING: "CONTINUE_WORKING",
  NO_QTY_PLANNING: "NO_QTY_PLANNING",
  WO_PLANNING: "WO_PLANNING",
});

const DOCUMENT_TYPES = Object.freeze({
  SALES_ORDER: "SALES_ORDER",
  WORK_ORDER: "WORK_ORDER",
  PRODUCTION: "PRODUCTION",
  QA: "QA",
  DISPATCH: "DISPATCH",
  RM_SHORTAGE: "RM_SHORTAGE",
  NO_QTY: "NO_QTY",
});

const RISK_LEVELS = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
});

const VISIBLE_OWNERS = Object.freeze({
  ADMIN: "ADMIN",
  PURCHASE: "PURCHASE",
  STORE: "STORE",
  PRODUCTION: "PRODUCTION",
  QA: "QA",
  SYSTEM: "SYSTEM",
});

const SOURCE_MODULES = Object.freeze({
  RM_RISK: "RM_RISK",
  PRODUCTION_QUEUE: "PRODUCTION_QUEUE",
  QC_QUEUE: "QC_QUEUE",
  QA_REWORK: "QA_REWORK",
  DISPATCH_BACKLOG: "DISPATCH_BACKLOG",
  CONTINUE_WORKING: "CONTINUE_WORKING",
  NO_QTY_PLANNING: "NO_QTY_PLANNING",
  WO_PLANNING: "WO_PLANNING",
});

const WO_PLANNING_STORE_OPERATIONAL_KEYS = Object.freeze(["RM_SHORTAGE", "PURCHASE_GRN_PENDING"]);

/**
 * @typedef {Object} ControlTowerNormalizedRow
 * @property {string} rowType
 * @property {string} documentType
 * @property {string|null} documentNo
 * @property {string} currentStatus
 * @property {string} currentOwner
 * @property {string} nextAction
 * @property {number|null} ageHours
 * @property {string} riskLevel
 * @property {string} sourceModule
 * @property {string} sourceId
 * @property {Record<string, unknown>} metadata
 */

/**
 * @param {Partial<ControlTowerNormalizedRow>} fields
 * @returns {ControlTowerNormalizedRow}
 */
function buildNormalizedRow(fields) {
  const rowType = String(fields.rowType ?? "UNKNOWN");
  const documentType = String(fields.documentType ?? "SALES_ORDER");
  const documentNo = fields.documentNo != null ? String(fields.documentNo) : null;
  const currentStatus = String(fields.currentStatus ?? "UNKNOWN");
  const currentOwner = String(fields.currentOwner ?? VISIBLE_OWNERS.ADMIN);
  const nextAction = String(fields.nextAction ?? "—");
  const ageHours =
    fields.ageHours != null && Number.isFinite(Number(fields.ageHours))
      ? Math.max(0, Math.floor(Number(fields.ageHours)))
      : null;
  const riskLevel =
    fields.riskLevel && RISK_LEVELS[fields.riskLevel] ? fields.riskLevel : RISK_LEVELS.LOW;
  const sourceModule = String(fields.sourceModule ?? rowType);
  const sourceId = String(fields.sourceId ?? `${rowType}:unknown`);
  const metadata =
    fields.metadata && typeof fields.metadata === "object" && !Array.isArray(fields.metadata)
      ? { ...fields.metadata }
      : {};

  return {
    rowType,
    documentType,
    documentNo,
    currentStatus,
    currentOwner,
    nextAction,
    ageHours,
    riskLevel,
    sourceModule,
    sourceId,
    metadata,
  };
}

/**
 * @param {string|Date|null|undefined} isoOrDate
 * @returns {number|null}
 */
function ageHoursFromTimestamp(isoOrDate) {
  if (isoOrDate == null) return null;
  const t = isoOrDate instanceof Date ? isoOrDate.getTime() : new Date(isoOrDate).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 3600000));
}

function riskFromRmStatus(status) {
  if (status === "CRITICAL") return RISK_LEVELS.CRITICAL;
  if (status === "LOW_BUFFER") return RISK_LEVELS.MEDIUM;
  return RISK_LEVELS.LOW;
}

function ownerForProductionNextAction(nextAction) {
  if (nextAction === "QC_PENDING") return VISIBLE_OWNERS.QA;
  if (nextAction === "DISPATCH_PENDING") return VISIBLE_OWNERS.STORE;
  if (nextAction === "NEXT_RS_REQUIRED") return VISIBLE_OWNERS.ADMIN;
  if (nextAction === "ON_HOLD") return VISIBLE_OWNERS.PRODUCTION;
  return VISIBLE_OWNERS.PRODUCTION;
}

function documentTypeForOrderType(orderType) {
  return orderType === "NO_QTY" ? DOCUMENT_TYPES.NO_QTY : DOCUMENT_TYPES.SALES_ORDER;
}

/** Store-owned procurement phases (Prompt 6C). */
const STORE_PROCUREMENT_QUEUE_TYPES = Object.freeze([
  "APPROVAL_PENDING",
  "PO_WAITING_GRN",
  "WAITING_GRN",
  "PARTIAL_RM_RECEIVED",
  "SHORTAGE_COVERED_BY_INCOMING",
  "PROCUREMENT_PENDING",
  "PROCUREMENT_IN_PROGRESS",
]);

/** Purchase acts only after Store escalation. */
const PURCHASE_PROCUREMENT_QUEUE_TYPES = Object.freeze(["WAITING_PURCHASE_ACTION"]);

/**
 * RM shortage rows: Store owns validation, allocation, issue, and PR creation.
 * Purchase is currentOwner only after PR exists and PO prep is pending.
 * @param {object} raw
 */
function ownerForRmRiskRow(raw) {
  const queueType = String(raw?.queueType ?? "").trim();
  const operationalKey = String(raw?.operationalKey ?? "").trim().toUpperCase();
  const nextActionKey = String(raw?.nextActionKey ?? "").trim().toUpperCase();
  const prLineCount = Number(raw?.prLineCount ?? 0);
  const poLineCount = Number(raw?.poLineCount ?? 0);
  const pendingGrnQty = Number(raw?.pendingGrnQty ?? 0);

  if (
    queueType === "PO_WAITING_GRN" ||
    pendingGrnQty > 0 ||
    operationalKey === "GRN_PENDING"
  ) {
    return VISIBLE_OWNERS.STORE;
  }

  if (
    (operationalKey === "PR_PENDING_PO" && poLineCount === 0) ||
    (nextActionKey === "CREATE_PO" && poLineCount === 0) ||
    (prLineCount > 0 && poLineCount === 0)
  ) {
    return VISIBLE_OWNERS.PURCHASE;
  }

  return VISIBLE_OWNERS.STORE;
}

function isPurchaseHandoffQueueType(queueType, raw = {}) {
  return ownerForRmRiskRow({ queueType, ...raw }) === VISIBLE_OWNERS.PURCHASE;
}

function purchaseNextOwnerHintFromRmRisk(raw) {
  const recommended = String(raw?.recommendedAction ?? "");
  const lower = recommended.toLowerCase();
  if (
    lower.includes("purchase") ||
    lower.includes("procurement") ||
    lower.includes("po") ||
    lower.includes("requisition")
  ) {
    return recommended;
  }
  return null;
}

/**
 * @param {object} raw — getRmRiskRows() element
 * @returns {ControlTowerNormalizedRow}
 */
function normalizeRmRiskRow(raw) {
  const workOrderId = raw?.workOrderId != null ? Number(raw.workOrderId) : null;
  const salesOrderId = raw?.salesOrderId != null ? Number(raw.salesOrderId) : null;
  const rmItemId = raw?.itemId != null ? Number(raw.itemId) : null;
  const sourceId =
    workOrderId && workOrderId > 0
      ? `rm-risk:wo:${workOrderId}:rm:${rmItemId}`
      : `rm-risk:so:${salesOrderId}:rm:${rmItemId}`;

  const queueType = String(raw?.queueType ?? "").trim();
  const currentOwner = ownerForRmRiskRow(raw);
  const purchaseNextOwnerHint = purchaseNextOwnerHintFromRmRisk(raw);
  const purchaseHandoff = isPurchaseHandoffQueueType(queueType, raw);
  const lineage = buildSourceLineageMetadata(raw, {
    sourceStatus: raw?.status ?? null,
    sourceQueueType: raw?.queueType ?? null,
    sourceNextAction: raw?.recommendedAction ?? raw?.blockerReason ?? null,
  });
  const currentStatus = mapSourceToCurrentStatus({
    rowType: ROW_TYPES.RM_RISK,
    sourceStatus: raw?.status ?? null,
    sourceQueueType: raw?.queueType ?? null,
    sourceNextAction: raw?.recommendedAction ?? null,
    orderType: null,
  });

  return buildNormalizedRow({
    rowType: ROW_TYPES.RM_RISK,
    documentType: DOCUMENT_TYPES.RM_SHORTAGE,
    documentNo: raw?.workOrderNo ?? raw?.salesOrderNo ?? null,
    currentStatus,
    currentOwner,
    nextAction: raw?.recommendedAction ?? raw?.blockerReason ?? "Review RM shortage",
    ageHours: null,
    riskLevel: riskFromRmStatus(raw?.status),
    sourceModule: SOURCE_MODULES.RM_RISK,
    sourceId,
    metadata: {
      itemName: raw?.itemName ?? raw?.itemCode ?? null,
      fgItemName: raw?.fgItemName ?? null,
      shortageQty: raw?.shortageAfterReservationQty ?? raw?.shortageQty ?? null,
      queueType: raw?.queueType ?? null,
      blockerReason: raw?.blockerReason ?? null,
      href: raw?.href ?? null,
      salesOrderId,
      workOrderId,
      rmItemId,
      materialRequirementId: raw?.materialRequirementId != null ? Number(raw.materialRequirementId) : null,
      sourceType: raw?.sourceType ?? null,
      freeStockQty: raw?.freeStockQty ?? null,
      netShortageAfterIncomingQty: raw?.netShortageAfterIncomingQty ?? null,
      prLineCount: raw?.prLineCount ?? null,
      poLineCount: raw?.poLineCount ?? null,
      pendingGrnQty: raw?.pendingGrnQty ?? null,
      operationalKey: raw?.operationalKey ?? null,
      nextActionKey: raw?.nextActionKey ?? null,
      procurementDemandPool: raw?.procurementDemandPool ?? null,
      hasOpenMr: raw?.hasOpenMr ?? null,
      primaryPoId: raw?.primaryPoId ?? null,
      procurementCompletedForCase: raw?.procurementCompletedForCase ?? null,
      mrStatus: raw?.mrStatus ?? raw?.requisitionStatus ?? null,
      receivedGrnQty: raw?.receivedGrnQty ?? null,
      ...lineage,
      ...(purchaseHandoff ? { purchaseHandoff: true } : {}),
      ...(purchaseNextOwnerHint && currentOwner === VISIBLE_OWNERS.STORE
        ? { purchaseNextOwnerHint }
        : {}),
    },
  });
}

/**
 * @param {object} raw — getProductionQueueRows() element
 * @returns {ControlTowerNormalizedRow}
 */
function normalizeProductionRow(raw) {
  const nextAction = String(raw?.nextAction ?? "PRODUCTION_PENDING");
  const workOrderId = Number(raw?.workOrderId);
  const lineId = Number(raw?.workOrderLineId);
  const orderType = raw?.orderType ?? "NORMAL";
  const sourceId = `production:wo:${workOrderId}:line:${lineId}`;
  const lineage = buildSourceLineageMetadata(raw, {
    sourceStatus: raw?.status ?? null,
    sourceNextAction: nextAction,
  });
  const currentStatus = mapSourceToCurrentStatus({
    rowType: ROW_TYPES.PRODUCTION_QUEUE,
    sourceStatus: raw?.status ?? null,
    sourceNextAction: nextAction,
    orderType,
  });

  return buildNormalizedRow({
    rowType: ROW_TYPES.PRODUCTION_QUEUE,
    documentType:
      nextAction === "QC_PENDING" ? DOCUMENT_TYPES.PRODUCTION : DOCUMENT_TYPES.WORK_ORDER,
    documentNo: raw?.workOrderNo ?? raw?.salesOrderNo ?? null,
    currentStatus,
    currentOwner: ownerForProductionNextAction(nextAction),
    nextAction: raw?.actionLabel ?? nextAction,
    ageHours: ageHoursFromTimestamp(raw?.workOrderDate),
    riskLevel: nextAction === "ON_HOLD" ? RISK_LEVELS.MEDIUM : RISK_LEVELS.LOW,
    sourceModule: SOURCE_MODULES.PRODUCTION_QUEUE,
    sourceId,
    metadata: {
      salesOrderId: raw?.salesOrderId ?? null,
      salesOrderNo: raw?.salesOrderNo ?? null,
      workOrderId,
      workOrderLineId: lineId,
      itemName: raw?.itemName ?? null,
      balanceQty: raw?.balanceQty ?? null,
      orderType,
      cycleNo: raw?.cycleNo ?? null,
      cycleId: raw?.cycleId ?? null,
      rmReadinessGate: raw?.rmReadinessGate ?? null,
      actionHref: raw?.actionHref ?? null,
      lastShortageQty: raw?.lastShortageQty ?? null,
      ...lineage,
    },
  });
}

/**
 * @param {object} raw — getQcQueueRows() element
 * @returns {ControlTowerNormalizedRow}
 */
function normalizeQaRow(raw) {
  const qcRef = String(raw?.qcRef ?? "");
  const peMatch = /^PE-(\d+)$/.exec(qcRef);
  const productionId = peMatch ? Number(peMatch[1]) : null;
  const workOrderId = Number(raw?.workOrderId);
  const sourceId = productionId ? `qa:pe:${productionId}` : `qa:wo:${workOrderId}`;
  const sourceStatus = raw?.status ?? "PENDING_QC";
  const lineage = buildSourceLineageMetadata(raw, { sourceStatus });
  const currentStatus = mapSourceToCurrentStatus({
    rowType: ROW_TYPES.QA_QUEUE,
    sourceStatus,
    orderType: raw?.orderType ?? null,
  });

  return buildNormalizedRow({
    rowType: ROW_TYPES.QA_QUEUE,
    documentType: DOCUMENT_TYPES.QA,
    documentNo: qcRef || (raw?.workOrderNo != null ? raw.workOrderNo : null),
    currentStatus,
    currentOwner: VISIBLE_OWNERS.QA,
    nextAction: raw?.status === "PARTIAL_QC" ? "Complete partial QA" : "Complete QA",
    ageHours: ageHoursFromTimestamp(raw?.qcDate),
    riskLevel: RISK_LEVELS.LOW,
    sourceModule: SOURCE_MODULES.QC_QUEUE,
    sourceId,
    metadata: {
      workOrderId,
      workOrderNo: raw?.workOrderNo ?? null,
      salesOrderId: raw?.salesOrderId ?? null,
      salesOrderNo: raw?.salesOrderNo ?? null,
      pendingQcQty: raw?.pendingQcQty ?? null,
      orderType: raw?.orderType ?? null,
      cycleNo: raw?.cycleNo ?? null,
      cycleId: raw?.cycleId ?? null,
      itemName: raw?.itemName ?? null,
      ...lineage,
    },
  });
}

/**
 * @param {object} raw — getDispatchBacklogRows() element
 * @returns {ControlTowerNormalizedRow}
 */
function normalizeDispatchRow(raw) {
  const salesOrderId = Number(raw?.salesOrderId);
  const itemId = Number(raw?.itemId);
  const orderType = raw?.orderType ?? "NORMAL";
  const sourceId = `dispatch:so:${salesOrderId}:item:${itemId}:cycle:${raw?.cycleId ?? 0}`;
  const lineage = buildSourceLineageMetadata(raw, {
    sourceStatus: "DISPATCH_PENDING",
  });
  const currentStatus = mapSourceToCurrentStatus({
    rowType: ROW_TYPES.DISPATCH_BACKLOG,
    sourceStatus: "DISPATCH_PENDING",
    orderType,
  });

  return buildNormalizedRow({
    rowType: ROW_TYPES.DISPATCH_BACKLOG,
    documentType: DOCUMENT_TYPES.DISPATCH,
    documentNo: raw?.salesOrderNo ?? null,
    currentStatus,
    currentOwner: VISIBLE_OWNERS.STORE,
    nextAction: "Dispatch material",
    ageHours: ageHoursFromTimestamp(raw?.salesOrderDate),
    riskLevel: Number(raw?.dispatchableNow) > 0 ? RISK_LEVELS.MEDIUM : RISK_LEVELS.LOW,
    sourceModule: SOURCE_MODULES.DISPATCH_BACKLOG,
    sourceId,
    metadata: {
      salesOrderId,
      itemId,
      itemName: raw?.itemName ?? null,
      customerName: raw?.customerName ?? null,
      pendingQty: raw?.pendingQty ?? null,
      dispatchableNow: raw?.dispatchableNow ?? null,
      orderType,
      cycleNo: raw?.cycleNo ?? null,
      cycleId: raw?.cycleId ?? null,
      internalStatus: raw?.status ?? null,
      dispatchOptional: orderType === "NO_QTY",
      ...lineage,
    },
  });
}

function ownerForWoPlanningRow(raw) {
  const operationalKey = String(raw?.operationalKey ?? "");
  if (WO_PLANNING_STORE_OPERATIONAL_KEYS.includes(operationalKey)) {
    return VISIBLE_OWNERS.STORE;
  }
  return VISIBLE_OWNERS.PRODUCTION;
}

function nextActionForNoQtyPlanningRow(raw) {
  const rsStatus = normalizeNoQtyRsStatusToken(raw?.latestRequirementSheetStatus);
  const hasSheet =
    raw?.latestRequirementSheetId != null && Number.isFinite(Number(raw.latestRequirementSheetId)) && Number(raw.latestRequirementSheetId) > 0;
  const cycleNo =
    raw?.cycleNo != null && Number.isFinite(Number(raw.cycleNo)) && Number(raw.cycleNo) > 0
      ? Number(raw.cycleNo)
      : raw?.planningPointerCycleNo != null && Number.isFinite(Number(raw.planningPointerCycleNo))
        ? Number(raw.planningPointerCycleNo)
        : 1;
  if (!hasSheet && !rsStatus) {
    return `Create RS Cycle ${cycleNo}`;
  }
  if (rsStatus === "DRAFT") {
    return `Lock RS Cycle ${cycleNo}`;
  }
  return "Complete requirement sheet planning";
}

function normalizeNoQtyRsStatusToken(status) {
  if (status == null || String(status).trim() === "") return "";
  return String(status).trim().toUpperCase();
}

function nextActionForWoPlanningRow(raw) {
  const key = String(raw?.nextActionKey ?? raw?.operationalKey ?? "");
  if (key === "CREATE_WO") return "Create Work Order";
  if (key === "OPEN_PURCHASE_PLAN") return "Open purchase / GRN plan";
  if (key === "RAISE_MR") return "Raise material requisition";
  if (key === "PREPARE_WO") return "Prepare Work Order";
  return raw?.operationalLabel ?? "Prepare Work Order";
}

/**
 * @param {object} raw — getNoQtyPlanningPendingRows() element
 * @returns {ControlTowerNormalizedRow}
 */
function normalizeNoQtyPlanningRow(raw) {
  const salesOrderId = Number(raw?.salesOrderId);
  const cycleId = raw?.cycleId != null ? Number(raw.cycleId) : null;
  const sourceId = `no-qty-planning:so:${salesOrderId}:cycle:${cycleId ?? 0}`;
  const rsStatus = normalizeNoQtyRsStatusToken(raw?.latestRequirementSheetStatus);
  const hasSheet =
    raw?.latestRequirementSheetId != null && Number.isFinite(Number(raw.latestRequirementSheetId)) && Number(raw.latestRequirementSheetId) > 0;
  const lineage = buildSourceLineageMetadata(raw, {
    sourceStatus: rsStatus || (hasSheet ? "DRAFT" : "NO_RS"),
    sourceStageKey: "NO_QTY_PLANNING",
    sourceNextAction: !hasSheet && !rsStatus ? "CREATE_RS" : rsStatus === "DRAFT" ? "LOCK_RS" : "COMPLETE_RS_PLANNING",
  });
  const currentStatus = mapSourceToCurrentStatus({
    rowType: ROW_TYPES.NO_QTY_PLANNING,
    sourceStatus: rsStatus,
    orderType: "NO_QTY",
  });

  return buildNormalizedRow({
    rowType: ROW_TYPES.NO_QTY_PLANNING,
    documentType: DOCUMENT_TYPES.NO_QTY,
    documentNo: raw?.salesOrderDocNo ?? null,
    currentStatus,
    currentOwner: VISIBLE_OWNERS.STORE,
    nextAction: nextActionForNoQtyPlanningRow(raw),
    ageHours: null,
    riskLevel: !hasSheet && !rsStatus ? RISK_LEVELS.HIGH : RISK_LEVELS.MEDIUM,
    sourceModule: SOURCE_MODULES.NO_QTY_PLANNING,
    sourceId,
    metadata: {
      salesOrderId,
      customerName: raw?.customerName ?? null,
      cycleId,
      cycleNo: raw?.cycleNo ?? null,
      latestRequirementSheetId: raw?.latestRequirementSheetId ?? null,
      latestRequirementSheetDocNo: raw?.latestRequirementSheetDocNo ?? null,
      latestRequirementSheetStatus: rsStatus,
      orderType: "NO_QTY",
      ...lineage,
    },
  });
}

/**
 * @param {object} raw — getWoPreparePlanningRows() element
 * @returns {ControlTowerNormalizedRow}
 */
function normalizeWoPlanningRow(raw) {
  const salesOrderId = Number(raw?.salesOrderId);
  const operationalKey = String(raw?.operationalKey ?? "WO_PREPARE");
  const sourceId = `wo-planning:so:${salesOrderId}`;
  const lineage = buildSourceLineageMetadata(raw, {
    sourceStatus: operationalKey,
    sourceStageKey: "WO_PENDING",
    sourceNextAction: raw?.nextActionKey ?? null,
  });
  const currentStatus = mapSourceToCurrentStatus({
    rowType: ROW_TYPES.WO_PLANNING,
    sourceStatus: operationalKey,
    orderType: "NORMAL",
  });

  return buildNormalizedRow({
    rowType: ROW_TYPES.WO_PLANNING,
    documentType: DOCUMENT_TYPES.SALES_ORDER,
    documentNo: raw?.salesOrderDocNo ?? null,
    currentStatus,
    currentOwner: ownerForWoPlanningRow(raw),
    nextAction: nextActionForWoPlanningRow(raw),
    ageHours: null,
    riskLevel: operationalKey === "RM_SHORTAGE" ? RISK_LEVELS.HIGH : RISK_LEVELS.LOW,
    sourceModule: SOURCE_MODULES.WO_PLANNING,
    sourceId,
    metadata: {
      salesOrderId,
      customerName: raw?.customerName ?? null,
      primaryFgName: raw?.primaryFgName ?? null,
      operationalKey,
      operationalLabel: raw?.operationalLabel ?? null,
      nextActionKey: raw?.nextActionKey ?? null,
      shortageRmCount: raw?.shortageRmCount ?? null,
      pendingMrRefs: raw?.pendingMrRefs ?? null,
      canCreateWorkOrder: raw?.canCreateWorkOrder ?? null,
      woBlockReason: raw?.woBlockReason ?? null,
      orderType: "NORMAL",
      ...lineage,
    },
  });
}

/**
 * @param {object} raw — getQaReworkQueueRows() element
 * @returns {ControlTowerNormalizedRow}
 */
function normalizeQaReworkRow(raw) {
  const dispositionId = Number(raw?.dispositionId);
  const workOrderId = raw?.workOrderId != null ? Number(raw.workOrderId) : null;
  const sourceId = `qa-rework:disp:${dispositionId}`;
  const sourceStatus = String(raw?.status ?? "REWORK_READY_FOR_QC");
  const lineage = buildSourceLineageMetadata(raw, {
    sourceStatus,
    sourceNextAction: "REWORK_QC_PENDING",
  });
  const currentStatus = mapSourceToCurrentStatus({
    rowType: ROW_TYPES.QA_REWORK,
    sourceStatus,
    orderType: raw?.orderType ?? null,
  });

  return buildNormalizedRow({
    rowType: ROW_TYPES.QA_REWORK,
    documentType: DOCUMENT_TYPES.QA,
    documentNo: raw?.workOrderNo ?? raw?.sourceQcEntryDocNo ?? `QRD-${dispositionId}`,
    currentStatus,
    currentOwner: VISIBLE_OWNERS.QA,
    nextAction: "Complete rework QA",
    ageHours: ageHoursFromTimestamp(raw?.createdAt),
    riskLevel: RISK_LEVELS.MEDIUM,
    sourceModule: SOURCE_MODULES.QA_REWORK,
    sourceId,
    metadata: {
      dispositionId,
      workOrderId,
      workOrderNo: raw?.workOrderNo ?? null,
      salesOrderId: raw?.salesOrderId ?? null,
      cycleId: raw?.cycleId ?? null,
      cycleNo: raw?.cycleNo ?? null,
      itemId: raw?.itemId ?? null,
      itemName: raw?.itemName ?? null,
      pendingReworkQcQty: raw?.pendingReworkQcQty ?? null,
      productionId: raw?.productionId ?? null,
      sourceQcEntryId: raw?.sourceQcEntryId ?? null,
      sourceQcEntryDocNo: raw?.sourceQcEntryDocNo ?? null,
      ...lineage,
    },
  });
}

function ownerForContinueWorkingStage(stageKey) {
  switch (stageKey) {
    case "QC":
      return VISIBLE_OWNERS.QA;
    case "DISPATCH":
      return VISIBLE_OWNERS.STORE;
    case "SALES_BILL":
      return VISIBLE_OWNERS.ADMIN;
    case "PRODUCTION":
      return VISIBLE_OWNERS.PRODUCTION;
    case "NEXT_RS":
      return VISIBLE_OWNERS.STORE;
    default:
      return VISIBLE_OWNERS.ADMIN;
  }
}

/**
 * @param {object} raw — getContinueWorkingRows() element
 * @returns {ControlTowerNormalizedRow}
 */
function normalizeContinueWorkingRow(raw) {
  const stageKey = String(raw?.stageKey ?? "PRODUCTION");
  const nextAction = String(raw?.nextAction ?? raw?.nextStep ?? stageKey);
  const salesOrderId = Number(raw?.salesOrderId);
  const orderType = raw?.orderType ?? "NORMAL";
  const sourceId = `continue:${raw?.key ?? `so:${salesOrderId}:${stageKey}`}`;
  const lineage = buildSourceLineageMetadata(raw, {
    sourceStageKey: stageKey,
    sourceNextAction: raw?.nextAction ?? raw?.nextStep ?? null,
  });
  const currentStatus = mapSourceToCurrentStatus({
    rowType: ROW_TYPES.CONTINUE_WORKING,
    sourceStageKey: stageKey,
    sourceNextAction: raw?.nextAction ?? null,
    orderType,
  });

  return buildNormalizedRow({
    rowType: ROW_TYPES.CONTINUE_WORKING,
    documentType: documentTypeForOrderType(orderType),
    documentNo: raw?.salesOrderDocNo ?? null,
    currentStatus,
    currentOwner: ownerForContinueWorkingStage(stageKey),
    nextAction: raw?.nextStep ?? nextAction,
    ageHours: null,
    riskLevel: RISK_LEVELS.LOW,
    sourceModule: SOURCE_MODULES.CONTINUE_WORKING,
    sourceId,
    metadata: {
      key: raw?.key ?? null,
      salesOrderId,
      orderType,
      cycleNo: raw?.cycleNo ?? null,
      cycleId: raw?.cycleId ?? null,
      itemName: raw?.itemName ?? null,
      metricQty: raw?.metricQty ?? null,
      href: raw?.href ?? null,
      hasPendingQc: raw?.hasPendingQc ?? null,
      ...lineage,
    },
  });
}

/**
 * @param {unknown} row
 * @returns {boolean}
 */
function validateNormalizedRowShape(row) {
  if (!row || typeof row !== "object") return false;
  const required = [
    "rowType",
    "documentType",
    "documentNo",
    "currentStatus",
    "currentOwner",
    "nextAction",
    "ageHours",
    "riskLevel",
    "sourceModule",
    "sourceId",
    "metadata",
  ];
  for (const k of required) {
    if (!(k in row)) return false;
  }
  return typeof row.metadata === "object" && row.metadata !== null && !Array.isArray(row.metadata);
}

module.exports = {
  ROW_TYPES,
  DOCUMENT_TYPES,
  RISK_LEVELS,
  VISIBLE_OWNERS,
  STORE_PROCUREMENT_QUEUE_TYPES,
  PURCHASE_PROCUREMENT_QUEUE_TYPES,
  SOURCE_MODULES,
  CONTROL_TOWER_STATUSES,
  mapSourceToCurrentStatus,
  buildSourceLineageMetadata,
  buildNormalizedRow,
  ageHoursFromTimestamp,
  ownerForRmRiskRow,
  isPurchaseHandoffQueueType,
  normalizeRmRiskRow,
  normalizeProductionRow,
  normalizeQaRow,
  normalizeDispatchRow,
  normalizeContinueWorkingRow,
  normalizeNoQtyPlanningRow,
  normalizeWoPlanningRow,
  normalizeQaReworkRow,
  ownerForWoPlanningRow,
  validateNormalizedRowShape,
};
