/**
 * P10-A2A — Read-only RS execution summary (NO_QTY).
 * Balance uses RequirementSheetLine.requirementQty only — not suggestedWoQtySnapshot.
 */

const { buildPlanDisplayLabel } = require("./monthlyPlanningPlanLifecycleService");

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function dec(v) {
  if (v != null && typeof v === "object" && typeof v.toNumber === "function") {
    return v.toNumber();
  }
  return n(v);
}

/** Work-order line qty placed against RS execution balance (WO line planned qty). */
function woLinePlacedQty(line) {
  return round3(dec(line?.plannedQty ?? line?.qty));
}

function procurementSummaryLabel({ released, materialRequirementDocNo, mrStatus }) {
  if (!released) return "Not released to procurement";
  if (!materialRequirementDocNo) return "Released to procurement — MR pending";
  const statusPart = mrStatus ? ` · ${mrStatus}` : "";
  return `Released · MR ${materialRequirementDocNo}${statusPart}`;
}

/**
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {number} requirementSheetId
 */
async function getRequirementSheetExecutionSummary(db, requirementSheetId) {
  const sheet = await db.requirementSheet.findUnique({
    where: { id: requirementSheetId },
    include: {
      salesOrder: { select: { id: true, orderType: true } },
      lines: {
        include: { item: { select: { id: true, itemName: true, itemType: true } } },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!sheet) {
    const err = new Error("Requirement sheet not found.");
    err.statusCode = 404;
    throw err;
  }
  if (sheet.salesOrder?.orderType !== "NO_QTY") {
    const err = new Error("Execution summary is available only for No Qty requirement sheets.");
    err.statusCode = 409;
    throw err;
  }
  if (sheet.status !== "LOCKED") {
    const err = new Error("Execution summary is available only for locked requirement sheets.");
    err.statusCode = 409;
    throw err;
  }

  const periodKey = String(sheet.periodKey ?? "").trim();
  const releasedPlan = periodKey
    ? await db.monthlyProductionPlan.findFirst({
        where: { periodKey, releasedAt: { not: null } },
        orderBy: [{ releasedAt: "desc" }, { id: "desc" }],
      })
    : null;
  const released = Boolean(releasedPlan?.releasedAt);

  let materialRequirement = null;
  if (releasedPlan?.id) {
    materialRequirement = await db.materialRequirement.findFirst({
      where: {
        monthlyProductionPlanId: releasedPlan.id,
        sourceType: "MONTHLY_PLAN",
        reversedAt: null,
      },
      orderBy: { id: "desc" },
      select: { id: true, docNo: true, status: true },
    });
  }

  const workOrdersRaw = await db.workOrder.findMany({
    where: { requirementSheetId: sheet.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      lines: { select: { id: true, fgItemId: true, qty: true, plannedQty: true } },
      productionMaterialRequests: {
        orderBy: { id: "desc" },
        take: 1,
        select: { id: true, docNo: true, status: true },
      },
    },
  });

  /** @type {Map<number, number>} */
  const woPlacedByItem = new Map();
  for (const wo of workOrdersRaw) {
    for (const line of wo.lines ?? []) {
      const itemId = Number(line.fgItemId);
      if (!(itemId > 0)) continue;
      const placed = woLinePlacedQty(line);
      woPlacedByItem.set(itemId, round3((woPlacedByItem.get(itemId) ?? 0) + placed));
    }
  }

  const lines = (sheet.lines ?? []).map((ln) => {
    const itemId = Number(ln.itemId);
    const rsDemandQty = round3(dec(ln.requirementQty));
    const woPlacedQty = round3(woPlacedByItem.get(itemId) ?? 0);
    const rsBalanceQty = round3(Math.max(0, rsDemandQty - woPlacedQty));
    return {
      itemId,
      itemName: ln.item?.itemName ?? `Item ${itemId}`,
      rsDemandQty,
      woPlacedQty,
      rsBalanceQty,
    };
  });

  const totals = {
    rsDemandQty: round3(lines.reduce((s, l) => s + l.rsDemandQty, 0)),
    woPlacedQty: round3(lines.reduce((s, l) => s + l.woPlacedQty, 0)),
    rsBalanceQty: round3(lines.reduce((s, l) => s + l.rsBalanceQty, 0)),
  };

  const workOrders = workOrdersRaw.map((wo) => {
    const pmr = wo.productionMaterialRequests?.[0] ?? null;
    const totalQty = round3(
      (wo.lines ?? []).reduce((s, line) => s + woLinePlacedQty(line), 0),
    );
    return {
      id: wo.id,
      docNo: wo.docNo ?? null,
      status: wo.status,
      createdAt: wo.createdAt?.toISOString?.() ?? wo.createdAt ?? null,
      totalQty,
      pmrId: pmr?.id ?? null,
      pmrDocNo: pmr?.docNo ?? null,
      pmrStatus: pmr?.status ?? null,
    };
  });

  const mrDocNo = materialRequirement?.docNo ?? null;
  const mrStatus = materialRequirement?.status ?? null;

  return {
    requirementSheetId: sheet.id,
    salesOrderId: sheet.salesOrderId,
    cycleId: sheet.cycleId ?? null,
    periodKey: periodKey || null,
    status: sheet.status,
    release: {
      monthlyPlanId: releasedPlan?.id ?? null,
      released,
      releasedAt: releasedPlan?.releasedAt?.toISOString?.() ?? releasedPlan?.releasedAt ?? null,
      releasedRevision: releasedPlan?.releasedRevision ?? null,
      label: releasedPlan ? buildPlanDisplayLabel(releasedPlan) : null,
    },
    totals,
    lines,
    workOrders,
    procurement: {
      status: released ? (mrStatus ?? "RELEASED") : "NOT_RELEASED",
      materialRequirementId: materialRequirement?.id ?? null,
      materialRequirementDocNo: mrDocNo,
      summaryLabel: procurementSummaryLabel({
        released,
        materialRequirementDocNo: mrDocNo,
        mrStatus,
      }),
    },
    rmPreview: {
      available: false,
      message: "RM preview will be shown after batch WO design is finalized.",
    },
  };
}

module.exports = {
  getRequirementSheetExecutionSummary,
  woLinePlacedQty,
  procurementSummaryLabel,
};
