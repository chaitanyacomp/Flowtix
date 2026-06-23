/**
 * P11-A16 — Store-safe NO_QTY planning inbox (no commercial SO list access required).
 */
const { prisma } = require("../utils/prisma");
const { getActiveNoQtySalesOrders } = require("./dashboardQueueSnapshots");
const { enrichSalesOrdersWithProcessStage } = require("./salesOrderProcessStage");
const { enrichSalesOrderWithDispatchStats } = require("./salesOrderDispatchHelpers");
const { resolveNoQtyWorkflowState } = require("./noQtyWorkflowEngine");
const { qtyToNumber } = require("./rmPurchaseHelpers");

const CLOSED_SO_STATUSES = Object.freeze(["COMPLETED", "CLOSED", "MANUALLY_CLOSED"]);

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

function resolveRsStatus(sheets, cycleId) {
  if (!Array.isArray(sheets) || sheets.length === 0) return "No RS";
  const cid = cycleId != null && Number.isFinite(Number(cycleId)) && Number(cycleId) > 0 ? Number(cycleId) : null;
  const scoped = cid != null ? sheets.filter((s) => Number(s.cycleId ?? 0) === cid) : sheets;
  const pool = scoped.length > 0 ? scoped : sheets;
  const sorted = [...pool].sort((a, b) => {
    const va = Number(a.version ?? 1);
    const vb = Number(b.version ?? 1);
    if (vb !== va) return vb - va;
    return Number(b.id) - Number(a.id);
  });
  const top = sorted[0];
  if (!top) return "No RS";
  const st = String(top.status ?? "").toUpperCase();
  if (st === "LOCKED") return "Locked";
  if (st === "DRAFT") return "Draft";
  if (st === "CANCELLED") return "Cancelled";
  return st || "—";
}

function resolveLockedPeriodKey(sheets, cycleId) {
  if (!Array.isArray(sheets) || sheets.length === 0) return null;
  const cid = cycleId != null && Number.isFinite(Number(cycleId)) && Number(cycleId) > 0 ? Number(cycleId) : null;
  const scoped = cid != null ? sheets.filter((s) => Number(s.cycleId ?? 0) === cid) : sheets;
  const pool = scoped.length > 0 ? scoped : sheets;
  const locked = pool.filter((s) => String(s.status ?? "").toUpperCase() === "LOCKED");
  const sorted = [...(locked.length > 0 ? locked : pool)].sort((a, b) => {
    const va = Number(a.version ?? 1);
    const vb = Number(b.version ?? 1);
    if (vb !== va) return vb - va;
    return Number(b.id) - Number(a.id);
  });
  const pk = String(sorted[0]?.periodKey ?? "").trim();
  return pk || null;
}

function inboxAttentionScore(row) {
  let score = 0;
  if (row.so?.noQtyCreateNextRsEligible) score += 100;
  if (row.rsStatus === "Draft") score += 80;
  if (row.rsStatus === "No RS") score += 70;
  if (row.rsStatus === "Cancelled") score += 60;
  if (String(row.so?.noQtyNextActionLabel ?? "").trim()) score += 10;
  return score;
}

function sortInboxRows(rows) {
  return [...rows].sort((a, b) => {
    const ds = inboxAttentionScore(b) - inboxAttentionScore(a);
    if (ds !== 0) return ds;
    const ca = a.cycleNo ?? a.so?.noQtyActualActiveCycleNo ?? 0;
    const cb = b.cycleNo ?? b.so?.noQtyActualActiveCycleNo ?? 0;
    if (cb !== ca) return Number(cb) - Number(ca);
    return Number(b.salesOrderId) - Number(a.salesOrderId);
  });
}

function buildRequirementSheetHref(salesOrderId, { sheetId, cycleId, focusExecution = false } = {}) {
  const params = new URLSearchParams();
  params.set("source", "no_qty_so");
  params.set("salesOrderId", String(salesOrderId));
  if (sheetId != null && Number(sheetId) > 0) params.set("sheetId", String(sheetId));
  if (cycleId != null && Number(cycleId) > 0) params.set("cycleId", String(cycleId));
  if (focusExecution) params.set("focus", "execution");
  const qs = params.toString();
  return qs
    ? `/sales-orders/${salesOrderId}/requirement-sheets?${qs}`
    : `/sales-orders/${salesOrderId}/requirement-sheets`;
}

async function sumOpenExecutionBalanceForSo(db, salesOrderId) {
  const lockedSheets = await db.requirementSheet.findMany({
    where: { salesOrderId, status: "LOCKED" },
    select: {
      id: true,
      lines: { select: { itemId: true, requirementQty: true } },
      workOrders: {
        where: { status: { not: "REJECTED" } },
        select: { lines: { select: { fgItemId: true, qty: true, plannedQty: true } } },
      },
    },
  });
  let total = 0;
  for (const sheet of lockedSheets) {
    const placedByItem = new Map();
    for (const wo of sheet.workOrders ?? []) {
      for (const ln of wo.lines ?? []) {
        const fgItemId = Number(ln.fgItemId);
        const q = qtyToNumber(ln.qty ?? ln.plannedQty);
        if (!Number.isFinite(fgItemId) || fgItemId <= 0 || !Number.isFinite(q) || q <= 0) continue;
        placedByItem.set(fgItemId, round3((placedByItem.get(fgItemId) ?? 0) + q));
      }
    }
    for (const ln of sheet.lines ?? []) {
      const itemId = Number(ln.itemId);
      const demand = qtyToNumber(ln.requirementQty);
      if (!Number.isFinite(itemId) || itemId <= 0 || !Number.isFinite(demand) || demand <= 0) continue;
      const placed = placedByItem.get(itemId) ?? 0;
      total += Math.max(0, demand - placed);
    }
  }
  return round3(total);
}

function pendingPlanningActionLabel(flowState) {
  const label = String(flowState?.actionLabel ?? flowState?.displaySummary ?? "").trim();
  if (label) return label;
  const action = String(flowState?.primaryAction ?? flowState?.nextAction ?? "").trim();
  if (action === "NEXT_RS") return "Create next RS";
  if (action === "REQUIREMENT") return "Requirement";
  if (action === "WORK_ORDER") return "Place WO";
  return null;
}

/**
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} [db]
 * @param {{ limit?: number, userRole?: string | null }} [options]
 */
async function getNoQtyPlanningInbox(db = prisma, options = {}) {
  const limitRaw = Number(options.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(50, Math.max(1, Math.floor(limitRaw))) : 50;
  const userRole = options.userRole ?? null;

  const sos = await db.salesOrder.findMany({
    where: {
      orderType: "NO_QTY",
      internalStatus: { notIn: [...CLOSED_SO_STATUSES] },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
    include: {
      customer: { select: { name: true } },
      po: { include: { customer: { select: { name: true } } } },
      currentCycle: { select: { id: true, cycleNo: true, status: true } },
    },
  });

  if (!sos.length) return [];

  const soIds = sos.map((s) => s.id);
  const [stagedRows, activeMetaRows, allSheets] = await Promise.all([
    enrichSalesOrdersWithProcessStage(
      db,
      sos.map((s) => enrichSalesOrderWithDispatchStats(s)),
    ),
    getActiveNoQtySalesOrders({ limit }),
    db.requirementSheet.findMany({
      where: { salesOrderId: { in: soIds } },
      select: {
        id: true,
        docNo: true,
        periodKey: true,
        cycleId: true,
        version: true,
        status: true,
        salesOrderId: true,
      },
      orderBy: [{ periodKey: "desc" }, { version: "desc" }, { id: "desc" }],
    }),
  ]);

  const stagedById = new Map(stagedRows.map((s) => [s.id, s]));
  const activeBySoId = new Map(activeMetaRows.map((r) => [r.salesOrderId, r]));
  const sheetsBySoId = new Map();
  for (const sh of allSheets) {
    const sid = sh.salesOrderId;
    const arr = sheetsBySoId.get(sid) ?? [];
    arr.push(sh);
    sheetsBySoId.set(sid, arr);
  }

  const balanceBySoId = new Map();
  await Promise.all(
    soIds.map(async (sid) => {
      balanceBySoId.set(sid, await sumOpenExecutionBalanceForSo(db, sid));
    }),
  );

  const rows = await Promise.all(
    sos.map(async (so) => {
      const staged = stagedById.get(so.id) ?? so;
      const meta = activeBySoId.get(so.id) ?? {};
      const sheets = sheetsBySoId.get(so.id) ?? [];
      const guidedCycleId =
        meta.cycleId != null && Number(meta.cycleId) > 0
          ? Number(meta.cycleId)
          : so.currentCycle?.id != null
            ? Number(so.currentCycle.id)
            : null;
      const cycleNo =
        meta.cycleNo != null && Number.isFinite(Number(meta.cycleNo))
          ? Number(meta.cycleNo)
          : so.currentCycle?.cycleNo != null
            ? Number(so.currentCycle.cycleNo)
            : null;
      const rsStatus = resolveRsStatus(sheets, guidedCycleId);
      const lockedPeriodKey = resolveLockedPeriodKey(sheets, guidedCycleId);
      const latestSheet =
        sheets.find((s) => s.id === meta.latestRequirementSheetId) ??
        sheets.find((s) => Number(s.cycleId ?? 0) === Number(guidedCycleId ?? 0)) ??
        sheets[0] ??
        null;

      const flowState = await resolveNoQtyWorkflowState(db, {
        salesOrderId: so.id,
        cycleId: guidedCycleId,
        userRole,
      });

      const openExecutionBalanceQty = balanceBySoId.get(so.id) ?? 0;
      const focusExecution = rsStatus === "Locked" && openExecutionBalanceQty > 0;
      const requirementSheetHref = buildRequirementSheetHref(so.id, {
        sheetId: latestSheet?.id ?? meta.latestRequirementSheetId ?? null,
        cycleId: guidedCycleId,
        focusExecution,
      });

      const soSummary = {
        id: so.id,
        docNo: so.docNo ?? null,
        internalStatus: so.internalStatus ?? null,
        customer: so.customer ? { name: so.customer.name ?? null } : null,
        po: so.po ? { customer: so.po.customer ? { name: so.po.customer.name ?? null } : null } : null,
        processStage: staged.processStage ?? null,
        noQtyListPositionLabel:
          cycleNo != null && Number.isFinite(cycleNo) && cycleNo > 0 ? `Cycle ${cycleNo}` : null,
        noQtyActualActiveCycleNo: cycleNo,
        noQtyGuidedCycleId: guidedCycleId,
        noQtyCreateNextRsEligible: Boolean(flowState?.createNextRsEligible),
        noQtyCreateNextRsBlockReason: flowState?.createNextRsBlockReason ?? null,
        noQtyCreateNextRsBlockingPmrDocNo: flowState?.createNextRsBlockingPmrDocNo ?? null,
        noQtyNextRsAlreadyCreatedDocNo: flowState?.nextRsAlreadyCreatedDocNo ?? null,
        noQtyNextPossibleCycleNo: cycleNo != null && Number.isFinite(cycleNo) ? cycleNo + 1 : null,
        hasCurrentCycleRequirementSheet:
          guidedCycleId != null
            ? sheets.some((s) => Number(s.cycleId ?? 0) === Number(guidedCycleId))
            : sheets.length > 0,
        noQtyNextActionLabel: staged.noQtyNextActionLabel ?? flowState?.actionLabel ?? null,
        currentCycle: so.currentCycle
          ? {
              id: so.currentCycle.id,
              cycleNo: so.currentCycle.cycleNo,
              status: so.currentCycle.status ?? null,
            }
          : null,
        noQtyReadyToPlaceWo: Boolean(flowState?.readyToPlaceWo),
        noQtyPlacementRequirementSheetId:
          meta.latestRequirementSheetId != null ? Number(meta.latestRequirementSheetId) : latestSheet?.id ?? null,
      };

      return {
        salesOrderId: so.id,
        soNumber: so.docNo ?? null,
        customerName:
          so.customer?.name?.trim() ||
          so.po?.customer?.name?.trim() ||
          null,
        currentCycleNo: cycleNo,
        activeCycleId: guidedCycleId,
        latestRsId: latestSheet?.id ?? meta.latestRequirementSheetId ?? null,
        latestRsNo: latestSheet?.docNo ?? meta.latestRequirementSheetDocNo ?? null,
        latestRsStatus: latestSheet?.status ?? meta.latestRequirementSheetStatus ?? null,
        rsStatus,
        lockedPeriodKey,
        pendingPlanningAction: pendingPlanningActionLabel(flowState),
        openExecutionBalanceQty,
        requirementSheetHref,
        so: soSummary,
        flowState,
        guidedCycleId,
        cycleNo,
      };
    }),
  );

  return sortInboxRows(rows);
}

module.exports = {
  getNoQtyPlanningInbox,
  buildRequirementSheetHref,
  resolveRsStatus,
  resolveLockedPeriodKey,
  sumOpenExecutionBalanceForSo,
};
