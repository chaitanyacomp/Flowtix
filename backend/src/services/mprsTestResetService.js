const { DocType } = require("../prismaClientPackage");

const MONTHLY_PLAN_SOURCE = "MONTHLY_PLAN";

const MPRS_RESET_CONFIRM_TEXT = "RESET MPRS";

/** Doc sequences cleared for a clean MPRS test baseline. */
const MPRS_RESET_DOC_TYPES = [
  DocType.MONTHLY_PRODUCTION_PLAN,
  DocType.REQUIREMENT_SHEET,
  DocType.MATERIAL_REQUIREMENT,
  DocType.PURCHASE_REQUEST,
];

/** @type {Record<string, string>} */
const MPRS_METRIC_LABELS = {
  requirementSheets: "Requirement Sheets",
  monthlyPlans: "Monthly Plans",
  rmSnapshots: "RM Snapshots",
  materialRequirementsMonthlyPlan: "Material Requirements (Monthly Plan)",
  purchaseRequestsMonthlyLinked: "Purchase Requests (Monthly Plan)",
  rmPurchaseOrdersMonthlyLinked: "RM Purchase Orders (Monthly Plan)",
  grnsMonthlyLinked: "GRNs (Monthly Plan)",
};

class MprsResetStepError extends Error {
  /** @param {string} step @param {string} error */
  constructor(step, error) {
    super(`FAILED at ${step}: ${error}`);
    this.name = "MprsResetStepError";
    this.step = step;
    this.error = error;
  }
}

/** @param {import("@prisma/client").Prisma.TransactionClient} tx */
async function getMprsResetMetricCounts(tx) {
  const monthlyMr = { sourceType: MONTHLY_PLAN_SOURCE };
  return {
    requirementSheets: await tx.requirementSheet.count(),
    monthlyPlans: await tx.monthlyProductionPlan.count(),
    rmSnapshots: await tx.rmPlan.count(),
    materialRequirementsMonthlyPlan: await tx.materialRequirement.count({ where: monthlyMr }),
    purchaseRequestsMonthlyLinked: await tx.purchaseRequest.count({
      where: {
        lines: {
          some: {
            sourceLinks: {
              some: { materialRequirementLine: { materialRequirement: monthlyMr } },
            },
          },
        },
      },
    }),
    rmPurchaseOrdersMonthlyLinked: await tx.rmPurchaseOrder.count({
      where: {
        lines: {
          some: {
            procurementLinks: {
              some: { materialRequirementLine: { materialRequirement: monthlyMr } },
            },
          },
        },
      },
    }),
    grnsMonthlyLinked: await tx.grn.count({
      where: {
        rmPo: {
          lines: {
            some: {
              procurementLinks: {
                some: { materialRequirementLine: { materialRequirement: monthlyMr } },
              },
            },
          },
        },
      },
    }),
  };
}

/**
 * @param {Record<string, number>} counts
 * @returns {{ label: string, key: string, before: number, after: number }[]}
 */
function buildMprsCountSummary(before, after) {
  return Object.keys(MPRS_METRIC_LABELS).map((key) => ({
    key,
    label: MPRS_METRIC_LABELS[key],
    before: before[key] ?? 0,
    after: after[key] ?? 0,
  }));
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 */
async function collectMonthlyPlanProcurementScope(tx) {
  const mrRows = await tx.materialRequirement.findMany({
    where: { sourceType: MONTHLY_PLAN_SOURCE },
    select: { id: true },
  });
  const mrIds = mrRows.map((r) => r.id);
  if (mrIds.length === 0) {
    return {
      mrIds: [],
      mrLineIds: [],
      prLineIds: [],
      prIds: [],
      rmPoLineIds: [],
      rmPoIds: [],
      grnIds: [],
    };
  }

  const mrLineRows = await tx.materialRequirementLine.findMany({
    where: { materialRequirementId: { in: mrIds } },
    select: { id: true },
  });
  const mrLineIds = mrLineRows.map((r) => r.id);

  const sourceLinks =
    mrLineIds.length === 0
      ? []
      : await tx.purchaseRequestLineSourceLink.findMany({
          where: { materialRequirementLineId: { in: mrLineIds } },
          select: { purchaseRequestLineId: true },
        });
  const prLineIds = [...new Set(sourceLinks.map((s) => s.purchaseRequestLineId))];

  const prRows =
    prLineIds.length === 0
      ? []
      : await tx.purchaseRequestLine.findMany({
          where: { id: { in: prLineIds } },
          select: { purchaseRequestId: true },
        });
  const prIds = [...new Set(prRows.map((r) => r.purchaseRequestId))];

  /** @type {import("@prisma/client").Prisma.RmPoLineProcurementLinkWhereInput} */
  const procLinkWhere = {
    OR: [
      { materialRequirementLineId: { in: mrLineIds } },
      ...(prLineIds.length > 0 ? [{ purchaseRequestLineId: { in: prLineIds } }] : []),
    ],
  };

  const procLinks =
    mrLineIds.length === 0 && prLineIds.length === 0
      ? []
      : await tx.rmPoLineProcurementLink.findMany({
          where: procLinkWhere,
          select: { rmPoLineId: true },
        });
  const rmPoLineIds = [...new Set(procLinks.map((l) => l.rmPoLineId))];

  const rmPoLineRows =
    rmPoLineIds.length === 0
      ? []
      : await tx.rmPurchaseOrderLine.findMany({
          where: { id: { in: rmPoLineIds } },
          select: { rmPoId: true },
        });
  const rmPoIds = [...new Set(rmPoLineRows.map((r) => r.rmPoId))];

  const grnRows =
    rmPoIds.length === 0
      ? []
      : await tx.grn.findMany({
          where: { rmPoId: { in: rmPoIds } },
          select: { id: true },
        });
  const grnIds = grnRows.map((r) => r.id);

  return { mrIds, mrLineIds, prLineIds, prIds, rmPoLineIds, rmPoIds, grnIds, procLinkWhere };
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 */
async function verifyMprsResetComplete(tx) {
  const after = await getMprsResetMetricCounts(tx);
  const remaining = Object.entries(after).filter(([, count]) => count > 0);
  if (remaining.length > 0) {
    const detail = remaining.map(([key, count]) => `${MPRS_METRIC_LABELS[key] ?? key}=${count}`).join(", ");
    throw new MprsResetStepError("verification", `Rows remain after MPRS reset: ${detail}`);
  }
  return after;
}

/**
 * @param {Record<string, number>} deleted
 * @param {string} key
 * @param {() => Promise<{ count?: number }>} fn
 */
async function runDeleteStep(deleted, key, fn) {
  try {
    const res = await fn();
    deleted[key] = typeof res?.count === "number" ? res.count : 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new MprsResetStepError(key, msg);
  }
}

/**
 * P7F-CA7 — MPRS test reset (single transaction; caller provides tx).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @returns {Promise<{ before: Record<string, number>, after: Record<string, number>, counts: ReturnType<typeof buildMprsCountSummary>, deleted: Record<string, number> }>}
 */
async function runMprsTestReset(tx) {
  /** @type {Record<string, number>} */
  const deleted = {};
  const before = await getMprsResetMetricCounts(tx);
  const scope = await collectMonthlyPlanProcurementScope(tx);

  // Phase A — monthly-plan procurement chain (FK-safe order)
  if (scope.grnIds.length > 0) {
    await runDeleteStep(deleted, "grnLine", () =>
      tx.grnLine.deleteMany({ where: { grnId: { in: scope.grnIds } } }),
    );
    await runDeleteStep(deleted, "grn", () => tx.grn.deleteMany({ where: { id: { in: scope.grnIds } } }));
  } else {
    deleted.grnLine = 0;
    deleted.grn = 0;
  }

  if (scope.mrLineIds.length > 0 || scope.prLineIds.length > 0) {
    await runDeleteStep(deleted, "rmPoLineProcurementLink", () =>
      tx.rmPoLineProcurementLink.deleteMany({ where: scope.procLinkWhere }),
    );
  } else {
    deleted.rmPoLineProcurementLink = 0;
  }

  if (scope.mrLineIds.length > 0) {
    await runDeleteStep(deleted, "purchaseRequestLineSourceLink", () =>
      tx.purchaseRequestLineSourceLink.deleteMany({
        where: { materialRequirementLineId: { in: scope.mrLineIds } },
      }),
    );
  } else {
    deleted.purchaseRequestLineSourceLink = 0;
  }

  if (scope.mrIds.length > 0) {
    await runDeleteStep(deleted, "materialRequirementLine", () =>
      tx.materialRequirementLine.deleteMany({ where: { materialRequirementId: { in: scope.mrIds } } }),
    );
    await runDeleteStep(deleted, "materialRequirement", () =>
      tx.materialRequirement.deleteMany({
        where: { id: { in: scope.mrIds }, sourceType: MONTHLY_PLAN_SOURCE },
      }),
    );
  } else {
    deleted.materialRequirementLine = 0;
    deleted.materialRequirement = 0;
  }

  if (scope.prLineIds.length > 0) {
    await runDeleteStep(deleted, "purchaseRequestLine", () =>
      tx.purchaseRequestLine.deleteMany({ where: { id: { in: scope.prLineIds } } }),
    );
  } else {
    deleted.purchaseRequestLine = 0;
  }

  if (scope.prIds.length > 0) {
    await runDeleteStep(deleted, "purchaseRequest", () =>
      tx.purchaseRequest.deleteMany({
        where: { id: { in: scope.prIds }, lines: { none: {} } },
      }),
    );
  } else {
    deleted.purchaseRequest = 0;
  }

  if (scope.rmPoLineIds.length > 0) {
    await runDeleteStep(deleted, "rmPurchaseOrderLine", () =>
      tx.rmPurchaseOrderLine.deleteMany({ where: { id: { in: scope.rmPoLineIds } } }),
    );
  } else {
    deleted.rmPurchaseOrderLine = 0;
  }

  if (scope.rmPoIds.length > 0) {
    await runDeleteStep(deleted, "rmPurchaseOrder", () =>
      tx.rmPurchaseOrder.deleteMany({
        where: { id: { in: scope.rmPoIds }, lines: { none: {} } },
      }),
    );
  } else {
    deleted.rmPurchaseOrder = 0;
  }

  // Phase B — monthly planning & RM snapshots
  await runDeleteStep(deleted, "rmPlan", () => tx.rmPlan.deleteMany({}));
  await runDeleteStep(deleted, "monthlyProductionPlan", () => tx.monthlyProductionPlan.deleteMany({}));

  // Phase C — requirement sheets
  await runDeleteStep(deleted, "requirementSheetLine", () => tx.requirementSheetLine.deleteMany({}));
  await runDeleteStep(deleted, "requirementSheet", () => tx.requirementSheet.deleteMany({}));

  // Phase D — NO_QTY planning artifacts (no FK blockers for RS delete)
  await runDeleteStep(deleted, "noQtySoClosedShortageLine", () => tx.noQtySoClosedShortageLine.deleteMany({}));
  await runDeleteStep(deleted, "noQtySoCloseSnapshot", () => tx.noQtySoCloseSnapshot.deleteMany({}));

  // Document sequences
  await runDeleteStep(deleted, "docSequence", () =>
    tx.docSequence.deleteMany({
      where: { docType: { in: MPRS_RESET_DOC_TYPES } },
    }),
  );

  const after = await verifyMprsResetComplete(tx);
  const counts = buildMprsCountSummary(before, after);

  return { before, after, counts, deleted };
}

module.exports = {
  MONTHLY_PLAN_SOURCE,
  MPRS_RESET_CONFIRM_TEXT,
  MPRS_RESET_DOC_TYPES,
  MPRS_METRIC_LABELS,
  MprsResetStepError,
  collectMonthlyPlanProcurementScope,
  getMprsResetMetricCounts,
  verifyMprsResetComplete,
  runMprsTestReset,
  buildMprsCountSummary,
};
