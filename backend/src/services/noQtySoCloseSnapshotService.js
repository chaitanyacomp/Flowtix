/**
 * NO_QTY manual SO close: freeze carry-forward shortage as demand-only snapshots (no stock movement).
 */

const EPS = 1e-9;

const SNAPSHOT_STATUS = {
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED",
  REOPENED_CONTINUE: "REOPENED_CONTINUE",
  REOPENED_IGNORED: "REOPENED_IGNORED",
};

const REOPEN_MODE = {
  CONTINUE_SHORTAGE: "CONTINUE_SHORTAGE",
  IGNORE_SHORTAGE: "IGNORE_SHORTAGE",
};

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function loadRequirementSheetsModule() {
  return require("../routes/requirementSheets");
}

/**
 * Closed-line shortage = **locked RS gross - approved produced qty** for the relevant cycle (same as carry-forward
 * `rawShortfall` / last shortage), not net of QC, post-cycle, scrap, or disposition.
 *
 * @returns {Promise<Array<{ itemId: number; closedShortageQty: number; cycleIdAtClose: number | null; cycleNoAtClose: number | null }>>}
 */
async function computeNoQtyClosedShortageSnapshot(tx, salesOrderId) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return [];

  const so = await tx.salesOrder.findUnique({
    where: { id: soId },
    select: { orderType: true, currentCycleId: true },
  });
  if (!so || so.orderType !== "NO_QTY") return [];

  const curCid = so.currentCycleId != null ? Number(so.currentCycleId) : null;

  const { loadNoQtyCarryForwardShortfallByItem, plannedNewRequirementAndQcAcceptedByItemForSingleCycle } =
    loadRequirementSheetsModule();

  if (curCid && Number.isFinite(curCid) && curCid > 0) {
    const { shortfallByItem } = await loadNoQtyCarryForwardShortfallByItem({
      salesOrderId: soId,
      currentCycleId: curCid,
    });
    const cyc = await tx.salesOrderCycle.findUnique({
      where: { id: curCid },
      select: { id: true, cycleNo: true },
    });
    const cycleIdAtClose = cyc?.id ?? curCid;
    const cycleNoAtClose = cyc?.cycleNo != null ? Number(cyc.cycleNo) : null;
    const out = [];
    for (const [itemId, v] of shortfallByItem) {
      const q = round3(n(v?.rawShortfall));
      if (q > EPS) {
        out.push({
          itemId: Number(itemId),
          closedShortageQty: q,
          cycleIdAtClose,
          cycleNoAtClose,
        });
      }
    }
    return out;
  }

  const latestClosed = await tx.salesOrderCycle.findFirst({
    where: { salesOrderId: soId, status: "CLOSED" },
    orderBy: { cycleNo: "desc" },
    select: { id: true, cycleNo: true },
  });
  if (!latestClosed?.id) return [];

  const m = await plannedNewRequirementAndQcAcceptedByItemForSingleCycle(soId, Number(latestClosed.id));
  const out = [];
  for (const [itemId, v] of m) {
    const short = Math.max(0, round3(n(v.planned) - n(v.qcAccepted)));
    if (short > EPS) {
      out.push({
        itemId: Number(itemId),
        closedShortageQty: short,
        cycleIdAtClose: Number(latestClosed.id),
        cycleNoAtClose: latestClosed.cycleNo != null ? Number(latestClosed.cycleNo) : null,
      });
    }
  }
  return out;
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ salesOrderId: number; userId: number | null; reason: string | null }} input
 */
async function createNoQtyCloseSnapshot(tx, { salesOrderId, userId, reason }) {
  const soId = Number(salesOrderId);
  const linesRaw = await computeNoQtyClosedShortageSnapshot(tx, soId);
  const agg = await tx.noQtySoCloseSnapshot.aggregate({
    where: { salesOrderId: soId },
    _max: { closeVersion: true },
  });
  const nextVer = Number(agg._max.closeVersion ?? 0) + 1;

  await tx.noQtySoCloseSnapshot.updateMany({
    where: { salesOrderId: soId, status: SNAPSHOT_STATUS.ACTIVE },
    data: { status: SNAPSHOT_STATUS.ARCHIVED },
  });

  const snap = await tx.noQtySoCloseSnapshot.create({
    data: {
      salesOrderId: soId,
      closeVersion: nextVer,
      closedByUserId: userId != null && Number.isFinite(Number(userId)) && Number(userId) > 0 ? Number(userId) : null,
      reason: reason?.trim() || null,
      status: SNAPSHOT_STATUS.ACTIVE,
    },
  });

  for (const ln of linesRaw) {
    await tx.noQtySoClosedShortageLine.create({
      data: {
        snapshotId: snap.id,
        salesOrderId: soId,
        itemId: ln.itemId,
        cycleIdAtClose: ln.cycleIdAtClose,
        cycleNoAtClose: ln.cycleNoAtClose,
        closedShortageQty: String(round3(ln.closedShortageQty)),
      },
    });
  }

  return { snapshot: snap, lines: linesRaw };
}

/**
 * Latest snapshot by closeVersion (includes ACTIVE and reopened rows).
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 */
async function getLatestNoQtyCloseSnapshot(db, salesOrderId) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return null;
  return db.noQtySoCloseSnapshot.findFirst({
    where: { salesOrderId: soId },
    orderBy: { closeVersion: "desc" },
    include: { lines: true },
  });
}

/** @deprecated name — use getLatestNoQtyCloseSnapshot */
async function getLatestActiveNoQtyCloseSnapshot(tx, salesOrderId) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return null;
  return tx.noQtySoCloseSnapshot.findFirst({
    where: { salesOrderId: soId, status: SNAPSHOT_STATUS.ACTIVE },
    orderBy: [{ closedAt: "desc" }, { closeVersion: "desc" }],
    include: { lines: true },
  });
}

/**
 * Reopens the latest ACTIVE snapshot only; archives any stray ACTIVE rows after update.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ salesOrderId: number; mode: string; userId: number | null }} input
 */
async function markSnapshotReopened(tx, { salesOrderId, mode, userId }) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return null;

  const snap = await getLatestActiveNoQtyCloseSnapshot(tx, soId);
  if (!snap) return null;

  const status =
    mode === REOPEN_MODE.IGNORE_SHORTAGE
      ? SNAPSHOT_STATUS.REOPENED_IGNORED
      : SNAPSHOT_STATUS.REOPENED_CONTINUE;

  const updated = await tx.noQtySoCloseSnapshot.update({
    where: { id: snap.id },
    data: {
      reopenMode: mode,
      reopenedAt: new Date(),
      reopenedByUserId:
        userId != null && Number.isFinite(Number(userId)) && Number(userId) > 0 ? Number(userId) : null,
      status,
    },
  });

  await tx.noQtySoCloseSnapshot.updateMany({
    where: { salesOrderId: soId, status: SNAPSHOT_STATUS.ACTIVE },
    data: { status: SNAPSHOT_STATUS.ARCHIVED },
  });

  return updated;
}

function shortfallMapsFromSnapshotLines(lines) {
  /** @type {Map<number, { rawShortfall: number; planned: number; produced: number }>} */
  const shortfallByItem = new Map();
  /** @type {Map<number, Array<{ cycleNo: number; cycleId: number; planned: number; qc: number; shortage: number }>>} */
  const carryForwardBreakdownByItem = new Map();
  for (const ln of lines || []) {
    const itemId = Number(ln.itemId);
    const raw = round3(n(ln.closedShortageQty));
    if (!(raw > EPS)) continue;
    shortfallByItem.set(itemId, {
      rawShortfall: raw,
      planned: raw,
      produced: 0,
    });
    carryForwardBreakdownByItem.set(itemId, [
      {
        cycleNo: ln.cycleNoAtClose != null ? Number(ln.cycleNoAtClose) : 0,
        cycleId: ln.cycleIdAtClose != null ? Number(ln.cycleIdAtClose) : 0,
        planned: raw,
        qc: 0,
        shortage: raw,
      },
    ]);
  }
  return { shortfallByItem, carryForwardBreakdownByItem };
}

function sumRawShortfall(shortfallByItem) {
  let s = 0;
  for (const [, v] of shortfallByItem) s += n(v?.rawShortfall);
  return round3(s);
}

/**
 * Effective carry-forward for planning/dashboards: respects SO close + reopen snapshot modes.
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {{ salesOrderId: number; currentCycleId: number | null }} input
 * @returns {Promise<{ shortfallByItem: Map<number, { rawShortfall: number; planned: number; produced: number }>; carryForwardBreakdownByItem: Map<number, any> }>}
 */
async function loadEffectiveNoQtyCarryForwardShortfallByItem(db, input) {
  const salesOrderId = Number(input?.salesOrderId);
  const currentCycleId = input?.currentCycleId != null ? Number(input.currentCycleId) : null;
  const empty = () => ({
    shortfallByItem: new Map(),
    carryForwardBreakdownByItem: new Map(),
  });

  if (!Number.isFinite(salesOrderId) || salesOrderId <= 0) return empty();

  const so = await db.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: { orderType: true, internalStatus: true },
  });
  if (!so || so.orderType !== "NO_QTY") {
    const { loadNoQtyCarryForwardShortfallByItem } = loadRequirementSheetsModule();
    return loadNoQtyCarryForwardShortfallByItem({
      salesOrderId,
      currentCycleId: Number.isFinite(currentCycleId) && currentCycleId > 0 ? currentCycleId : null,
    });
  }

  const st = String(so.internalStatus ?? "");
  if (st === "MANUALLY_CLOSED" || st === "CLOSED" || st === "COMPLETED") {
    return empty();
  }

  const latest = await getLatestNoQtyCloseSnapshot(db, salesOrderId);
  if (latest?.status === SNAPSHOT_STATUS.REOPENED_IGNORED) {
    return empty();
  }
  if (latest?.status === SNAPSHOT_STATUS.REOPENED_CONTINUE && Array.isArray(latest.lines)) {
    return shortfallMapsFromSnapshotLines(latest.lines);
  }

  const { loadNoQtyCarryForwardShortfallByItem } = loadRequirementSheetsModule();
  return loadNoQtyCarryForwardShortfallByItem({
    salesOrderId,
    currentCycleId: Number.isFinite(currentCycleId) && currentCycleId > 0 ? currentCycleId : null,
  });
}

/**
 * Closed shortage total from latest snapshot lines (historical; includes ACTIVE and reopened snapshots).
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 */
async function sumClosedShortageFromLatestSnapshot(db, salesOrderId) {
  const latest = await getLatestNoQtyCloseSnapshot(db, salesOrderId);
  if (!latest?.lines?.length) return 0;
  let s = 0;
  for (const ln of latest.lines) s += n(ln.closedShortageQty);
  return round3(s);
}

/**
 * Latest snapshot per SO (max closeVersion) with meta for reports.
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number[]} salesOrderIds
 * @returns {Promise<Map<number, { closedShortageQty: number; reopenMode: string | null }>>}
 */
async function getNoQtyCloseSnapshotMetaBatch(db, salesOrderIds) {
  const ids = [...new Set((salesOrderIds || []).map(Number).filter((x) => Number.isFinite(x) && x > 0))];
  /** @type {Map<number, { closedShortageQty: number; reopenMode: string | null }>} */
  const out = new Map();
  if (!ids.length) return out;

  const snaps = await db.noQtySoCloseSnapshot.findMany({
    where: { salesOrderId: { in: ids } },
    include: { lines: true },
    orderBy: [{ salesOrderId: "asc" }, { closeVersion: "desc" }],
  });
  /** @type {Map<number, typeof snaps[0]>} */
  const latestBySo = new Map();
  for (const s of snaps) {
    if (!latestBySo.has(s.salesOrderId)) latestBySo.set(s.salesOrderId, s);
  }
  for (const soId of ids) {
    const sn = latestBySo.get(soId);
    if (!sn) {
      out.set(soId, { closedShortageQty: 0, reopenMode: null });
      continue;
    }
    let sum = 0;
    for (const ln of sn.lines || []) sum += n(ln.closedShortageQty);
    out.set(soId, {
      closedShortageQty: round3(sum),
      reopenMode: sn.reopenMode ? String(sn.reopenMode) : null,
    });
  }
  return out;
}

module.exports = {
  SNAPSHOT_STATUS,
  REOPEN_MODE,
  computeNoQtyClosedShortageSnapshot,
  createNoQtyCloseSnapshot,
  getLatestNoQtyCloseSnapshot,
  getLatestActiveNoQtyCloseSnapshot,
  markSnapshotReopened,
  loadEffectiveNoQtyCarryForwardShortfallByItem,
  shortfallMapsFromSnapshotLines,
  sumRawShortfall,
  sumClosedShortageFromLatestSnapshot,
  getNoQtyCloseSnapshotMetaBatch,
};
