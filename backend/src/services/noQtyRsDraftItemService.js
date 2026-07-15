/**
 * Cycle-specific FG item management on NO_QTY draft Requirement Sheets.
 *
 * - Each cycle/sheet may contain a different FG set.
 * - Duplicate itemId within the same sheet (draft cycle) is rejected.
 * - Same itemId on a different cycle's sheet is allowed.
 * - Remove cleans draft planning + recovery decision reservations; never deletes historical recovery sources.
 */

const auditLog = require("./auditLog");
const { reverseRecovery, reverseWaivedQtyOnSource } = require("./noQtyRecoveryService");

const DUPLICATE_ITEM_MESSAGE = "Item already exists in this Requirement Sheet cycle.";

function draftItemError(message, { statusCode = 409, code = "RS_DRAFT_ITEM_ERROR", details = null } = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  if (details != null) err.details = details;
  return err;
}

async function loadDraftSheetOrThrow(tx, requirementSheetId) {
  const sheetId = Number(requirementSheetId);
  const sheet = await tx.requirementSheet.findUnique({
    where: { id: sheetId },
    include: {
      salesOrder: {
        select: {
          id: true,
          orderType: true,
          lines: { include: { item: { select: { id: true, itemType: true, itemName: true } } } },
        },
      },
      lines: { select: { id: true, itemId: true } },
      cycle: { select: { id: true, cycleNo: true } },
    },
  });
  if (!sheet) {
    throw draftItemError("Requirement sheet not found.", { statusCode: 404, code: "RS_NOT_FOUND" });
  }
  if (sheet.salesOrder?.orderType !== "NO_QTY") {
    throw draftItemError("Requirement sheet is allowed only for No Qty sales orders.", {
      statusCode: 409,
      code: "NOT_NO_QTY",
    });
  }
  if (sheet.status !== "DRAFT") {
    throw draftItemError(
      sheet.status === "CANCELLED"
        ? "Cancelled requirement sheets cannot be edited."
        : "Locked sheets cannot add or remove items.",
      { statusCode: 409, code: "RS_NOT_DRAFT" },
    );
  }
  return sheet;
}

function assertFgOnSalesOrder(sheet, itemId) {
  const iid = Number(itemId);
  const fgLines = (sheet.salesOrder?.lines || []).filter((l) => l.item?.itemType === "FG");
  const allowed = new Set(fgLines.map((l) => Number(l.itemId)));
  if (!allowed.has(iid)) {
    throw draftItemError("Item is not a valid FG item on this sales order.", {
      statusCode: 400,
      code: "INVALID_FG_ITEM",
      details: { itemId: iid },
    });
  }
  return iid;
}

/**
 * Add one FG item to a draft RS cycle. Rejects duplicates by itemId on this sheet.
 */
async function addDraftRequirementSheetItem(
  tx,
  { requirementSheetId, itemId, actorUserId = null, actorRole = null },
) {
  const sheet = await loadDraftSheetOrThrow(tx, requirementSheetId);
  const iid = assertFgOnSalesOrder(sheet, itemId);

  const existing = (sheet.lines || []).find((l) => Number(l.itemId) === iid);
  if (existing) {
    throw draftItemError(DUPLICATE_ITEM_MESSAGE, {
      statusCode: 409,
      code: "DUPLICATE_RS_ITEM",
      details: {
        requirementSheetId: sheet.id,
        cycleId: sheet.cycleId ?? null,
        cycleNo: sheet.cycle?.cycleNo ?? null,
        itemId: iid,
      },
    });
  }

  let line;
  try {
    line = await tx.requirementSheetLine.create({
      data: {
        sheetId: sheet.id,
        itemId: iid,
        requirementQty: 0,
        baseDemandQty: 0,
        productionShortfallQty: 0,
        qcRejectionRecoveryQty: 0,
        approvedManualAdjustmentQty: 0,
        totalRsQty: 0,
      },
    });
  } catch (e) {
    if (e && e.code === "P2002") {
      throw draftItemError(DUPLICATE_ITEM_MESSAGE, {
        statusCode: 409,
        code: "DUPLICATE_RS_ITEM",
        details: { requirementSheetId: sheet.id, itemId: iid },
      });
    }
    throw e;
  }

  const { syncPendingRecoveryDecisionsForSheet } = require("./noQtyRsRecoveryDecisionService");
  await syncPendingRecoveryDecisionsForSheet(tx, {
    requirementSheetId: sheet.id,
    actorUserId,
  });

  if (typeof actorUserId === "number") {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.CREATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `REQUIREMENT_SHEET:${sheet.id}`,
      actorUserId,
      actorRole,
      summary: `Added FG item ${iid} to draft RS ${sheet.id} (cycle ${sheet.cycle?.cycleNo ?? sheet.cycleId ?? "—"})`,
      payload: {
        module: "RS_DRAFT_ITEM",
        actionLabel: "ADD",
        requirementSheetId: sheet.id,
        cycleId: sheet.cycleId ?? null,
        cycleNo: sheet.cycle?.cycleNo ?? null,
        itemId: iid,
        lineId: line.id,
      },
    });
  }

  return { line, requirementSheetId: sheet.id, itemId: iid };
}

/**
 * Reverse Keep/Waive effects for one item and delete decision rows (draft cleanup only).
 * Does not delete CarryForwardPending historical recovery sources.
 */
async function cleanupRecoveryDecisionForDraftItem(
  tx,
  { requirementSheetId, itemId, actorUserId = null, reason = "Draft FG item removed" },
) {
  const sheetId = Number(requirementSheetId);
  const iid = Number(itemId);
  const decision = await tx.noQtyRsItemRecoveryDecision.findUnique({
    where: { requirementSheetId_itemId: { requirementSheetId: sheetId, itemId: iid } },
    include: { lines: true },
  });
  if (!decision) return { cleaned: false };

  if (decision.status === "KEPT") {
    for (const ln of decision.lines || []) {
      if (ln.effect !== "KEEP" || ln.recoveryAllocationId == null) continue;
      try {
        await reverseRecovery(tx, {
          allocationId: ln.recoveryAllocationId,
          reason,
          actorUserId,
        });
      } catch {
        /* already reversed */
      }
    }
  } else if (decision.status === "WAIVED") {
    for (const ln of decision.lines || []) {
      if (ln.effect !== "WAIVE") continue;
      try {
        await reverseWaivedQtyOnSource(tx, {
          recoverySourceId: ln.recoverySourceId,
          qty: ln.qty,
          actorUserId,
          reason,
        });
      } catch {
        /* ignore */
      }
    }
  }

  await tx.noQtyRsItemRecoveryDecisionLine.deleteMany({ where: { decisionId: decision.id } });
  await tx.noQtyRsItemRecoveryDecision.delete({ where: { id: decision.id } });
  return { cleaned: true, priorStatus: decision.status };
}

/**
 * Remove one FG item from a draft RS cycle.
 * Releases reserved recovery decisions; does not delete historical recovery records.
 */
async function removeDraftRequirementSheetItem(
  tx,
  { requirementSheetId, itemId, actorUserId = null, actorRole = null },
) {
  const sheet = await loadDraftSheetOrThrow(tx, requirementSheetId);
  const iid = Number(itemId);
  if (!Number.isFinite(iid) || iid <= 0) {
    throw draftItemError("Invalid item id.", { statusCode: 400, code: "INVALID_ITEM_ID" });
  }

  const line = (sheet.lines || []).find((l) => Number(l.itemId) === iid);
  if (!line) {
    throw draftItemError("FG item is not on this Requirement Sheet cycle.", {
      statusCode: 404,
      code: "RS_LINE_NOT_FOUND",
      details: { itemId: iid },
    });
  }

  const cleanup = await cleanupRecoveryDecisionForDraftItem(tx, {
    requirementSheetId: sheet.id,
    itemId: iid,
    actorUserId,
    reason: "Draft FG item removed from Requirement Sheet cycle",
  });

  // Safety: reverse any leftover active allocations on this line (e.g. legacy rows).
  const leftoverAllocs = await tx.recoveryAllocation.findMany({
    where: {
      requirementSheetLineId: line.id,
      status: { in: ["RESERVED", "COMMITTED"] },
    },
    select: { id: true },
  });
  for (const a of leftoverAllocs) {
    try {
      await reverseRecovery(tx, {
        allocationId: a.id,
        reason: "Draft FG item removed from Requirement Sheet cycle",
        actorUserId,
      });
    } catch {
      /* ignore */
    }
  }
  await tx.recoveryAllocation.deleteMany({
    where: { requirementSheetLineId: line.id, status: "REVERSED" },
  });

  await tx.requirementSheetLine.delete({ where: { id: line.id } });

  if (typeof actorUserId === "number") {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.DELETE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `REQUIREMENT_SHEET:${sheet.id}`,
      actorUserId,
      actorRole,
      summary: `Removed FG item ${iid} from draft RS ${sheet.id} (cycle ${sheet.cycle?.cycleNo ?? sheet.cycleId ?? "—"})`,
      payload: {
        module: "RS_DRAFT_ITEM",
        actionLabel: "REMOVE",
        requirementSheetId: sheet.id,
        cycleId: sheet.cycleId ?? null,
        cycleNo: sheet.cycle?.cycleNo ?? null,
        itemId: iid,
        lineId: line.id,
        recoveryDecisionCleaned: Boolean(cleanup.cleaned),
        priorRecoveryDecisionStatus: cleanup.priorStatus ?? null,
      },
    });
  }

  return {
    removed: true,
    requirementSheetId: sheet.id,
    itemId: iid,
    recoveryDecisionCleaned: Boolean(cleanup.cleaned),
  };
}

/**
 * Assert itemIds for create are unique by Item ID (caller may already Set-dedupe).
 * Throws the same clear validation error as mid-draft add.
 */
function assertNoDuplicateItemIds(itemIds) {
  const seen = new Set();
  for (const raw of itemIds || []) {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (seen.has(id)) {
      throw draftItemError(DUPLICATE_ITEM_MESSAGE, {
        statusCode: 409,
        code: "DUPLICATE_RS_ITEM",
        details: { itemId: id },
      });
    }
    seen.add(id);
  }
  return [...seen];
}

module.exports = {
  DUPLICATE_ITEM_MESSAGE,
  addDraftRequirementSheetItem,
  removeDraftRequirementSheetItem,
  cleanupRecoveryDecisionForDraftItem,
  assertNoDuplicateItemIds,
};
