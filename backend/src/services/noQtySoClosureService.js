/**
 * Batch 3D — NO_QTY SO Closure & Waiver (authoritative).
 *
 * assessNoQtySoClosure is the single source of truth for close eligibility/mode.
 * closeNoQtySoWithWaiver / closeNoQtySoComplete own the close transactions.
 */

const { lockSalesOrderForUpdate } = require("./dispatchWriteLocks");
const { assertAnyAdminPassword } = require("./adminPasswordAuth");
const {
  summarizeNoQtyProductionQcPending,
  assessNoQtyCycleDispatchCapMet,
} = require("./noQtySoOperationalGates");
const {
  getAvailableRecovery,
  getRecoverySummary,
  lockRecoverySourceForUpdate,
  computeAvailableQty,
  recomputeRecoveryStatus,
} = require("./noQtyRecoveryService");
const { createNoQtyCloseSnapshot } = require("./noQtySoCloseSnapshotService");
const { displayDispatchNo, displaySalesBillNo, displayRequirementSheetNo } = require("../utils/docNoLabels");
const auditLog = require("./auditLog");

const EPS = 1e-6;
const CLOSED_STATUSES = new Set(["COMPLETED", "CLOSED", "MANUALLY_CLOSED", "CLOSED_WITH_WAIVER"]);

const CLOSURE_MODES = Object.freeze({
  COMPLETE: "COMPLETE",
  WAIVER_REQUIRED: "WAIVER_REQUIRED",
  BLOCKED: "BLOCKED",
});

const WAIVER_REASON_CODES = Object.freeze([
  "MACHINE_BREAKDOWN",
  "CAPACITY_CONSTRAINT",
  "WAITING_FOR_RM",
  "TOOL_MAINTENANCE",
  "CUSTOMER_PRIORITY_CHANGE",
  "MANAGEMENT_DECISION",
  "QUALITY_CONCERN",
  "CUSTOMER_CANCELLED_BALANCE",
  "COMMERCIAL_SETTLEMENT",
  "OTHER",
]);

const FG_DISPOSITION_TYPES = Object.freeze([
  "DISPATCH_BEFORE_CLOSE",
  "TRANSFER_TO_GENERAL_STOCK",
  "RETAIN_AS_CUSTOMER_SPECIFIC_STOCK",
  "SCRAP",
  "OTHER_APPROVED_DISPOSITION",
]);

const BLOCK_MESSAGES = Object.freeze({
  NOT_NO_QTY: "Close is allowed only for No Qty sales orders.",
  SO_NOT_FOUND: "Sales order not found.",
  ALREADY_CLOSED: "Sales order is already closed.",
  PENDING_PRODUCTION: "Cannot close SO: production is still pending.",
  SHORTFALL_PENDING: "Cannot close SO: production shortfall decision is pending.",
  PENDING_QC: "Cannot close SO: QC is pending.",
  PENDING_QC_DISPOSITION: "Cannot close SO: QC rework or hold disposition is pending.",
  DRAFT_DISPATCH_EXISTS: "Cannot close SO: outstanding draft dispatch.",
  ACTIVE_RS_DRAFT: "Cannot close SO: requirement sheet is not locked.",
  WO_PENDING: "Cannot close SO: outstanding Work Orders are pending for the active cycle.",
  PENDING_DISPATCH: "Cannot close SO: outstanding dispatch dependency.",
  PMR_WAITING_STORE_ISSUE: "Cannot close SO: store material issue is pending for active cycle.",
  PMR_PARTIALLY_ISSUED: "Cannot close SO: store material issue is incomplete for active cycle.",
  ACTIVE_CYCLE_INCOMPLETE: "Cannot close SO: active cycle operational work is incomplete.",
  DRAFT_BILLING: "Cannot close SO: outstanding billing dependency (draft sales bill).",
  BILLING_NOT_EXPORTED: "Cannot close SO: Sales Bill not exported.",
  BILLING_ADJUSTMENT: "Cannot close SO: billing adjustment is pending.",
  FG_DISPOSITION_REQUIRED: "Cannot close SO: accepted FG disposition pending.",
  WAIVER_REQUIRED: "Unresolved recovery must be waived via close-with-waiver.",
  RECOVERY_PENDING: "Cannot close SO: recovery decision is pending.",
});

function productionBlockerMessage(count) {
  const n = Math.max(0, Number(count) || 0);
  if (n <= 0) return BLOCK_MESSAGES.PENDING_PRODUCTION;
  return `Cannot close SO: ${n} Work Order${n === 1 ? "" : "s"} still have production pending.`;
}

function qcBlockerMessage(count) {
  const n = Math.max(0, Number(count) || 0);
  if (n <= 0) return BLOCK_MESSAGES.PENDING_QC;
  return `Cannot close SO: ${n} Work Order${n === 1 ? "" : "s"} pending QC.`;
}

function fgDispositionBlockerMessage(qty) {
  const q = round3(qty);
  if (!(q > EPS)) return BLOCK_MESSAGES.FG_DISPOSITION_REQUIRED;
  return `Cannot close SO: accepted FG disposition pending (${q}).`;
}

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function closureError(message, { statusCode = 409, code = "NO_QTY_CLOSE_BLOCKED", reason = null } = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  if (reason) err.reason = reason;
  return err;
}

function blocker(code, message, extra = {}) {
  return { code, message: message || BLOCK_MESSAGES[code] || code, ...extra };
}

async function hasExecutionAwareProductionPending(db, salesOrderId) {
  const summary = await summarizeNoQtyProductionQcPending(db, salesOrderId, { orderType: "NO_QTY" });
  if (summary.shortfallPendingWoCount > 0) {
    return {
      pending: true,
      reason: "SHORTFALL_PENDING",
      productionPendingWoCount: summary.productionPendingWoCount,
      shortfallPendingWoCount: summary.shortfallPendingWoCount,
    };
  }
  if (summary.productionPendingWoCount > 0) {
    return {
      pending: true,
      reason: "PENDING_PRODUCTION",
      productionPendingWoCount: summary.productionPendingWoCount,
      shortfallPendingWoCount: summary.shortfallPendingWoCount,
    };
  }
  return {
    pending: false,
    reason: null,
    productionPendingWoCount: 0,
    shortfallPendingWoCount: 0,
  };
}

async function computeAcceptedFgPendingByItem(db, salesOrderId) {
  const soId = Number(salesOrderId);
  const cycles = await db.salesOrderCycle.findMany({
    where: { salesOrderId: soId },
    select: { id: true },
    orderBy: { cycleNo: "asc" },
  });

  /** @type {Map<number, number>} */
  const acceptedByItem = new Map();

  for (const cyc of cycles) {
    const cycleId = Number(cyc.id);
    const wos = await db.workOrder.findMany({
      where: { salesOrderId: soId, cycleId, status: { not: "REJECTED" } },
      select: { id: true },
    });
    if (!wos.length) continue;
    const woIds = wos.map((w) => w.id);
    const qcRows = await db.qcEntry.findMany({
      where: {
        reversedAt: null,
        production: { workOrderLine: { workOrderId: { in: woIds } } },
      },
      select: {
        acceptedQty: true,
        production: { select: { workOrderLine: { select: { fgItemId: true } } } },
      },
    });
    for (const q of qcRows) {
      const itemId = Number(q.production?.workOrderLine?.fgItemId);
      const qty = round3(n(q.acceptedQty));
      if (!(itemId > 0) || !(qty > EPS)) continue;
      acceptedByItem.set(itemId, round3((acceptedByItem.get(itemId) ?? 0) + qty));
    }
  }

  const dispatches = await db.dispatch.findMany({
    where: { soId, reversalOfId: null, workflowStatus: "LOCKED" },
    select: { itemId: true, dispatchedQty: true },
  });
  /** @type {Map<number, number>} */
  const dispatchedByItem = new Map();
  for (const d of dispatches) {
    const itemId = Number(d.itemId);
    dispatchedByItem.set(itemId, round3((dispatchedByItem.get(itemId) ?? 0) + n(d.dispatchedQty)));
  }

  const dispositions = await db.noQtyAcceptedFgDisposition.findMany({
    where: { salesOrderId: soId },
    select: { itemId: true, qty: true },
  });
  /** @type {Map<number, number>} */
  const disposedByItem = new Map();
  for (const d of dispositions) {
    const itemId = Number(d.itemId);
    disposedByItem.set(itemId, round3((disposedByItem.get(itemId) ?? 0) + n(d.qty)));
  }

  /** @type {Map<number, number>} */
  const pendingByItem = new Map();
  let totalPending = 0;
  for (const [itemId, accepted] of acceptedByItem) {
    const pending = round3(
      Math.max(0, accepted - (dispatchedByItem.get(itemId) ?? 0) - (disposedByItem.get(itemId) ?? 0)),
    );
    if (pending > EPS) {
      pendingByItem.set(itemId, pending);
      totalPending = round3(totalPending + pending);
    }
  }
  return { pendingByItem, totalPending };
}

async function assessNoQtySoClosure(db, salesOrderId) {
  const soId = Number(salesOrderId);
  const empty = {
    salesOrderId: soId,
    eligible: false,
    mode: CLOSURE_MODES.BLOCKED,
    blockers: [],
    warnings: [],
    itemSummaries: [],
    pendingProductionShortfallQty: 0,
    pendingQcRecoveryQty: 0,
    acceptedFgPendingDispositionQty: 0,
    proposedWaiverQty: 0,
    proposedWaiverLines: [],
  };

  if (!Number.isFinite(soId) || soId <= 0) {
    return { ...empty, blockers: [blocker("SO_NOT_FOUND")] };
  }

  const so = await db.salesOrder.findUnique({
    where: { id: soId },
    select: { id: true, orderType: true, internalStatus: true, docNo: true },
  });
  if (!so) return { ...empty, blockers: [blocker("SO_NOT_FOUND")] };
  if (so.orderType !== "NO_QTY") return { ...empty, blockers: [blocker("NOT_NO_QTY")] };
  if (CLOSED_STATUSES.has(String(so.internalStatus ?? ""))) {
    return { ...empty, blockers: [blocker("ALREADY_CLOSED")] };
  }

  const blockers = [];
  const warnings = [];

  /**
   * Close evaluation order (SSOT):
   * Outstanding WO → Production (incl. PMR) → QC → FG Disposition → Recovery →
   * Dispatch dependency → Sales Bill dependency → Close Allowed
   */
  const activeCycle = await db.salesOrderCycle.findFirst({
    where: { salesOrderId: soId, status: "ACTIVE" },
    orderBy: { cycleNo: "desc" },
    select: { id: true, cycleNo: true },
  });

  let lockedRs = null;
  let woCount = 0;
  if (activeCycle) {
    const cycleId = Number(activeCycle.id);
    lockedRs = await db.requirementSheet.findFirst({
      where: { salesOrderId: soId, cycleId, status: "LOCKED" },
      select: { id: true },
    });
    woCount = await db.workOrder.count({
      where: { salesOrderId: soId, cycleId, status: { not: "REJECTED" } },
    });
    // 1) Outstanding Work Orders — skip when locked RS is decision-only (empty cycle cap)
    if (lockedRs && woCount === 0) {
      const { assessNoQtyCycleDispatchCapMet } = require("./noQtySoOperationalGates");
      const dispatchCap = await assessNoQtyCycleDispatchCapMet(db, { soId, cycleId });
      const emptyCap =
        dispatchCap.complete === true &&
        (dispatchCap.reason === "EMPTY_CYCLE_CAP" || dispatchCap.reason === "NO_LOCKED_RS");
      if (!emptyCap) {
        blockers.push(blocker("WO_PENDING"));
      }
    }

    // 2) Production prerequisites (material issue)
    const openPmr = await db.productionMaterialRequest.findFirst({
      where: {
        workOrder: { salesOrderId: soId, cycleId },
        status: { in: ["REQUESTED", "PARTIALLY_ISSUED"] },
      },
      orderBy: { id: "desc" },
      select: { status: true },
    });
    if (openPmr) {
      blockers.push(
        blocker(openPmr.status === "REQUESTED" ? "PMR_WAITING_STORE_ISSUE" : "PMR_PARTIALLY_ISSUED"),
      );
    }
  }

  // 2b) Production / shortfall
  const prodQc = await summarizeNoQtyProductionQcPending(db, soId, { orderType: "NO_QTY" });
  if (prodQc.shortfallPendingWoCount > 0) {
    blockers.push(
      blocker(
        "SHORTFALL_PENDING",
        prodQc.shortfallPendingWoCount === 1
          ? BLOCK_MESSAGES.SHORTFALL_PENDING
          : `Cannot close SO: ${prodQc.shortfallPendingWoCount} Work Orders have production shortfall decisions pending.`,
        { woCount: prodQc.shortfallPendingWoCount },
      ),
    );
  } else if (prodQc.productionPendingWoCount > 0) {
    blockers.push(
      blocker("PENDING_PRODUCTION", productionBlockerMessage(prodQc.productionPendingWoCount), {
        woCount: prodQc.productionPendingWoCount,
      }),
    );
  }

  // 3) QC / QC disposition
  if (prodQc.qcPendingWoCount > 0) {
    blockers.push(
      blocker("PENDING_QC", qcBlockerMessage(prodQc.qcPendingWoCount), {
        woCount: prodQc.qcPendingWoCount,
      }),
    );
  }
  if (prodQc.openQcDispositionCount > 0) {
    blockers.push(
      blocker(
        "PENDING_QC_DISPOSITION",
        prodQc.openQcDispositionCount === 1
          ? BLOCK_MESSAGES.PENDING_QC_DISPOSITION
          : `Cannot close SO: ${prodQc.openQcDispositionCount} QC rework/hold dispositions are pending.`,
        { count: prodQc.openQcDispositionCount },
      ),
    );
  }

  // 4) FG Disposition
  const { pendingByItem: fgPendingByItem, totalPending: acceptedFgPendingDispositionQty } =
    await computeAcceptedFgPendingByItem(db, soId);
  if (acceptedFgPendingDispositionQty > EPS) {
    blockers.push(
      blocker("FG_DISPOSITION_REQUIRED", fgDispositionBlockerMessage(acceptedFgPendingDispositionQty), {
        pendingQty: acceptedFgPendingDispositionQty,
      }),
    );
  }

  // 5) Recovery is evaluated after gates — WAIVER_REQUIRED mode when clear of hard blockers
  const recoverySummary = await getRecoverySummary(db, soId);
  const available = await getAvailableRecovery(db, { salesOrderId: soId });
  let pendingProductionShortfallQty = 0;
  let pendingQcRecoveryQty = 0;
  for (const row of available) {
    if (row.recoveryType === "PRODUCTION_SHORTFALL") {
      pendingProductionShortfallQty = round3(pendingProductionShortfallQty + row.availableQty);
    } else if (row.recoveryType === "QC_FINAL_REJECTION") {
      pendingQcRecoveryQty = round3(pendingQcRecoveryQty + row.availableQty);
    }
  }
  const proposedWaiverQty = round3(pendingProductionShortfallQty + pendingQcRecoveryQty);
  const proposedWaiverLines = available.map((r) => ({
    recoverySourceId: r.recoverySourceId,
    itemId: r.itemId,
    itemName: r.itemName,
    recoveryType: r.recoveryType,
    availableQty: r.availableQty,
    proposedWaivedQty: r.availableQty,
  }));

  if (recoverySummary.sources.some((s) => s.migrationIncomplete)) {
    warnings.push({
      code: "MIGRATION_INCOMPLETE",
      message: "Some recovery sources have incomplete migration flags; verify before close.",
    });
  }

  // 6) Dispatch dependency
  const unlockedDispatches = await db.dispatch.findMany({
    where: { soId, reversalOfId: null, workflowStatus: "UNLOCKED" },
    select: { id: true, docNo: true },
    orderBy: { id: "asc" },
    take: 5,
  });
  if (unlockedDispatches.length > 0) {
    const labels = unlockedDispatches.map((d) => displayDispatchNo(d.id, d.docNo));
    const more =
      unlockedDispatches.length >= 5
        ? await db.dispatch.count({
            where: { soId, reversalOfId: null, workflowStatus: "UNLOCKED" },
          })
        : unlockedDispatches.length;
    const suffix = more > labels.length ? ` (+${more - labels.length} more)` : "";
    blockers.push(
      blocker(
        "DRAFT_DISPATCH_EXISTS",
        labels.length === 1
          ? `Cannot close SO: Dispatch ${labels[0]} not finalized.`
          : `Cannot close SO: Draft dispatches not finalized: ${labels.join(", ")}${suffix}.`,
        { dispatchIds: unlockedDispatches.map((d) => d.id), documentNos: labels },
      ),
    );
  }

  if (activeCycle && lockedRs) {
    const cycleId = Number(activeCycle.id);
    const dispatchCap = await assessNoQtyCycleDispatchCapMet(db, { soId, cycleId });
    if (!dispatchCap.complete) {
      const rsLabel = displayRequirementSheetNo(dispatchCap.sheetId, dispatchCap.sheetDocNo);
      let message = BLOCK_MESSAGES.PENDING_DISPATCH;
      if (dispatchCap.reason === "NO_DISPATCHES") {
        message = `Cannot close SO: Cycle ${activeCycle.cycleNo} locked RS ${rsLabel} has no confirmed dispatch.`;
      } else if (dispatchCap.reason === "PENDING_DISPATCH_REMAINS") {
        const itemBit = dispatchCap.pendingItemName
          ? ` for ${dispatchCap.pendingItemName}`
          : dispatchCap.pendingItemId
            ? ` for item ${dispatchCap.pendingItemId}`
            : "";
        message = `Cannot close SO: Cycle ${activeCycle.cycleNo} dispatch remaining vs locked RS ${rsLabel}${itemBit} — ${dispatchCap.pendingQty} of ${dispatchCap.capQty} still undispatched.`;
      }
      blockers.push(
        blocker("PENDING_DISPATCH", message, {
          dispatchCapReason: dispatchCap.reason,
          cycleId,
          cycleNo: activeCycle.cycleNo,
          sheetId: dispatchCap.sheetId,
          sheetDocNo: dispatchCap.sheetDocNo,
          pendingItemId: dispatchCap.pendingItemId,
          pendingItemName: dispatchCap.pendingItemName,
          pendingQty: dispatchCap.pendingQty,
          capQty: dispatchCap.capQty,
          dispatchedQty: dispatchCap.dispatchedQty,
        }),
      );
    }
  } else if (
    activeCycle &&
    woCount > 0 &&
    !blockers.some(
      (b) =>
        b.code === "PENDING_PRODUCTION" ||
        b.code === "SHORTFALL_PENDING" ||
        b.code === "PENDING_QC" ||
        b.code === "PENDING_QC_DISPOSITION",
    )
  ) {
    blockers.push(blocker("ACTIVE_CYCLE_INCOMPLETE"));
  }

  // 7) Sales Bill / export / RS draft dependencies
  const draftBills = await db.salesBill.findMany({
    where: { status: "DRAFT", dispatch: { soId, reversalOfId: null } },
    select: { id: true, billNo: true, docNo: true },
    orderBy: { id: "asc" },
    take: 5,
  });
  if (draftBills.length > 0) {
    const labels = draftBills.map((b) => displaySalesBillNo(b.id, b.billNo, b.docNo));
    blockers.push(
      blocker(
        "DRAFT_BILLING",
        labels.length === 1
          ? `Cannot close SO: Sales Bill ${labels[0]} is still draft.`
          : `Cannot close SO: Draft sales bills pending: ${labels.join(", ")}.`,
        { salesBillIds: draftBills.map((b) => b.id), documentNos: labels },
      ),
    );
  }

  const unexportedBills = await db.salesBill.findMany({
    where: {
      status: "FINALIZED",
      exportedAt: null,
      dispatch: { soId, reversalOfId: null },
    },
    select: { id: true, billNo: true, docNo: true },
    orderBy: { id: "asc" },
    take: 5,
  });
  if (unexportedBills.length > 0) {
    const labels = unexportedBills.map((b) => displaySalesBillNo(b.id, b.billNo, b.docNo));
    blockers.push(
      blocker(
        "BILLING_NOT_EXPORTED",
        labels.length === 1
          ? `Cannot close SO: Sales Bill ${labels[0]} not exported.`
          : `Cannot close SO: Sales Bills not exported: ${labels.join(", ")}.`,
        { salesBillIds: unexportedBills.map((b) => b.id), documentNos: labels },
      ),
    );
  }

  const draftRsCount = await db.requirementSheet.count({
    where: { salesOrderId: soId, status: "DRAFT" },
  });
  if (draftRsCount > 0) blockers.push(blocker("ACTIVE_RS_DRAFT"));

  const itemMap = new Map();
  for (const row of available) {
    const cur = itemMap.get(row.itemId) || {
      itemId: row.itemId,
      itemName: row.itemName,
      productionShortfallAvailableQty: 0,
      qcRecoveryAvailableQty: 0,
      acceptedFgPendingDispositionQty: 0,
      proposedWaiverQty: 0,
    };
    if (row.recoveryType === "PRODUCTION_SHORTFALL") {
      cur.productionShortfallAvailableQty = round3(cur.productionShortfallAvailableQty + row.availableQty);
    } else {
      cur.qcRecoveryAvailableQty = round3(cur.qcRecoveryAvailableQty + row.availableQty);
    }
    cur.proposedWaiverQty = round3(cur.productionShortfallAvailableQty + cur.qcRecoveryAvailableQty);
    itemMap.set(row.itemId, cur);
  }
  for (const [itemId, qty] of fgPendingByItem) {
    const cur = itemMap.get(itemId) || {
      itemId,
      itemName: null,
      productionShortfallAvailableQty: 0,
      qcRecoveryAvailableQty: 0,
      acceptedFgPendingDispositionQty: 0,
      proposedWaiverQty: 0,
    };
    cur.acceptedFgPendingDispositionQty = qty;
    itemMap.set(itemId, cur);
  }

  let mode = CLOSURE_MODES.COMPLETE;
  if (blockers.length) mode = CLOSURE_MODES.BLOCKED;
  else if (proposedWaiverQty > EPS) {
    mode = CLOSURE_MODES.WAIVER_REQUIRED;
    warnings.push({ code: "WAIVER_REQUIRED", message: BLOCK_MESSAGES.WAIVER_REQUIRED });
  }

  return {
    salesOrderId: soId,
    salesOrderDocNo: so.docNo ?? null,
    internalStatus: so.internalStatus,
    eligible: mode !== CLOSURE_MODES.BLOCKED,
    mode,
    blockers,
    warnings,
    itemSummaries: [...itemMap.values()],
    pendingProductionShortfallQty,
    pendingQcRecoveryQty,
    acceptedFgPendingDispositionQty,
    proposedWaiverQty,
    proposedWaiverLines,
  };
}

async function recordAcceptedFgDisposition(
  tx,
  {
    salesOrderId,
    itemId,
    qty,
    dispositionType,
    remarks = null,
    stockTransactionId = null,
    actorUserId = null,
  },
) {
  const soId = Number(salesOrderId);
  const iid = Number(itemId);
  const q = round3(qty);
  if (!(q > EPS)) {
    throw closureError("Disposition quantity must be positive.", {
      statusCode: 400,
      code: "INVALID_DISPOSITION_QTY",
    });
  }
  if (!FG_DISPOSITION_TYPES.includes(String(dispositionType))) {
    throw closureError("Invalid FG disposition type.", {
      statusCode: 400,
      code: "INVALID_DISPOSITION_TYPE",
    });
  }
  if (String(dispositionType) === "TRANSFER_TO_GREEN_LEVEL") {
    throw closureError("Green Level transfer is not an allowed FG disposition.", {
      statusCode: 400,
      code: "GREEN_LEVEL_TRANSFER_FORBIDDEN",
    });
  }

  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    select: { id: true, orderType: true, internalStatus: true },
  });
  if (!so || so.orderType !== "NO_QTY") {
    throw closureError(BLOCK_MESSAGES.NOT_NO_QTY, { reason: "NOT_NO_QTY" });
  }
  if (CLOSED_STATUSES.has(String(so.internalStatus ?? ""))) {
    throw closureError(BLOCK_MESSAGES.ALREADY_CLOSED, { reason: "ALREADY_CLOSED" });
  }

  const { pendingByItem } = await computeAcceptedFgPendingByItem(tx, soId);
  const pending = pendingByItem.get(iid) ?? 0;
  if (q > pending + EPS) {
    throw closureError(`Disposition qty ${q} exceeds pending accepted FG ${pending} for item ${iid}.`, {
      code: "FG_DISPOSITION_OVER",
      reason: "FG_DISPOSITION_OVER",
    });
  }

  const row = await tx.noQtyAcceptedFgDisposition.create({
    data: {
      salesOrderId: soId,
      itemId: iid,
      qty: String(q),
      dispositionType,
      remarks: remarks?.trim() || null,
      stockTransactionId: stockTransactionId != null ? Number(stockTransactionId) : null,
      approvedByUserId: actorUserId ?? null,
    },
  });

  if (typeof actorUserId === "number") {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.CREATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `NO_QTY_FG_DISPOSITION:${row.id}`,
      actorUserId,
      summary: `Recorded accepted FG disposition ${dispositionType} qty ${q} for SO ${soId} item ${iid}`,
      payload: { salesOrderId: soId, itemId: iid, qty: q, dispositionType },
    });
  }

  return row;
}

async function applyWaiverLines(tx, { waiverId, waiverLines }) {
  const applied = [];
  for (const ln of waiverLines) {
    const sourceId = Number(ln.recoverySourceId);
    const waiveQty = round3(ln.waivedQty);
    if (!(waiveQty > EPS)) {
      throw closureError("Waiver line quantity must be positive.", {
        statusCode: 400,
        code: "WAIVER_QTY_MISMATCH",
      });
    }
    const source = await lockRecoverySourceForUpdate(tx, sourceId);
    if (!source) {
      throw closureError("Recovery source not found for waiver.", {
        statusCode: 404,
        code: "RECOVERY_SOURCE_NOT_FOUND",
      });
    }
    const allocs = await tx.recoveryAllocation.findMany({
      where: { recoverySourceId: sourceId },
      select: { status: true, allocatedQty: true },
    });
    const available = computeAvailableQty(source, allocs);
    if (waiveQty > available + EPS) {
      throw closureError(`Cannot waive ${waiveQty}; available recovery is ${available} for source ${sourceId}.`, {
        code: "WAIVER_QTY_MISMATCH",
        reason: "WAIVER_QTY_MISMATCH",
      });
    }
    if (Number(ln.itemId) > 0 && Number(ln.itemId) !== Number(source.itemId)) {
      throw closureError("Waiver line item does not match recovery source item.", {
        statusCode: 400,
        code: "WAIVER_ITEM_MISMATCH",
      });
    }

    const newWaived = round3(n(source.waivedQty) + waiveQty);
    await tx.carryForwardPending.update({
      where: { id: sourceId },
      data: { waivedQty: String(newWaived) },
    });
    await recomputeRecoveryStatus(tx, sourceId);

    await tx.noQtySoWaiverLine.create({
      data: {
        waiverId,
        recoverySourceId: sourceId,
        itemId: source.itemId,
        waivedQty: String(waiveQty),
        recoveryType: source.recoveryType,
      },
    });
    applied.push({ recoverySourceId: sourceId, itemId: source.itemId, waivedQty: waiveQty });
  }
  return applied;
}

async function closeNoQtySoWithWaiver(
  tx,
  {
    salesOrderId,
    adminPassword,
    reasonCode,
    remarks,
    waiverLines,
    actorUserId,
    actorRole = null,
    skipPasswordCheck = false,
  },
) {
  const soId = Number(salesOrderId);
  await lockSalesOrderForUpdate(tx, soId);

  let approvingAdminUserId = actorUserId;
  if (!skipPasswordCheck) {
    approvingAdminUserId = await assertAnyAdminPassword(tx, { password: adminPassword });
  }
  if (!Number.isFinite(Number(approvingAdminUserId)) || Number(approvingAdminUserId) <= 0) {
    throw closureError("Admin approval is required for waiver close.", {
      statusCode: 401,
      code: "ADMIN_AUTH_FAILED",
    });
  }

  if (!WAIVER_REASON_CODES.includes(String(reasonCode))) {
    throw closureError("A valid waiver reason code is required.", {
      statusCode: 400,
      code: "WAIVER_REASON_REQUIRED",
    });
  }
  const remarksTrim = String(remarks ?? "").trim();
  if (!remarksTrim) {
    throw closureError("Waiver remarks are mandatory.", {
      statusCode: 400,
      code: "WAIVER_REMARKS_REQUIRED",
    });
  }

  const assessment = await assessNoQtySoClosure(tx, soId);
  if (assessment.mode === CLOSURE_MODES.BLOCKED) {
    throw closureError(assessment.blockers[0]?.message || BLOCK_MESSAGES.ACTIVE_CYCLE_INCOMPLETE, {
      code: "NO_QTY_CLOSE_BLOCKED",
      reason: assessment.blockers[0]?.code || "BLOCKED",
    });
  }

  const lines = Array.isArray(waiverLines) ? waiverLines : [];
  if (assessment.mode === CLOSURE_MODES.WAIVER_REQUIRED) {
    if (!lines.length) {
      throw closureError("Waiver lines are required when recovery is pending.", {
        statusCode: 400,
        code: "WAIVER_QTY_MISMATCH",
      });
    }
    const proposedIds = new Set(assessment.proposedWaiverLines.map((p) => Number(p.recoverySourceId)));
    const providedIds = new Set(lines.map((l) => Number(l.recoverySourceId)));
    for (const id of proposedIds) {
      if (!providedIds.has(id)) {
        throw closureError("All available recovery sources must be included in the waiver.", {
          code: "WAIVER_QTY_MISMATCH",
        });
      }
    }
    for (const ln of lines) {
      const proposed = assessment.proposedWaiverLines.find(
        (p) => Number(p.recoverySourceId) === Number(ln.recoverySourceId),
      );
      if (!proposed) {
        throw closureError("Waiver references a recovery source that is not available.", {
          code: "WAIVER_QTY_MISMATCH",
        });
      }
      if (round3(ln.waivedQty) > round3(proposed.availableQty) + EPS) {
        throw closureError(
          `Waiver for source ${ln.recoverySourceId} exceeds available qty ${proposed.availableQty}.`,
          { code: "WAIVER_QTY_MISMATCH" },
        );
      }
      if (round3(ln.waivedQty) < round3(proposed.availableQty) - EPS) {
        throw closureError(
          `Waiver for source ${ln.recoverySourceId} must equal available qty ${proposed.availableQty}.`,
          { code: "WAIVER_QTY_MISMATCH" },
        );
      }
    }
  }

  const waiver = await tx.noQtySoWaiver.create({
    data: {
      salesOrderId: soId,
      reasonCode,
      remarks: remarksTrim,
      approvedByUserId: Number(approvingAdminUserId),
    },
  });

  const applied =
    lines.length > 0 ? await applyWaiverLines(tx, { waiverId: waiver.id, waiverLines: lines }) : [];

  const post = await assessNoQtySoClosure(tx, soId);
  if (post.mode === CLOSURE_MODES.BLOCKED) {
    throw closureError(post.blockers[0]?.message || "Close blocked after waiver.", {
      code: "NO_QTY_CLOSE_BLOCKED",
      reason: post.blockers[0]?.code,
    });
  }
  if (post.proposedWaiverQty > EPS) {
    throw closureError("Waiver did not clear all available recovery.", { code: "WAIVER_QTY_MISMATCH" });
  }

  const byItem = new Map();
  for (const a of applied) {
    byItem.set(a.itemId, round3((byItem.get(a.itemId) ?? 0) + a.waivedQty));
  }
  const { snapshot, lines: snapLines } = await createNoQtyCloseSnapshot(tx, {
    salesOrderId: soId,
    userId: Number(approvingAdminUserId),
    reason: remarksTrim,
    waiverId: waiver.id,
    closeMode: "WAIVER",
    linesOverride: [...byItem.entries()].map(([itemId, closedShortageQty]) => ({
      itemId,
      closedShortageQty,
    })),
  });

  const updated = await tx.salesOrder.update({
    where: { id: soId },
    data: { internalStatus: "CLOSED_WITH_WAIVER", currentCycleId: null },
  });

  await auditLog.write(tx, {
    action: auditLog.AuditAction.UPDATE,
    entityType: auditLog.AuditEntityType.SETTINGS,
    entityId: `SALES_ORDER:${soId}`,
    actorUserId: Number(approvingAdminUserId),
    actorRole,
    summary: `NO_QTY SO ${soId} closed with waiver (${reasonCode})`,
    payload: { module: "NO_QTY_SO_CLOSURE", waiverId: waiver.id, snapshotId: snapshot.id, applied },
    reason: remarksTrim,
  });

  return { salesOrder: updated, waiver, snapshot, snapshotLines: snapLines, assessment: post, applied };
}

async function closeNoQtySoComplete(tx, { salesOrderId, actorUserId = null, actorRole = null, reason = null }) {
  const soId = Number(salesOrderId);
  await lockSalesOrderForUpdate(tx, soId);

  const assessment = await assessNoQtySoClosure(tx, soId);
  if (assessment.mode === CLOSURE_MODES.BLOCKED) {
    throw closureError(assessment.blockers[0]?.message || "Close blocked.", {
      code: "NO_QTY_CLOSE_BLOCKED",
      reason: assessment.blockers[0]?.code,
    });
  }
  if (assessment.mode === CLOSURE_MODES.WAIVER_REQUIRED) {
    throw closureError(BLOCK_MESSAGES.WAIVER_REQUIRED, {
      code: "WAIVER_REQUIRED",
      reason: "WAIVER_REQUIRED",
    });
  }

  const { snapshot, lines } = await createNoQtyCloseSnapshot(tx, {
    salesOrderId: soId,
    userId: actorUserId,
    reason: reason?.trim() || null,
    closeMode: "COMPLETE",
  });

  const updated = await tx.salesOrder.update({
    where: { id: soId },
    data: { internalStatus: "COMPLETED", currentCycleId: null },
  });

  if (typeof actorUserId === "number") {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `SALES_ORDER:${soId}`,
      actorUserId,
      actorRole,
      summary: `NO_QTY SO ${soId} closed complete (no waiver)`,
      payload: { module: "NO_QTY_SO_CLOSURE", snapshotId: snapshot.id, closeMode: "COMPLETE" },
    });
  }

  return { salesOrder: updated, snapshot, snapshotLines: lines, assessment };
}

module.exports = {
  EPS,
  CLOSURE_MODES,
  WAIVER_REASON_CODES,
  FG_DISPOSITION_TYPES,
  BLOCK_MESSAGES,
  assessNoQtySoClosure,
  closeNoQtySoWithWaiver,
  closeNoQtySoComplete,
  recordAcceptedFgDisposition,
  computeAcceptedFgPendingByItem,
  hasExecutionAwareProductionPending,
};
