const { prisma } = require("../utils/prisma");
const auditLog = require("./auditLog");
const { QUEUE_EPS, qtyToNumber } = require("./rmPurchaseHelpers");

function activeReceivedQtyForPoLine(poLine) {
  let received = 0;
  for (const gl of poLine?.grnLines || []) {
    if (gl.grn?.reversedAt) continue;
    received += qtyToNumber(gl.receivedQty);
  }
  return received;
}

function proportionalPart(total, part, base) {
  const t = qtyToNumber(total);
  const p = qtyToNumber(part);
  const b = qtyToNumber(base);
  if (t <= QUEUE_EPS || p <= QUEUE_EPS || b <= QUEUE_EPS) return 0;
  return t * Math.min(1, p / b);
}

function targetQtyForMrLine(line) {
  const shortage = qtyToNumber(line.shortageQty);
  if (shortage > QUEUE_EPS) return shortage;
  return qtyToNumber(line.requiredQty);
}

function receivedQtyForMrLine(line) {
  let received = 0;

  for (const source of line.purchaseRequestSourceLinks || []) {
    const prLine = source.purchaseRequestLine;
    if (!prLine) continue;
    const totalSource = (prLine.sourceLinks || []).reduce((s, lk) => s + qtyToNumber(lk.allocatedQty), 0);
    if (totalSource <= QUEUE_EPS) continue;
    const sourceRatio = qtyToNumber(source.allocatedQty) / totalSource;
    if (sourceRatio <= QUEUE_EPS) continue;

    for (const poLink of prLine.poLinks || []) {
      const poLine = poLink.rmPoLine;
      if (!poLine || poLine.rmPo?.status === "CANCELLED") continue;
      const poReceived = activeReceivedQtyForPoLine(poLine);
      const receivedForLink = proportionalPart(poReceived, poLink.allocatedQty, poLine.qty);
      received += receivedForLink * sourceRatio;
    }
  }

  for (const poLink of line.procurementLinks || []) {
    const poLine = poLink.rmPoLine;
    if (!poLine || poLine.rmPo?.status === "CANCELLED") continue;
    const poReceived = activeReceivedQtyForPoLine(poLine);
    received += proportionalPart(poReceived, poLink.allocatedQty, poLine.qty);
  }

  return received;
}

function isMaterialRequirementFullyReceived(mr) {
  const lines = mr?.lines || [];
  const demandLines = lines.filter((line) => targetQtyForMrLine(line) > QUEUE_EPS);
  if (!demandLines.length) return false;
  return demandLines.every((line) => receivedQtyForMrLine(line) + QUEUE_EPS >= targetQtyForMrLine(line));
}

function isMaterialRequirementPartiallyReceived(mr) {
  return (mr?.lines || []).some((line) => receivedQtyForMrLine(line) > QUEUE_EPS);
}

function hasMaterialRequirementPoLink(mr) {
  return (mr?.lines || []).some(
    (line) =>
      (line.procurementLinks || []).some((link) => link.rmPoLine?.rmPo?.status !== "CANCELLED") ||
      (line.purchaseRequestSourceLinks || []).some((source) =>
        (source.purchaseRequestLine?.poLinks || []).some((link) => link.rmPoLine?.rmPo?.status !== "CANCELLED"),
      ),
  );
}

async function loadMaterialRequirementsForLifecycle(db, ids) {
  const uniq = [...new Set((ids || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  if (!uniq.length) return [];
  return db.materialRequirement.findMany({
    where: { id: { in: uniq }, status: { not: "CANCELLED" } },
    include: {
      lines: {
        include: {
          procurementLinks: {
            include: {
              rmPoLine: {
                include: {
                  rmPo: { select: { id: true, status: true } },
                  grnLines: { include: { grn: { select: { id: true, reversedAt: true } } } },
                },
              },
            },
          },
          purchaseRequestSourceLinks: {
            include: {
              purchaseRequestLine: {
                include: {
                  sourceLinks: true,
                  poLinks: {
                    include: {
                      rmPoLine: {
                        include: {
                          rmPo: { select: { id: true, status: true } },
                          grnLines: { include: { grn: { select: { id: true, reversedAt: true } } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

async function loadMaterialRequirementIdsForRmPo(db, rmPoId) {
  const poLineLinks = await db.rmPoLineProcurementLink.findMany({
    where: { rmPoLine: { rmPoId } },
    select: {
      materialRequirementLine: { select: { materialRequirementId: true } },
      purchaseRequestLine: {
        select: {
          sourceLinks: { select: { materialRequirementLine: { select: { materialRequirementId: true } } } },
        },
      },
    },
  });
  const ids = new Set();
  for (const link of poLineLinks) {
    if (link.materialRequirementLine?.materialRequirementId) ids.add(link.materialRequirementLine.materialRequirementId);
    for (const source of link.purchaseRequestLine?.sourceLinks || []) {
      if (source.materialRequirementLine?.materialRequirementId) {
        ids.add(source.materialRequirementLine.materialRequirementId);
      }
    }
  }
  return [...ids];
}

async function recalculateMaterialRequirementClosure(db, materialRequirementIds) {
  const mrs = await loadMaterialRequirementsForLifecycle(db, materialRequirementIds);
  const changes = [];
  for (const mr of mrs) {
    const fullyReceived = isMaterialRequirementFullyReceived(mr);
    const partiallyReceived = isMaterialRequirementPartiallyReceived(mr);
    const hasPo = hasMaterialRequirementPoLink(mr);
    const next = fullyReceived
      ? "FULLY_PROCURED"
      : partiallyReceived
        ? "PARTIALLY_PROCURED"
        : hasPo
          ? "PROCUREMENT_IN_PROGRESS"
          : mr.status === "CANCELLED" || mr.status === "CLOSED"
            ? mr.status
            : mr.status === "DRAFT" || mr.status === "PENDING_APPROVAL"
              ? mr.status
              : "SENT_TO_PURCHASE";
    if (mr.status !== next) {
      await db.materialRequirement.update({
        where: { id: mr.id },
        data: { status: next, ...(next === "FULLY_PROCURED" ? { closedAt: new Date() } : {}) },
      });
      changes.push({ id: mr.id, from: mr.status, to: next });
    }
  }
  return changes;
}

async function recalculateMaterialRequirementClosureForRmPo(db, rmPoId) {
  const ids = await loadMaterialRequirementIdsForRmPo(db, rmPoId);
  return recalculateMaterialRequirementClosure(db, ids);
}

function mrLineSignature(mr) {
  return (mr.lines || [])
    .map((line) => `${line.rmItemId}:${targetQtyForMrLine(line).toFixed(3)}`)
    .sort()
    .join("|");
}

function prHasAnyPo(pr) {
  return (pr.lines || []).some((line) => (line.poLinks || []).length > 0);
}

function prSourcesOnlyMatchMr(pr, mrId) {
  const lines = pr.lines || [];
  if (!lines.length) return false;
  return lines.every(
    (line) =>
      (line.sourceLinks || []).length > 0 &&
      line.sourceLinks.every((source) => source.materialRequirementLine?.materialRequirementId === mrId),
  );
}

async function repairStaleDuplicateWoPlanningProcurement(db = prisma, actor = {}) {
  const candidates = await db.materialRequirement.findMany({
    where: {
      status: "DRAFT",
      sourceType: "WORK_ORDER_PLANNING",
      salesOrderId: { not: null },
    },
    include: {
      lines: {
        include: {
          purchaseRequestSourceLinks: {
            include: {
              purchaseRequestLine: {
                include: {
                  purchaseRequest: true,
                  sourceLinks: { include: { materialRequirementLine: { select: { materialRequirementId: true } } } },
                  poLinks: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const repaired = [];
  for (const candidate of candidates) {
    const prsById = new Map();
    for (const line of candidate.lines || []) {
      for (const source of line.purchaseRequestSourceLinks || []) {
        const prLine = source.purchaseRequestLine;
        if (prLine?.purchaseRequest) {
          const existing = prsById.get(prLine.purchaseRequest.id) || { ...prLine.purchaseRequest, lines: [] };
          existing.lines.push(prLine);
          prsById.set(prLine.purchaseRequest.id, existing);
        }
      }
    }
    const prs = [...prsById.values()];
    if (!prs.length || prs.some((pr) => pr.status === "CANCELLED" || prHasAnyPo(pr) || !prSourcesOnlyMatchMr(pr, candidate.id))) {
      continue;
    }

    const sameSo = await loadMaterialRequirementsForLifecycle(
      db,
      (
        await db.materialRequirement.findMany({
          where: {
            id: { not: candidate.id },
            salesOrderId: candidate.salesOrderId,
            workOrderId: candidate.workOrderId,
            sourceType: "WORK_ORDER_PLANNING",
            status: { not: "CANCELLED" },
          },
          select: { id: true },
        })
      ).map((row) => row.id),
    );
    const candidateSig = mrLineSignature(candidate);
    const fulfilled = sameSo.find((mr) => mrLineSignature(mr) === candidateSig && isMaterialRequirementFullyReceived(mr));
    if (!fulfilled) continue;

    const reason = `Superseded by fully received ${fulfilled.docNo || `MR-${fulfilled.id}`}.`;
    await db.$transaction(async (tx) => {
      for (const pr of prs) {
        await tx.purchaseRequest.update({
          where: { id: pr.id },
          data: {
            status: "CANCELLED",
            remarks: [pr.remarks, reason].filter(Boolean).join("\n"),
          },
        });
        await auditLog.write(tx, {
          action: auditLog.AuditAction.UPDATE,
          entityType: auditLog.AuditEntityType.SETTINGS,
          entityId: `PURCHASE_REQUEST:${pr.id}`,
          actorUserId: actor.userId,
          actorRole: actor.role,
          summary: `Stale duplicate purchase request ${pr.docNo || pr.id} cancelled`,
          reason,
          payload: {
            module: "PROCUREMENT_LIFECYCLE",
            actionLabel: "STALE_DUPLICATE_REPAIR",
            supersededByMaterialRequirementId: fulfilled.id,
            salesOrderId: candidate.salesOrderId,
          },
        });
      }
      await tx.materialRequirement.update({
        where: { id: candidate.id },
        data: {
          status: "CANCELLED",
          remarks: [candidate.remarks, reason].filter(Boolean).join("\n"),
        },
      });
      await auditLog.write(tx, {
        action: auditLog.AuditAction.UPDATE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `MATERIAL_REQUIREMENT:${candidate.id}`,
        actorUserId: actor.userId,
        actorRole: actor.role,
        summary: `Stale duplicate material requirement ${candidate.docNo || candidate.id} cancelled`,
        reason,
        payload: {
          module: "PROCUREMENT_LIFECYCLE",
          actionLabel: "STALE_DUPLICATE_REPAIR",
          supersededByMaterialRequirementId: fulfilled.id,
          cancelledPurchaseRequestIds: prs.map((pr) => pr.id),
          salesOrderId: candidate.salesOrderId,
        },
      });
    });
    repaired.push({ materialRequirementId: candidate.id, purchaseRequestIds: prs.map((pr) => pr.id), supersededBy: fulfilled.id });
  }
  return repaired;
}

module.exports = {
  activeReceivedQtyForPoLine,
  targetQtyForMrLine,
  receivedQtyForMrLine,
  isMaterialRequirementFullyReceived,
  isMaterialRequirementPartiallyReceived,
  loadMaterialRequirementIdsForRmPo,
  recalculateMaterialRequirementClosure,
  recalculateMaterialRequirementClosureForRmPo,
  repairStaleDuplicateWoPlanningProcurement,
};
