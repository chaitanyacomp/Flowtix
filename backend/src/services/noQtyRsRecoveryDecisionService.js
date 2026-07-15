/**
 * Phase 2B — Unified per-FG Keep/Waive recovery decisions on draft Requirement Sheets.
 *
 * Both PRODUCTION_SHORTFALL and QC_FINAL_REJECTION share this workflow.
 * Neither type is auto-allocated onto an RS.
 *
 * Decision is all-or-nothing per (requirementSheetId, itemId).
 */

const auditLog = require("./auditLog");
const {
  EPS,
  getAvailableRecovery,
  allocateRecovery,
  reverseRecovery,
  waiveAvailableQtyOnSource,
  reverseWaivedQtyOnSource,
  commitReservedAllocationsForSheet,
} = require("./noQtyRecoveryService");

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function decisionError(message, { statusCode = 409, code = "RECOVERY_DECISION_ERROR", details = null } = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  if (details != null) err.details = details;
  return err;
}

function summarizeAvailableByItem(rows) {
  /** @type {Map<number, { itemId: number, itemName: string|null, uom: string|null, productionShortfallQty: number, qcFinalRejectionQty: number, pendingRecoveryQty: number, sources: object[] }>} */
  const byItem = new Map();
  for (const row of rows || []) {
    const itemId = Number(row.itemId);
    if (!byItem.has(itemId)) {
      byItem.set(itemId, {
        itemId,
        itemName: row.itemName ?? null,
        uom: row.uom ?? null,
        productionShortfallQty: 0,
        qcFinalRejectionQty: 0,
        pendingRecoveryQty: 0,
        sources: [],
      });
    }
    const bucket = byItem.get(itemId);
    const qty = round3(n(row.availableQty));
    if (qty <= EPS) continue;
    if (row.recoveryType === "PRODUCTION_SHORTFALL") {
      bucket.productionShortfallQty = round3(bucket.productionShortfallQty + qty);
    } else if (row.recoveryType === "QC_FINAL_REJECTION") {
      bucket.qcFinalRejectionQty = round3(bucket.qcFinalRejectionQty + qty);
    }
    bucket.pendingRecoveryQty = round3(bucket.pendingRecoveryQty + qty);
    bucket.sources.push({
      recoverySourceId: row.recoverySourceId,
      recoveryType: row.recoveryType,
      availableQty: qty,
      sourceQty: round3(n(row.sourceQty)),
      recoveryStatus: row.recoveryStatus,
      sourceWorkOrderId: row.sourceWorkOrderId ?? null,
      sourceRequirementSheetId: row.sourceRequirementSheetId ?? null,
      cycleId: row.cycleId ?? null,
      sourceDocumentType: row.sourceDocumentType,
      sourceDocumentId: row.sourceDocumentId,
    });
  }
  return byItem;
}

async function syncRequirementSheetLineComponentsSafe(tx, lineId) {
  const { syncRequirementSheetLineComponents } = require("./noQtyRsRecoveryIntegrationService");
  return syncRequirementSheetLineComponents(tx, lineId);
}

async function syncAllSheetLineComponentsSafe(tx, sheetId) {
  const { syncAllSheetLineComponents } = require("./noQtyRsRecoveryIntegrationService");
  return syncAllSheetLineComponents(tx, sheetId);
}

/**
 * Cycle-specific FG sets: recovery sync must NOT auto-inject FG lines onto a draft RS.
 * Operators add items explicitly (create / POST lines). Recovery remains SO+item matched
 * and only seeds Keep/Waive for items already on this sheet.
 * Does NOT allocate.
 */
async function ensureLinesForPendingRecoveryItems(tx, { salesOrderId, requirementSheetId }) {
  void salesOrderId;
  const existing = await tx.requirementSheetLine.findMany({
    where: { sheetId: Number(requirementSheetId) },
    select: { itemId: true },
  });
  const itemIds = existing.map((l) => Number(l.itemId));
  return { createdItemIds: [], itemIds };
}

/**
 * Upsert PENDING decision rows for every FG line that has available recovery.
 * Refresh qty snapshots while still PENDING. Does not allocate.
 */
async function syncPendingRecoveryDecisionsForSheet(tx, { requirementSheetId, actorUserId = null }) {
  const sheetId = Number(requirementSheetId);
  const sheet = await tx.requirementSheet.findUnique({
    where: { id: sheetId },
    select: {
      id: true,
      status: true,
      salesOrderId: true,
      salesOrder: { select: { orderType: true } },
      lines: { select: { id: true, itemId: true } },
    },
  });
  if (!sheet) {
    throw decisionError("Requirement sheet not found.", { statusCode: 404, code: "RS_NOT_FOUND" });
  }
  if (sheet.salesOrder?.orderType !== "NO_QTY") {
    return { skipped: true, reason: "NOT_NO_QTY", decisions: [] };
  }
  if (sheet.status !== "DRAFT") {
    return { skipped: true, reason: "RS_NOT_DRAFT", decisions: [] };
  }

  await ensureLinesForPendingRecoveryItems(tx, {
    salesOrderId: sheet.salesOrderId,
    requirementSheetId: sheetId,
  });

  const refreshed = await tx.requirementSheet.findUnique({
    where: { id: sheetId },
    select: { lines: { select: { itemId: true } } },
  });

  const available = await getAvailableRecovery(tx, { salesOrderId: sheet.salesOrderId });
  const byItem = summarizeAvailableByItem(available);
  const lineItemIds = new Set((refreshed?.lines || []).map((l) => Number(l.itemId)));

  const existing = await tx.noQtyRsItemRecoveryDecision.findMany({
    where: { requirementSheetId: sheetId },
  });
  const existingByItem = new Map(existing.map((d) => [Number(d.itemId), d]));

  const out = [];
  for (const itemId of lineItemIds) {
    const pending = byItem.get(itemId);
    const pendingQty = pending ? pending.pendingRecoveryQty : 0;
    const psQty = pending ? pending.productionShortfallQty : 0;
    const qcQty = pending ? pending.qcFinalRejectionQty : 0;
    const row = existingByItem.get(itemId);

    if (pendingQty <= EPS) {
      if (row && row.status === "PENDING") {
        const cancelled = await tx.noQtyRsItemRecoveryDecision.update({
          where: { id: row.id },
          data: {
            status: "CANCELLED",
            productionShortfallQty: "0",
            qcFinalRejectionQty: "0",
            pendingRecoveryQty: "0",
          },
        });
        out.push(cancelled);
      } else if (row) {
        out.push(row);
      }
      continue;
    }

    if (!row) {
      const created = await tx.noQtyRsItemRecoveryDecision.create({
        data: {
          requirementSheetId: sheetId,
          itemId,
          status: "PENDING",
          productionShortfallQty: String(psQty),
          qcFinalRejectionQty: String(qcQty),
          pendingRecoveryQty: String(pendingQty),
        },
      });
      out.push(created);
      continue;
    }

    if (row.status === "PENDING" || row.status === "CANCELLED") {
      const updated = await tx.noQtyRsItemRecoveryDecision.update({
        where: { id: row.id },
        data: {
          status: "PENDING",
          productionShortfallQty: String(psQty),
          qcFinalRejectionQty: String(qcQty),
          pendingRecoveryQty: String(pendingQty),
          reason: null,
          decidedAt: null,
          decidedByUserId: null,
        },
      });
      out.push(updated);
    } else {
      out.push(row);
    }
  }

  void actorUserId;
  return { skipped: false, decisions: out };
}

async function loadSheetDecisionContext(tx, requirementSheetId) {
  const sheetId = Number(requirementSheetId);
  const sheet = await tx.requirementSheet.findUnique({
    where: { id: sheetId },
    include: {
      salesOrder: { select: { id: true, orderType: true } },
      lines: true,
    },
  });
  if (!sheet) {
    throw decisionError("Requirement sheet not found.", { statusCode: 404, code: "RS_NOT_FOUND" });
  }
  if (sheet.salesOrder?.orderType !== "NO_QTY") {
    throw decisionError("Recovery decisions apply only to NO_QTY requirement sheets.", {
      statusCode: 400,
      code: "NOT_NO_QTY",
    });
  }
  return sheet;
}

/**
 * Build API/UI payload of recovery decisions + source provenance for a sheet.
 */
async function getRecoveryDecisionsForSheet(db, requirementSheetId) {
  const sheet = await loadSheetDecisionContext(db, requirementSheetId);
  const sheetId = sheet.id;

  if (sheet.status === "DRAFT") {
    await syncPendingRecoveryDecisionsForSheet(db, { requirementSheetId: sheetId });
  }

  const decisions = await db.noQtyRsItemRecoveryDecision.findMany({
    where: {
      requirementSheetId: sheetId,
      status: { not: "CANCELLED" },
    },
    include: {
      item: { select: { id: true, itemName: true, unit: true } },
      lines: true,
      decidedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ itemId: "asc" }],
  });

  const available = await getAvailableRecovery(db, { salesOrderId: sheet.salesOrderId });
  const byItem = summarizeAvailableByItem(available);

  const sourceIds = [
    ...new Set([
      ...available.map((a) => a.recoverySourceId),
      ...decisions.flatMap((d) => (d.lines || []).map((l) => l.recoverySourceId)),
    ]),
  ];
  const sources =
    sourceIds.length > 0
      ? await db.carryForwardPending.findMany({
          where: { id: { in: sourceIds } },
          include: {
            sourceWorkOrder: { select: { id: true, docNo: true } },
            sourceRequirementSheet: { select: { id: true, docNo: true, cycleId: true } },
            cycle: { select: { id: true, cycleNo: true } },
          },
        })
      : [];
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const lineByItem = new Map((sheet.lines || []).map((l) => [Number(l.itemId), l]));

  return {
    requirementSheetId: sheetId,
    salesOrderId: sheet.salesOrderId,
    status: sheet.status,
    items: decisions.map((d) => {
      const live = byItem.get(Number(d.itemId));
      const line = lineByItem.get(Number(d.itemId));
      const baseDemandQty = round3(n(line?.baseDemandQty ?? line?.requirementQty));
      const decisionStatus = d.status;
      const ps =
        decisionStatus === "PENDING"
          ? live?.productionShortfallQty ?? round3(n(d.productionShortfallQty))
          : round3(n(d.productionShortfallQty));
      const qc =
        decisionStatus === "PENDING"
          ? live?.qcFinalRejectionQty ?? round3(n(d.qcFinalRejectionQty))
          : round3(n(d.qcFinalRejectionQty));
      const pending =
        decisionStatus === "PENDING"
          ? live?.pendingRecoveryQty ?? round3(n(d.pendingRecoveryQty))
          : round3(n(d.pendingRecoveryQty));
      const finalRsQty =
        decisionStatus === "KEPT" ? round3(baseDemandQty + ps + qc) : baseDemandQty;

      const provenanceSources =
        decisionStatus === "PENDING"
          ? (live?.sources || []).map((s) => {
              const full = sourceById.get(s.recoverySourceId);
              return {
                ...s,
                sourceRsDocNo: full?.sourceRequirementSheet?.docNo ?? null,
                sourceRsId: full?.sourceRequirementSheetId ?? s.sourceRequirementSheetId ?? null,
                cycleNo: full?.cycle?.cycleNo ?? null,
                workOrderDocNo: full?.sourceWorkOrder?.docNo ?? null,
              };
            })
          : (d.lines || []).map((l) => {
              const full = sourceById.get(l.recoverySourceId);
              return {
                recoverySourceId: l.recoverySourceId,
                recoveryType: l.recoveryType,
                availableQty: round3(n(l.qty)),
                effect: l.effect,
                recoveryAllocationId: l.recoveryAllocationId,
                sourceRsDocNo: full?.sourceRequirementSheet?.docNo ?? null,
                sourceRsId: full?.sourceRequirementSheetId ?? null,
                cycleId: full?.cycleId ?? null,
                cycleNo: full?.cycle?.cycleNo ?? null,
                sourceWorkOrderId: full?.sourceWorkOrderId ?? null,
                workOrderDocNo: full?.sourceWorkOrder?.docNo ?? null,
              };
            });

      return {
        decisionId: d.id,
        itemId: d.itemId,
        itemName: d.item?.itemName ?? null,
        uom: d.item?.unit ?? null,
        decisionStatus,
        customerDemandQty: baseDemandQty,
        productionShortfallQty: ps,
        qcFinalRejectionQty: qc,
        pendingRecoveryQty: pending,
        finalRsQty,
        reason: d.reason,
        decidedAt: d.decidedAt,
        decidedBy: d.decidedBy
          ? { id: d.decidedBy.id, name: d.decidedBy.name, email: d.decidedBy.email }
          : null,
        sources: provenanceSources,
      };
    }),
  };
}

/**
 * KEEP — allocate ALL pending recovery for the FG item (PS + QC) atomically.
 */
async function keepItemRecovery(
  tx,
  { requirementSheetId, itemId, actorUserId = null, actorRole = null },
) {
  const sheet = await loadSheetDecisionContext(tx, requirementSheetId);
  if (sheet.status !== "DRAFT") {
    throw decisionError("Keep is only allowed on DRAFT requirement sheets.", {
      statusCode: 400,
      code: "RS_NOT_DRAFT",
    });
  }

  const iid = Number(itemId);
  await syncPendingRecoveryDecisionsForSheet(tx, { requirementSheetId: sheet.id, actorUserId });

  let decision = await tx.noQtyRsItemRecoveryDecision.findUnique({
    where: {
      requirementSheetId_itemId: { requirementSheetId: sheet.id, itemId: iid },
    },
    include: { lines: true },
  });
  if (!decision || decision.status === "CANCELLED") {
    throw decisionError("No pending recovery for this FG item.", {
      statusCode: 404,
      code: "RECOVERY_DECISION_NOT_FOUND",
    });
  }
  if (decision.status === "KEPT") {
    return { decision, alreadyDecided: true };
  }
  if (decision.status === "WAIVED") {
    throw decisionError("Recovery already waived for this FG item. Reverse the decision first.", {
      statusCode: 409,
      code: "RECOVERY_ALREADY_WAIVED",
    });
  }

  const available = await getAvailableRecovery(tx, {
    salesOrderId: sheet.salesOrderId,
    itemId: iid,
  });
  if (!available.length) {
    throw decisionError("No available recovery to keep for this FG item.", {
      statusCode: 409,
      code: "NO_PENDING_RECOVERY",
    });
  }

  const line = await tx.requirementSheetLine.findUnique({
    where: { sheetId_itemId: { sheetId: sheet.id, itemId: iid } },
  });
  if (!line) {
    throw decisionError("FG item is not on this Requirement Sheet cycle.", {
      statusCode: 404,
      code: "RS_LINE_NOT_FOUND",
      details: { itemId: iid },
    });
  }

  let psQty = 0;
  let qcQty = 0;
  const effectLines = [];

  for (const src of available) {
    if (src.availableQty <= EPS) continue;
    const allocResult = await allocateRecovery(tx, {
      recoverySourceId: src.recoverySourceId,
      requirementSheetId: sheet.id,
      requirementSheetLineId: line.id,
      qty: src.availableQty,
      actorUserId,
    });
    if (src.recoveryType === "PRODUCTION_SHORTFALL") {
      psQty = round3(psQty + src.availableQty);
    } else if (src.recoveryType === "QC_FINAL_REJECTION") {
      qcQty = round3(qcQty + src.availableQty);
    }
    effectLines.push({
      recoverySourceId: src.recoverySourceId,
      recoveryType: src.recoveryType,
      qty: String(src.availableQty),
      effect: "KEEP",
      recoveryAllocationId: allocResult.allocation.id,
    });
  }

  if (!effectLines.length) {
    throw decisionError("No available recovery to keep for this FG item.", {
      statusCode: 409,
      code: "NO_PENDING_RECOVERY",
    });
  }

  await tx.noQtyRsItemRecoveryDecisionLine.deleteMany({ where: { decisionId: decision.id } });
  await tx.noQtyRsItemRecoveryDecisionLine.createMany({
    data: effectLines.map((l) => ({ ...l, decisionId: decision.id })),
  });

  const pendingQty = round3(psQty + qcQty);
  decision = await tx.noQtyRsItemRecoveryDecision.update({
    where: { id: decision.id },
    data: {
      status: "KEPT",
      productionShortfallQty: String(psQty),
      qcFinalRejectionQty: String(qcQty),
      pendingRecoveryQty: String(pendingQty),
      reason: null,
      decidedAt: new Date(),
      decidedByUserId: actorUserId ?? null,
    },
    include: { lines: true },
  });

  await syncRequirementSheetLineComponentsSafe(tx, line.id);

  if (typeof actorUserId === "number") {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `REQUIREMENT_SHEET:${sheet.id}`,
      actorUserId,
      actorRole,
      summary: `Kept recovery for item ${iid} on RS ${sheet.id} (qty ${pendingQty})`,
      payload: {
        module: "RS_RECOVERY_DECISION",
        actionLabel: "KEEP",
        itemId: iid,
        productionShortfallQty: psQty,
        qcFinalRejectionQty: qcQty,
        pendingRecoveryQty: pendingQty,
        lines: effectLines,
      },
    });
  }

  return { decision, alreadyDecided: false };
}

/**
 * WAIVE — permanently waive ALL pending recovery for the FG item.
 */
async function waiveItemRecovery(
  tx,
  { requirementSheetId, itemId, reason, actorUserId = null, actorRole = null },
) {
  const reasonTrim = String(reason || "").trim();
  if (reasonTrim.length < 3) {
    throw decisionError("Waiver reason is required (min 3 characters).", {
      statusCode: 400,
      code: "WAIVE_REASON_REQUIRED",
    });
  }

  const sheet = await loadSheetDecisionContext(tx, requirementSheetId);
  if (sheet.status !== "DRAFT") {
    throw decisionError("Waive is only allowed on DRAFT requirement sheets.", {
      statusCode: 400,
      code: "RS_NOT_DRAFT",
    });
  }

  const iid = Number(itemId);
  await syncPendingRecoveryDecisionsForSheet(tx, { requirementSheetId: sheet.id, actorUserId });

  let decision = await tx.noQtyRsItemRecoveryDecision.findUnique({
    where: {
      requirementSheetId_itemId: { requirementSheetId: sheet.id, itemId: iid },
    },
    include: { lines: true },
  });
  if (!decision || decision.status === "CANCELLED") {
    throw decisionError("No pending recovery for this FG item.", {
      statusCode: 404,
      code: "RECOVERY_DECISION_NOT_FOUND",
    });
  }
  if (decision.status === "WAIVED") {
    return { decision, alreadyDecided: true };
  }
  if (decision.status === "KEPT") {
    throw decisionError("Recovery already kept for this FG item. Reverse the decision first.", {
      statusCode: 409,
      code: "RECOVERY_ALREADY_KEPT",
    });
  }

  const available = await getAvailableRecovery(tx, {
    salesOrderId: sheet.salesOrderId,
    itemId: iid,
  });
  if (!available.length) {
    throw decisionError("No available recovery to waive for this FG item.", {
      statusCode: 409,
      code: "NO_PENDING_RECOVERY",
    });
  }

  let psQty = 0;
  let qcQty = 0;
  const effectLines = [];

  for (const src of available) {
    if (src.availableQty <= EPS) continue;
    await waiveAvailableQtyOnSource(tx, {
      recoverySourceId: src.recoverySourceId,
      qty: src.availableQty,
      actorUserId,
      reason: reasonTrim,
    });
    if (src.recoveryType === "PRODUCTION_SHORTFALL") {
      psQty = round3(psQty + src.availableQty);
    } else if (src.recoveryType === "QC_FINAL_REJECTION") {
      qcQty = round3(qcQty + src.availableQty);
    }
    effectLines.push({
      recoverySourceId: src.recoverySourceId,
      recoveryType: src.recoveryType,
      qty: String(src.availableQty),
      effect: "WAIVE",
      recoveryAllocationId: null,
    });
  }

  await tx.noQtyRsItemRecoveryDecisionLine.deleteMany({ where: { decisionId: decision.id } });
  await tx.noQtyRsItemRecoveryDecisionLine.createMany({
    data: effectLines.map((l) => ({ ...l, decisionId: decision.id })),
  });

  const pendingQty = round3(psQty + qcQty);
  decision = await tx.noQtyRsItemRecoveryDecision.update({
    where: { id: decision.id },
    data: {
      status: "WAIVED",
      productionShortfallQty: String(psQty),
      qcFinalRejectionQty: String(qcQty),
      pendingRecoveryQty: String(pendingQty),
      reason: reasonTrim,
      decidedAt: new Date(),
      decidedByUserId: actorUserId ?? null,
    },
    include: { lines: true },
  });

  const line = await tx.requirementSheetLine.findUnique({
    where: { sheetId_itemId: { sheetId: sheet.id, itemId: iid } },
  });
  if (line) await syncRequirementSheetLineComponentsSafe(tx, line.id);

  const decidedByRole = String(actorRole ?? "").trim().toUpperCase() || null;
  if (typeof actorUserId === "number" || decidedByRole) {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `REQUIREMENT_SHEET:${sheet.id}`,
      actorUserId: typeof actorUserId === "number" ? actorUserId : null,
      actorRole: decidedByRole,
      summary: `Waived recovery for item ${iid} on RS ${sheet.id} by ${decidedByRole || "UNKNOWN"} (qty ${pendingQty})`,
      reason: reasonTrim,
      payload: {
        module: "RS_RECOVERY_DECISION",
        actionLabel: "WAIVE",
        requirementSheetId: sheet.id,
        salesOrderId: sheet.salesOrderId,
        itemId: iid,
        decidedByUserId: typeof actorUserId === "number" ? actorUserId : null,
        decidedByRole,
        decidedAt: decision.decidedAt,
        productionShortfallQty: psQty,
        qcFinalRejectionQty: qcQty,
        pendingRecoveryQty: pendingQty,
        reason: reasonTrim,
        sources: effectLines,
        lines: effectLines,
      },
    });
  }

  return { decision, alreadyDecided: false };
}

/**
 * Reverse Keep/Waive while RS is DRAFT → back to PENDING.
 */
async function reverseItemRecoveryDecision(
  tx,
  { requirementSheetId, itemId, actorUserId = null, actorRole = null, reason = null },
) {
  const sheet = await loadSheetDecisionContext(tx, requirementSheetId);
  if (sheet.status !== "DRAFT") {
    throw decisionError("Recovery decisions can only be reversed on DRAFT sheets.", {
      statusCode: 400,
      code: "RS_NOT_DRAFT",
    });
  }

  const iid = Number(itemId);
  const decision = await tx.noQtyRsItemRecoveryDecision.findUnique({
    where: {
      requirementSheetId_itemId: { requirementSheetId: sheet.id, itemId: iid },
    },
    include: { lines: true },
  });
  if (!decision || decision.status === "PENDING" || decision.status === "CANCELLED") {
    throw decisionError("No decided Keep/Waive to reverse for this FG item.", {
      statusCode: 404,
      code: "RECOVERY_DECISION_NOT_FOUND",
    });
  }

  if (decision.status === "KEPT") {
    for (const ln of decision.lines || []) {
      if (ln.effect !== "KEEP" || ln.recoveryAllocationId == null) continue;
      try {
        await reverseRecovery(tx, {
          allocationId: ln.recoveryAllocationId,
          reason: reason || "Recovery Keep reversed",
          actorUserId,
        });
      } catch (e) {
        if (e && e.code === "RECOVERY_IRREVERSIBLE") throw e;
      }
    }
  } else if (decision.status === "WAIVED") {
    for (const ln of decision.lines || []) {
      if (ln.effect !== "WAIVE") continue;
      await reverseWaivedQtyOnSource(tx, {
        recoverySourceId: ln.recoverySourceId,
        qty: ln.qty,
        actorUserId,
        reason: reason || "Recovery Waive reversed",
      });
    }
  }

  await tx.noQtyRsItemRecoveryDecisionLine.deleteMany({ where: { decisionId: decision.id } });
  await tx.noQtyRsItemRecoveryDecision.update({
    where: { id: decision.id },
    data: {
      status: "PENDING",
      reason: null,
      decidedAt: null,
      decidedByUserId: null,
    },
  });

  const line = await tx.requirementSheetLine.findUnique({
    where: { sheetId_itemId: { sheetId: sheet.id, itemId: iid } },
  });
  if (line) await syncRequirementSheetLineComponentsSafe(tx, line.id);

  await syncPendingRecoveryDecisionsForSheet(tx, { requirementSheetId: sheet.id, actorUserId });

  if (typeof actorUserId === "number") {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `REQUIREMENT_SHEET:${sheet.id}`,
      actorUserId,
      actorRole,
      summary: `Reversed recovery decision for item ${iid} on RS ${sheet.id}`,
      reason: reason?.trim() || null,
      payload: {
        module: "RS_RECOVERY_DECISION",
        actionLabel: "REVERSE",
        itemId: iid,
        priorStatus: decision.status,
      },
    });
  }

  return getRecoveryDecisionsForSheet(tx, sheet.id);
}

/**
 * Decision-only / Recovery-only cycle eligibility.
 *
 * When Current Requirement = 0 and every carry-forward item is KEEP or WAIVE
 * (no production required), the RS may still Finalize/Lock so the cycle can close
 * without manufacturing. Prevents zero-demand recovery draft deadlock.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient | import("@prisma/client").PrismaClient} tx
 * @param {{
 *   requirementSheetId: number,
 *   lines?: Array<{ baseDemandQty?: unknown, requirementQty?: unknown, totalRsQty?: unknown, suggestedWoQtySnapshot?: unknown }>,
 *   skipPendingSync?: boolean,
 * }} input
 * @returns {Promise<{
 *   eligible: boolean,
 *   reason: string | null,
 *   decidedCount: number,
 *   pendingCount: number,
 *   totalBaseDemandQty: number,
 *   totalToProduceQty: number,
 *   activeWoCount: number,
 * }>}
 */
async function assessDecisionOnlyRecoveryCycleEligibility(tx, input) {
  const sheetId = Number(input.requirementSheetId);
  const empty = {
    eligible: false,
    reason: "INVALID_SHEET",
    decidedCount: 0,
    pendingCount: 0,
    totalBaseDemandQty: 0,
    totalToProduceQty: 0,
    activeWoCount: 0,
  };
  if (!(sheetId > 0)) return empty;

  const sheet =
    input.lines != null
      ? await tx.requirementSheet.findUnique({
          where: { id: sheetId },
          select: { id: true, status: true, salesOrderId: true, cycleId: true },
        })
      : await tx.requirementSheet.findUnique({
          where: { id: sheetId },
          select: {
            id: true,
            status: true,
            salesOrderId: true,
            cycleId: true,
            lines: {
              select: {
                baseDemandQty: true,
                requirementQty: true,
                totalRsQty: true,
                suggestedWoQtySnapshot: true,
              },
            },
          },
        });
  if (!sheet) return empty;

  const lines = input.lines != null ? input.lines : sheet.lines || [];
  let totalBaseDemandQty = 0;
  let totalToProduceQty = 0;
  for (const ln of lines) {
    totalBaseDemandQty = round3(
      totalBaseDemandQty + n(ln.baseDemandQty ?? ln.requirementQty),
    );
    totalToProduceQty = round3(
      totalToProduceQty + n(ln.totalRsQty ?? ln.suggestedWoQtySnapshot ?? 0),
    );
  }

  if (totalBaseDemandQty > EPS) {
    return {
      eligible: false,
      reason: "POSITIVE_BASE_DEMAND",
      decidedCount: 0,
      pendingCount: 0,
      totalBaseDemandQty,
      totalToProduceQty,
      activeWoCount: 0,
    };
  }
  if (totalToProduceQty > EPS) {
    return {
      eligible: false,
      reason: "POSITIVE_TO_PRODUCE",
      decidedCount: 0,
      pendingCount: 0,
      totalBaseDemandQty,
      totalToProduceQty,
      activeWoCount: 0,
    };
  }

  if (!input.skipPendingSync && sheet.status === "DRAFT") {
    await syncPendingRecoveryDecisionsForSheet(tx, { requirementSheetId: sheetId });
  }

  const decisions = await tx.noQtyRsItemRecoveryDecision.findMany({
    where: { requirementSheetId: sheetId, status: { not: "CANCELLED" } },
    select: { status: true, pendingRecoveryQty: true },
  });
  const pending = decisions.filter(
    (d) => d.status === "PENDING" && round3(n(d.pendingRecoveryQty)) > EPS,
  );
  const decided = decisions.filter((d) => d.status === "KEPT" || d.status === "WAIVED");
  if (pending.length > 0) {
    return {
      eligible: false,
      reason: "RECOVERY_DECISION_PENDING",
      decidedCount: decided.length,
      pendingCount: pending.length,
      totalBaseDemandQty,
      totalToProduceQty,
      activeWoCount: 0,
    };
  }
  if (decided.length === 0) {
    return {
      eligible: false,
      reason: "NO_RECOVERY_DECISIONS",
      decidedCount: 0,
      pendingCount: 0,
      totalBaseDemandQty,
      totalToProduceQty,
      activeWoCount: 0,
    };
  }

  const cycleId = sheet.cycleId != null ? Number(sheet.cycleId) : null;
  const woWhere = {
    salesOrderId: sheet.salesOrderId,
    status: { not: "REJECTED" },
  };
  if (cycleId != null && Number.isFinite(cycleId) && cycleId > 0) {
    woWhere.cycleId = cycleId;
  }
  const activeWoCount = await tx.workOrder.count({ where: woWhere });
  if (activeWoCount > 0) {
    return {
      eligible: false,
      reason: "ACTIVE_WO_EXISTS",
      decidedCount: decided.length,
      pendingCount: 0,
      totalBaseDemandQty,
      totalToProduceQty,
      activeWoCount,
    };
  }

  const { summarizeNoQtyProductionQcPending } = require("./noQtySoOperationalGates");
  const prodQc = await summarizeNoQtyProductionQcPending(tx, sheet.salesOrderId, {
    orderType: "NO_QTY",
  });
  if (prodQc.pending) {
    return {
      eligible: false,
      reason: prodQc.reason || "PRODUCTION_OR_QC_PENDING",
      decidedCount: decided.length,
      pendingCount: 0,
      totalBaseDemandQty,
      totalToProduceQty,
      activeWoCount,
    };
  }

  return {
    eligible: true,
    reason: null,
    decidedCount: decided.length,
    pendingCount: 0,
    totalBaseDemandQty,
    totalToProduceQty,
    activeWoCount,
  };
}

/**
 * Lock gate: every FG item with pending recovery must be KEPT or WAIVED.
 */
async function assertNoPendingRecoveryDecisionsOrThrow(tx, requirementSheetId) {
  await syncPendingRecoveryDecisionsForSheet(tx, { requirementSheetId });
  const pending = await tx.noQtyRsItemRecoveryDecision.findMany({
    where: { requirementSheetId: Number(requirementSheetId), status: "PENDING" },
    include: { item: { select: { id: true, itemName: true } } },
  });
  const withQty = pending.filter((d) => round3(n(d.pendingRecoveryQty)) > EPS);
  if (!withQty.length) return { ok: true, pendingItems: [] };

  const pendingItems = withQty.map((d) => ({
    itemId: d.itemId,
    itemName: d.item?.itemName ?? null,
    pendingRecoveryQty: round3(n(d.pendingRecoveryQty)),
    productionShortfallQty: round3(n(d.productionShortfallQty)),
    qcFinalRejectionQty: round3(n(d.qcFinalRejectionQty)),
    decisionStatus: d.status,
  }));

  throw decisionError(
    "Cannot lock Requirement Sheet while recovery decisions are pending. Keep or Waive each FG item with pending recovery.",
    {
      statusCode: 409,
      code: "RECOVERY_DECISION_PENDING",
      details: { pendingItems },
    },
  );
}

/**
 * Lock finalize: gate decisions, commit KEEP reservations, refresh components.
 * Does NOT auto-allocate any recovery.
 */
async function finalizeRecoveryDecisionsOnRequirementSheetLock(tx, { requirementSheetId, actorUserId = null }) {
  const sheetId = Number(requirementSheetId);
  const sheet = await loadSheetDecisionContext(tx, sheetId);
  if (sheet.status !== "DRAFT") {
    throw decisionError("Only DRAFT requirement sheets can be locked.", {
      statusCode: 400,
      code: "RS_NOT_DRAFT",
    });
  }

  await assertNoPendingRecoveryDecisionsOrThrow(tx, sheetId);

  for (const ln of sheet.lines || []) {
    const base = round3(n(ln.requirementQty ?? ln.baseDemandQty));
    await tx.requirementSheetLine.update({
      where: { id: ln.id },
      data: { baseDemandQty: String(base), requirementQty: String(base) },
    });
  }

  const committed = await commitReservedAllocationsForSheet(tx, {
    requirementSheetId: sheetId,
    actorUserId,
  });
  const lines = await syncAllSheetLineComponentsSafe(tx, sheetId);

  for (const ln of lines) {
    const shortfall = round3(n(ln.productionShortfallQty));
    const total = round3(n(ln.totalRsQty));
    const base = round3(n(ln.baseDemandQty));
    await tx.requirementSheetLine.update({
      where: { id: ln.id },
      data: {
        shortfallQtySnapshot: String(shortfall),
        suggestedWoQtySnapshot: String(total),
        requirementQty: String(base),
      },
    });
  }

  return { committed, lines };
}

/**
 * Cancel/delete draft: reverse Keep allocations and Waive effects; cancel decisions.
 */
async function reverseRecoveryDecisionsForSheet(
  tx,
  { requirementSheetId, actorUserId = null, deleteDecisionRows = false },
) {
  const sheetId = Number(requirementSheetId);
  const decisions = await tx.noQtyRsItemRecoveryDecision.findMany({
    where: { requirementSheetId: sheetId, status: { in: ["KEPT", "WAIVED", "PENDING"] } },
    include: { lines: true },
  });

  for (const d of decisions) {
    if (d.status === "KEPT") {
      for (const ln of d.lines || []) {
        if (ln.effect !== "KEEP" || ln.recoveryAllocationId == null) continue;
        try {
          await reverseRecovery(tx, {
            allocationId: ln.recoveryAllocationId,
            reason: "Requirement sheet cancelled/deleted",
            actorUserId,
          });
        } catch {
          /* already reversed */
        }
      }
    } else if (d.status === "WAIVED") {
      for (const ln of d.lines || []) {
        if (ln.effect !== "WAIVE") continue;
        try {
          await reverseWaivedQtyOnSource(tx, {
            recoverySourceId: ln.recoverySourceId,
            qty: ln.qty,
            actorUserId,
            reason: "Requirement sheet cancelled/deleted",
          });
        } catch {
          /* ignore */
        }
      }
    }

    if (deleteDecisionRows) {
      await tx.noQtyRsItemRecoveryDecisionLine.deleteMany({ where: { decisionId: d.id } });
      await tx.noQtyRsItemRecoveryDecision.delete({ where: { id: d.id } });
    } else {
      await tx.noQtyRsItemRecoveryDecisionLine.deleteMany({ where: { decisionId: d.id } });
      await tx.noQtyRsItemRecoveryDecision.update({
        where: { id: d.id },
        data: {
          status: "CANCELLED",
          decidedAt: null,
          decidedByUserId: null,
        },
      });
    }
  }
}

module.exports = {
  syncPendingRecoveryDecisionsForSheet,
  ensureLinesForPendingRecoveryItems,
  getRecoveryDecisionsForSheet,
  keepItemRecovery,
  waiveItemRecovery,
  reverseItemRecoveryDecision,
  assertNoPendingRecoveryDecisionsOrThrow,
  finalizeRecoveryDecisionsOnRequirementSheetLock,
  reverseRecoveryDecisionsForSheet,
  assessDecisionOnlyRecoveryCycleEligibility,
  summarizeAvailableByItem,
};
