/**
 * Batch 3A — pure mapping helpers for NO_QTY recovery schema backfill.
 * No DB I/O. Used by migration unit tests to lock backfill rules.
 */

function mapLegacyCfStatusToRecoveryStatus(status) {
  return String(status) === "CONSUMED" ? "FULLY_ALLOCATED" : "OPEN";
}

function mapLegacySoStatus(internalStatus) {
  return String(internalStatus) === "MANUALLY_CLOSED" ? "CLOSED_WITH_WAIVER" : internalStatus;
}

function mapCfProvenance(row) {
  if (row.productionShortfallResolutionId != null) {
    return {
      sourceDocumentType: "PRODUCTION_SHORTFALL_RESOLUTION",
      sourceDocumentId: Number(row.productionShortfallResolutionId),
    };
  }
  if (row.sourceWorkOrderId != null) {
    return {
      sourceDocumentType: "WORK_ORDER",
      sourceDocumentId: Number(row.sourceWorkOrderId),
    };
  }
  return { sourceDocumentType: null, sourceDocumentId: null };
}

function mapRsLineComponents(line) {
  const requirementQty = Number(line.requirementQty ?? 0);
  const shortfall = line.shortfallQtySnapshot != null ? Number(line.shortfallQtySnapshot) : 0;
  const suggested =
    line.suggestedWoQtySnapshot != null ? Number(line.suggestedWoQtySnapshot) : requirementQty + shortfall;
  return {
    baseDemandQty: requirementQty,
    productionShortfallQty: shortfall,
    qcRejectionRecoveryQty: 0,
    approvedManualAdjustmentQty: 0,
    totalRsQty: suggested,
  };
}

function shouldReconstructCommittedAllocation(cf) {
  return (
    String(cf.status) === "CONSUMED" &&
    cf.targetRequirementSheetId != null &&
    Number(cf.sourceQty ?? cf.remainingQty ?? 0) > 0
  );
}

/** Deduplicate provenance: keep lowest id per (type, docType, docId). */
function markDuplicateProvenanceIncomplete(rows) {
  const best = new Map();
  const out = rows.map((r) => ({ ...r, migrationIncomplete: Boolean(r.migrationIncomplete) }));
  for (const r of out) {
    if (r.sourceDocumentType == null || r.sourceDocumentId == null) continue;
    const key = `${r.recoveryType}|${r.sourceDocumentType}|${r.sourceDocumentId}`;
    const prev = best.get(key);
    if (!prev || r.id < prev.id) best.set(key, r);
  }
  for (const r of out) {
    if (r.sourceDocumentType == null || r.sourceDocumentId == null) continue;
    const key = `${r.recoveryType}|${r.sourceDocumentType}|${r.sourceDocumentId}`;
    const keep = best.get(key);
    if (keep && keep.id !== r.id) {
      r.sourceDocumentType = null;
      r.sourceDocumentId = null;
      r.migrationIncomplete = true;
    }
  }
  return out;
}

module.exports = {
  mapLegacyCfStatusToRecoveryStatus,
  mapLegacySoStatus,
  mapCfProvenance,
  mapRsLineComponents,
  shouldReconstructCommittedAllocation,
  markDuplicateProvenanceIncomplete,
};
