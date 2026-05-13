/**
 * Customer-wise Sales Order + Requirement Sheet position report (NO_QTY RS columns + pipeline next action).
 */

const { prisma } = require("../utils/prisma");
const {
  loadEffectiveNoQtyCarryForwardShortfallByItem,
  getNoQtyCloseSnapshotMetaBatch,
} = require("./noQtySoCloseSnapshotService");
const { loadNoQtyPendingQcDispositionQtyByItem } = require("./noQtyPostCycleApprovalService");
const {
  customerNameForSalesOrder,
  getDispatchBacklogRows,
  getProductionQueueRows,
  getQcQueueRows,
  QUEUE_EPS,
  buildDashboardActionLabel,
} = require("./dashboardQueueSnapshots");
const { parseDateStart, parseDateEnd } = require("./soDispatchTraceReport");
const { computeNoQtyCreateNextRsEligibilityResolved } = require("./noQtyCreateNextRsEligibility");

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function dashboardNextActionRank(nextAction) {
  if (nextAction === "QC_PENDING") return 0;
  if (nextAction === "DISPATCH_PENDING") return 1;
  if (nextAction === "SALES_BILL_PENDING") return 2;
  if (nextAction === "PRODUCTION_PENDING") return 3;
  if (nextAction === "NEXT_RS_REQUIRED") return 4;
  return 99;
}

function salesOrderDisplayNo(so) {
  const d = so.docNo?.trim();
  if (d) return d;
  return `SO-${so.id}`;
}

function requirementSheetDisplayNo(sheet) {
  const d = sheet.docNo?.trim();
  if (d) return d;
  return `RS-${sheet.id}`;
}

/**
 * Latest requirement sheet for an SO + cycle: max createdAt among highest-version rows per periodKey.
 */
function pickLatestRequirementSheetFromList(sheets) {
  if (!sheets?.length) return null;
  const byPeriod = new Map();
  for (const s of sheets) {
    const pk = s.periodKey ?? "";
    const prev = byPeriod.get(pk);
    if (!prev || n(s.version) > n(prev.version)) byPeriod.set(pk, s);
  }
  let best = null;
  for (const s of byPeriod.values()) {
    if (!best || new Date(s.createdAt).getTime() > new Date(best.createdAt).getTime()) best = s;
  }
  return best;
}

function sumFgRequirementAndSuggested(sheet) {
  let req = 0;
  let sug = 0;
  for (const ln of sheet.lines || []) {
    if (ln.item?.itemType && ln.item.itemType !== "FG") continue;
    req += n(ln.requirementQty);
    sug += n(ln.suggestedWoQtySnapshot);
  }
  return { requirementQty: round3(req), suggestedWoQty: round3(sug) };
}

function buildProdBestBySo(prodRows) {
  const prodBestBySo = new Map();
  for (const r of prodRows) {
    if (r.status !== "PENDING" && r.status !== "IN_PROGRESS") continue;
    const prev = prodBestBySo.get(r.salesOrderId);
    const rank = dashboardNextActionRank(r.nextAction);
    const prevRank = prev ? dashboardNextActionRank(prev.nextAction) : 999;
    const qty = Number(r.displayQty ?? r.balanceQty ?? 0);
    const prevQty = prev ? Number(prev.displayQty ?? prev.balanceQty ?? 0) : 0;
    if (!prev || rank < prevRank || (rank === prevRank && qty > prevQty)) {
      prodBestBySo.set(r.salesOrderId, r);
    }
  }
  return prodBestBySo;
}

function buildQcBySo(qcRows) {
  const qcBySo = new Map();
  for (const r of qcRows) {
    const prev = qcBySo.get(r.salesOrderId);
    const pending = Number(r.pendingQcQty) || 0;
    if (!prev || pending > prev.pendingQcQty) qcBySo.set(r.salesOrderId, r);
  }
  return qcBySo;
}

function buildDispBySo(dispRows) {
  const dispBySo = new Map();
  for (const r of dispRows) {
    const prev = dispBySo.get(r.salesOrderId);
    const dispNow = Number(r.dispatchableNow) || 0;
    if (!prev || dispNow > prev.dispatchableNow) dispBySo.set(r.salesOrderId, r);
  }
  return dispBySo;
}

function resolveNextAction(so, { prodBestBySo, qcBySo, dispBySo }) {
  const soId = so.id;
  const qc = qcBySo.get(soId);
  const prodPick = prodBestBySo.get(soId);
  const disp = dispBySo.get(soId);
  const awaitingQcQty = qc ? Number(qc.pendingQcQty) || 0 : 0;

  if (awaitingQcQty > QUEUE_EPS) {
    return { nextActionKey: "QC_PENDING", nextActionLabel: buildDashboardActionLabel("QC_PENDING") };
  }
  if (prodPick) {
    return {
      nextActionKey: prodPick.nextAction,
      nextActionLabel: buildDashboardActionLabel(prodPick.nextAction),
    };
  }
  if (disp && Number(disp.dispatchableNow) > QUEUE_EPS) {
    return { nextActionKey: "DISPATCH_PENDING", nextActionLabel: buildDashboardActionLabel("DISPATCH_PENDING") };
  }
  if (["COMPLETED", "CLOSED", "MANUALLY_CLOSED"].includes(String(so.internalStatus))) {
    return { nextActionKey: "DONE", nextActionLabel: "Done" };
  }
  return { nextActionKey: "NONE", nextActionLabel: "—" };
}

const REPORT_LIMIT = 2000;
const MAX_OUTPUT_ROWS = 2000;

/**
 * @param {Record<string, unknown>} query
 */
async function buildCustomerSoRsReport(query) {
  const customerIdRaw = query.customerId ?? query.customer;
  const customerId =
    customerIdRaw != null && String(customerIdRaw).trim() !== "" ? Number(customerIdRaw) : null;

  const soTypeRaw = String(query.soType ?? query.orderType ?? "ALL").trim().toUpperCase();
  const soType = soTypeRaw === "NO_QTY" ? "NO_QTY" : soTypeRaw === "NORMAL" ? "NORMAL" : "ALL";

  const dateFrom = parseDateStart(query.dateFrom);
  const dateTo = parseDateEnd(query.dateTo);

  const searchQ = String(query.q ?? query.search ?? "").trim();
  const expandNoQtyCycles = Boolean(searchQ);

  /** @type {import('@prisma/client').Prisma.SalesOrderWhereInput} */
  const whereClause = {};

  if (customerId != null && Number.isFinite(customerId) && customerId > 0) {
    whereClause.customerId = customerId;
  }

  if (soType === "NORMAL") {
    whereClause.orderType = "NORMAL";
  } else if (soType === "NO_QTY") {
    whereClause.orderType = "NO_QTY";
  }

  if (dateFrom && dateTo) {
    whereClause.createdAt = { gte: dateFrom, lte: dateTo };
  } else if (dateFrom) {
    whereClause.createdAt = { gte: dateFrom };
  } else if (dateTo) {
    whereClause.createdAt = { lte: dateTo };
  }

  const statusRaw = String(query.status ?? "").trim();
  if (statusRaw && statusRaw.toUpperCase() !== "ALL") {
    whereClause.internalStatus = statusRaw;
  }

  if (searchQ) {
    const pattern = `%${searchQ}%`;
    /** @type {{ id: number }[]} */
    const idHits = await prisma.$queryRaw`
      SELECT id FROM SalesOrder
      WHERE LOWER(IFNULL(docNo, '')) LIKE LOWER(${pattern})
         OR LOWER(IFNULL(customerPoReference, '')) LIKE LOWER(${pattern})
    `;
    const ids = [...new Set(idHits.map((r) => Number(r.id)).filter((x) => Number.isFinite(x) && x > 0))];
    if (ids.length === 0) {
      return {
        meta: {
          customerId: customerId != null && customerId > 0 ? customerId : null,
          soType,
          status: statusRaw && statusRaw.toUpperCase() !== "ALL" ? statusRaw : null,
          dateFrom: dateFrom ? dateFrom.toISOString() : null,
          dateTo: dateTo ? dateTo.toISOString() : null,
          search: searchQ,
          expandNoQtyCycles: true,
          rowLimit: REPORT_LIMIT,
          maxOutputRows: MAX_OUTPUT_ROWS,
          totalRows: 0,
          rowsBuilt: 0,
          truncated: false,
        },
        rows: [],
      };
    }
    whereClause.id = { in: ids };
  }

  const [prodRows, qcRows, dispRows, salesOrders] = await Promise.all([
    getProductionQueueRows(),
    getQcQueueRows(),
    getDispatchBacklogRows(),
    prisma.salesOrder.findMany({
      where: whereClause,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: REPORT_LIMIT,
      include: {
        customer: true,
        po: { include: { customer: true } },
        currentCycle: true,
      },
    }),
  ]);

  const prodBestBySo = buildProdBestBySo(prodRows);
  const qcBySo = buildQcBySo(qcRows);
  const dispBySo = buildDispBySo(dispRows);

  /** @type {Map<number, Awaited<ReturnType<typeof computeNoQtyCreateNextRsEligibilityResolved>>>} */
  const createNextRsBySoId = new Map();
  const nqSoForElig = salesOrders.filter((s) => s.orderType === "NO_QTY");
  await Promise.all(
    nqSoForElig.map(async (s) => {
      const r = await computeNoQtyCreateNextRsEligibilityResolved(prisma, s.id);
      createNextRsBySoId.set(s.id, r);
    }),
  );

  /** @type {Map<number, import('@prisma/client').SalesOrderCycle[]>} */
  const cyclesBySoId = new Map();
  if (expandNoQtyCycles) {
    const nqIds = salesOrders.filter((s) => s.orderType === "NO_QTY").map((s) => s.id);
    if (nqIds.length) {
      const cycles = await prisma.salesOrderCycle.findMany({
        where: { salesOrderId: { in: nqIds } },
        orderBy: [{ salesOrderId: "asc" }, { cycleNo: "asc" }],
      });
      for (const c of cycles) {
        if (!cyclesBySoId.has(c.salesOrderId)) cyclesBySoId.set(c.salesOrderId, []);
        cyclesBySoId.get(c.salesOrderId).push(c);
      }
    }
  }

  /** @type {{ salesOrderId: number; cycleId: number }[]} */
  const sheetPairs = [];
  if (expandNoQtyCycles) {
    for (const so of salesOrders) {
      if (so.orderType !== "NO_QTY") continue;
      const cs = cyclesBySoId.get(so.id) || [];
      for (const c of cs) {
        sheetPairs.push({ salesOrderId: so.id, cycleId: c.id });
      }
    }
  } else {
    for (const s of salesOrders) {
      if (s.orderType === "NO_QTY" && s.currentCycleId != null) {
        sheetPairs.push({ salesOrderId: s.id, cycleId: Number(s.currentCycleId) });
      }
    }
  }

  const sheetsBySoCycle = new Map();
  if (sheetPairs.length) {
    const allSheets = await prisma.requirementSheet.findMany({
      where: {
        OR: sheetPairs.map((p) => ({ salesOrderId: p.salesOrderId, cycleId: p.cycleId })),
      },
      include: { lines: { include: { item: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    for (const sh of allSheets) {
      const k = `${sh.salesOrderId}:${Number(sh.cycleId)}`;
      if (!sheetsBySoCycle.has(k)) sheetsBySoCycle.set(k, []);
      sheetsBySoCycle.get(k).push(sh);
    }
  }

  const carryBySoCycleKey = new Map();
  /** @type {Map<string, Map<number, number>>} */
  const pendingDispBySoCycleKey = new Map();
  if (sheetPairs.length) {
    const loaded = await Promise.all(
      sheetPairs.map(async (p) => {
        const k = `${p.salesOrderId}:${p.cycleId}`;
        const [{ shortfallByItem: m }, pend] = await Promise.all([
          loadEffectiveNoQtyCarryForwardShortfallByItem(prisma, {
            salesOrderId: p.salesOrderId,
            currentCycleId: p.cycleId,
          }),
          loadNoQtyPendingQcDispositionQtyByItem(prisma, p.salesOrderId, p.cycleId),
        ]);
        return { k, m, pend };
      }),
    );
    for (const { k, m, pend } of loaded) {
      carryBySoCycleKey.set(k, m);
      pendingDispBySoCycleKey.set(k, pend);
    }
  }

  const rows = [];

  const snapMetaBySoId = await getNoQtyCloseSnapshotMetaBatch(
    prisma,
    salesOrders.filter((s) => s.orderType === "NO_QTY").map((s) => s.id),
  );

  for (const so of salesOrders) {
    const customerName = customerNameForSalesOrder(so);
    const { nextActionKey, nextActionLabel } = resolveNextAction(so, { prodBestBySo, qcBySo, dispBySo });

    if (so.orderType !== "NO_QTY") {
      rows.push({
        customerName,
        salesOrderId: so.id,
        salesOrderNo: salesOrderDisplayNo(so),
        salesOrderType: so.orderType,
        salesOrderDate: so.createdAt.toISOString(),
        currentCycleId: null,
        currentCycleLabel: null,
        requirementSheetId: null,
        requirementSheetNo: null,
        requirementSheetStatus: null,
        requirementQty: null,
        suggestedWoQty: null,
        lockedAt: null,
        lastShortageQty: null,
        lastShortageQtyLabel: null,
        nextActionKey,
        nextActionLabel,
      });
      continue;
    }

    function pushNoQtyRow(cycleId, cycleLabel) {
      let requirementSheetId = null;
      let requirementSheetNo = null;
      let requirementSheetStatus = null;
      let requirementQty = null;
      let suggestedWoQty = null;
      let lockedAt = null;
      let lastShortageQty = null;
      /** @type {string | null} */
      let lastShortageQtyLabel = null;
      let activeCarryForwardQty = null;

      const snapMeta = snapMetaBySoId.get(so.id);

      if (cycleId != null && Number.isFinite(cycleId) && cycleId > 0) {
        const k = `${so.id}:${cycleId}`;
        const list = sheetsBySoCycle.get(k) || [];
        const sheet = pickLatestRequirementSheetFromList(list);
        if (sheet) {
          requirementSheetId = sheet.id;
          requirementSheetNo = requirementSheetDisplayNo(sheet);
          requirementSheetStatus = sheet.status;
          const sums = sumFgRequirementAndSuggested(sheet);
          requirementQty = sums.requirementQty;
          suggestedWoQty = sums.suggestedWoQty;
          lockedAt = sheet.status === "LOCKED" ? sheet.updatedAt.toISOString() : null;
        }
        const cfMap = carryBySoCycleKey.get(k);
        let ls = 0;
        if (cfMap) {
          for (const [, v] of cfMap) {
            ls += n(v.rawShortfall);
          }
        }
        lastShortageQty = round3(ls);
        activeCarryForwardQty = round3(ls);
        const pm = pendingDispBySoCycleKey.get(k);
        let pendingSum = 0;
        if (pm) for (const v of pm.values()) pendingSum += n(v);
        if (n(lastShortageQty) > QUEUE_EPS && pendingSum > QUEUE_EPS && n(lastShortageQty) <= pendingSum + QUEUE_EPS) {
          lastShortageQtyLabel = "Pending QC Disposition Qty";
        }
      }

      rows.push({
        customerName,
        salesOrderId: so.id,
        salesOrderNo: salesOrderDisplayNo(so),
        salesOrderType: so.orderType,
        salesOrderDate: so.createdAt.toISOString(),
        currentCycleId: cycleId,
        currentCycleLabel: cycleLabel,
        requirementSheetId,
        requirementSheetNo,
        requirementSheetStatus,
        requirementQty,
        suggestedWoQty,
        lockedAt,
        lastShortageQty,
        lastShortageQtyLabel,
        closedShortageQty: snapMeta?.closedShortageQty ?? 0,
        activeCarryForwardQty,
        reopenMode: snapMeta?.reopenMode ?? null,
        nextActionKey,
        nextActionLabel,
      });
    }

    if (expandNoQtyCycles) {
      const cyclesList = cyclesBySoId.get(so.id) || [];
      if (cyclesList.length === 0) {
        pushNoQtyRow(null, null);
      } else {
        for (const cyc of cyclesList) {
          pushNoQtyRow(cyc.id, `Cycle ${cyc.cycleNo}`);
        }
      }
    } else {
      const cycleId = so.currentCycleId != null ? Number(so.currentCycleId) : null;
      const currentCycleLabel =
        so.currentCycle ? `Cycle ${so.currentCycle.cycleNo}` : cycleId ? `Cycle #${cycleId}` : null;
      pushNoQtyRow(cycleId, currentCycleLabel);
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.salesOrderType !== "NO_QTY") continue;
    const so = salesOrders.find((x) => x.id === row.salesOrderId);
    if (!so || so.currentCycleId == null) continue;
    const cur = Number(so.currentCycleId);
    if (!Number.isFinite(cur) || cur <= 0) continue;
    if (row.currentCycleId == null || Number(row.currentCycleId) !== cur) continue;
    const el = createNextRsBySoId.get(so.id);
    if (
      el?.eligible &&
      !["MANUALLY_CLOSED", "CLOSED", "COMPLETED"].includes(String(so.internalStatus ?? ""))
    ) {
      rows[i] = {
        ...row,
        nextActionKey: "CREATE_NEXT_RS",
        nextActionLabel: "Create Next RS",
      };
    }
  }

  const rowsBuilt = rows.length;
  const sliced = rows.slice(0, MAX_OUTPUT_ROWS);

  return {
    meta: {
      customerId: customerId != null && customerId > 0 ? customerId : null,
      soType,
      status: statusRaw && statusRaw.toUpperCase() !== "ALL" ? statusRaw : null,
      dateFrom: dateFrom ? dateFrom.toISOString() : null,
      dateTo: dateTo ? dateTo.toISOString() : null,
      search: searchQ || null,
      expandNoQtyCycles,
      rowLimit: REPORT_LIMIT,
      maxOutputRows: MAX_OUTPUT_ROWS,
      totalRows: sliced.length,
      rowsBuilt,
      truncated: rowsBuilt > MAX_OUTPUT_ROWS,
    },
    rows: sliced,
  };
}

module.exports = { buildCustomerSoRsReport };
