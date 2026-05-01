const dotenv = require("dotenv");

dotenv.config();

const { prisma } = require("../src/utils/prisma");

function num(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

async function main() {
  const soDoc = "SO-26-0004";

  const so = await prisma.salesOrder.findFirst({
    where: { OR: [{ docNo: { equals: soDoc } }, { docNo: { contains: soDoc } }] },
    include: { lines: { include: { item: true } }, dispatch: true },
  });

  if (!so) {
    // eslint-disable-next-line no-console
    console.log("NOT_FOUND salesOrder docNo", soDoc);
    return;
  }

  // eslint-disable-next-line no-console
  console.log("SALES_ORDER", {
    id: so.id,
    docNo: so.docNo,
    orderType: so.orderType,
    internalStatus: so.internalStatus,
    currentCycleId: so.currentCycleId,
  });

  const cycle = await prisma.salesOrderCycle.findFirst({
    where: { salesOrderId: so.id, status: "ACTIVE" },
    select: { id: true, cycleNo: true, status: true },
  });
  // eslint-disable-next-line no-console
  console.log("ACTIVE_CYCLE", cycle);

  const cycleId = cycle?.id ?? (so.currentCycleId || null);
  if (!cycleId) {
    // eslint-disable-next-line no-console
    console.log("NO_ACTIVE_CYCLE");
    return;
  }

  const locked = await prisma.requirementSheet.findFirst({
    where: { salesOrderId: so.id, cycleId, status: "LOCKED" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { lines: { include: { item: true } } },
  });

  // eslint-disable-next-line no-console
  console.log(
    "LOCKED_RS",
    locked
      ? { id: locked.id, createdAt: locked.createdAt, status: locked.status, cycleId: locked.cycleId }
      : null,
  );

  const fgLines = (locked?.lines || []).filter((l) => l.item?.itemType === "FG");
  const rsLines = fgLines.map((l) => ({
    rsLineId: l.id,
    itemId: l.itemId,
    itemName: l.item?.itemName || null,
    requirementQty: num(l.requirementQty || 0),
    suggestedWoQtySnapshot: num(l.suggestedWoQtySnapshot || 0),
    cycleCap: Math.max(num(l.suggestedWoQtySnapshot || 0), num(l.requirementQty || 0)),
  }));
  // eslint-disable-next-line no-console
  console.log("LOCKED_RS_FG_LINES", rsLines);

  const itemIds = rsLines.map((x) => x.itemId);

  // USABLE stock proof: net USABLE per itemId (same grouping as dispatch route).
  const usableGroup = await prisma.stockTransaction.groupBy({
    by: ["itemId"],
    where: { itemId: { in: itemIds }, stockBucket: "USABLE" },
    _sum: { qtyIn: true, qtyOut: true },
  });
  const usableByItem = new Map(
    usableGroup.map((r) => [r.itemId, num(r._sum.qtyIn ?? 0) - num(r._sum.qtyOut ?? 0)]),
  );
  // eslint-disable-next-line no-console
  console.log("USABLE_NET_BY_ITEM", Object.fromEntries([...usableByItem.entries()]));

  // Cycle-scoped usable stock (new NO_QTY logic): QC accepted in cycle (+ recheck accepted in cycle) - dispatched in cycle.
  const qcRows = await prisma.qcEntry.findMany({
    where: {
      reversedAt: null,
      production: {
        workOrderLine: {
          workOrder: { salesOrderId: so.id, cycleId },
        },
      },
    },
    select: {
      acceptedQty: true,
      production: { select: { workOrderLine: { select: { fgItemId: true } } } },
    },
  });
  const qcAcceptedByItem = new Map();
  for (const r of qcRows) {
    const itemId = r.production?.workOrderLine?.fgItemId;
    if (!itemId) continue;
    qcAcceptedByItem.set(itemId, (qcAcceptedByItem.get(itemId) || 0) + num(r.acceptedQty));
  }
  // Recheck accepted: BUCKET_TRANSFER into USABLE with refId = dispositionId; attribute cycle via disposition.workOrder.cycleId
  const recheckTxns = await prisma.stockTransaction.findMany({
    where: { transactionType: "BUCKET_TRANSFER", stockBucket: "USABLE", refId: { gt: 0 }, qtyIn: { gt: 0 } },
    orderBy: { id: "desc" },
    take: 5000,
    select: { refId: true, itemId: true, qtyIn: true },
  });
  const dispIds = [...new Set(recheckTxns.map((t) => Number(t.refId)).filter((x) => Number.isFinite(x) && x > 0))];
  const disps = dispIds.length
    ? await prisma.qcRejectedDisposition.findMany({
        where: { id: { in: dispIds }, voidedAt: null },
        select: { id: true, itemId: true, workOrder: { select: { salesOrderId: true, cycleId: true } } },
      })
    : [];
  const dispById = new Map(disps.map((d) => [Number(d.id), d]));
  const recheckAcceptedByItem = new Map();
  for (const t of recheckTxns) {
    const d = dispById.get(Number(t.refId));
    if (!d) continue;
    if (Number(d.workOrder?.salesOrderId) !== Number(so.id)) continue;
    if (Number(d.workOrder?.cycleId) !== Number(cycleId)) continue;
    const itemId = Number(d.itemId ?? t.itemId);
    recheckAcceptedByItem.set(itemId, (recheckAcceptedByItem.get(itemId) || 0) + num(t.qtyIn));
  }
  // eslint-disable-next-line no-console
  console.log("CYCLE_QC_ACCEPTED_BY_ITEM", Object.fromEntries([...qcAcceptedByItem.entries()]));
  // eslint-disable-next-line no-console
  console.log("CYCLE_RECHECK_ACCEPTED_BY_ITEM", Object.fromEntries([...recheckAcceptedByItem.entries()]));

  // Dispatch rows (operational net) in active cycle only.
  const cycleDispatch = (so.dispatch || []).filter((d) => Number(d.cycleId || 0) === Number(cycleId));
  const netByItem = new Map();
  for (const d of cycleDispatch) {
    const itemId = Number(d.itemId);
    if (!Number.isFinite(itemId)) continue;
    const q = num(d.dispatchedQty);
    const sign = d.reversalOfId != null ? -1 : 1;
    netByItem.set(itemId, (netByItem.get(itemId) || 0) + sign * Math.abs(q));
  }
  // eslint-disable-next-line no-console
  console.log(
    "CYCLE_DISPATCH_ROWS",
    cycleDispatch.map((d) => ({
      id: d.id,
      itemId: d.itemId,
      qty: String(d.dispatchedQty),
      workflowStatus: d.workflowStatus,
      reversalOfId: d.reversalOfId,
      cycleId: d.cycleId,
    })),
  );
  // eslint-disable-next-line no-console
  console.log("CYCLE_NET_DISPATCHED_BY_ITEM", Object.fromEntries([...netByItem.entries()]));

  // Recompute NO_QTY lineStats exactly as buildNoQtyLineStats (qcAccepted is informational; not gating).
  const stats = [];
  for (const ln of rsLines) {
    const cap = num(ln.cycleCap);
    if (!(cap > 1e-9)) continue;
    const already = num(netByItem.get(ln.itemId) || 0);
    const remaining = Math.max(0, cap - already);
    if (!(remaining > 1e-9)) continue;
    const cycleAccepted = num(qcAcceptedByItem.get(ln.itemId) || 0) + num(recheckAcceptedByItem.get(ln.itemId) || 0);
    const usable = Math.max(0, cycleAccepted - already);
    const dispatchable = Math.min(remaining, usable);
    const logicalPending = Math.min(remaining, usable);
    stats.push({
      itemId: ln.itemId,
      itemName: ln.itemName,
      cycleCap: cap,
      dispatched: already,
      remaining,
      usableStock: usable,
      dispatchable,
      pendingDispatchQty: logicalPending,
      soRemainingDemandQty: remaining,
    });
  }
  // eslint-disable-next-line no-console
  console.log("RECOMPUTED_NO_QTY_LINESTATS", stats);

  // Transaction-level proof: show the most recent USABLE bucket transactions per item (sample).
  const tx = await prisma.stockTransaction.findMany({
    where: { itemId: { in: itemIds }, stockBucket: "USABLE" },
    orderBy: [{ id: "desc" }],
    take: 400,
    select: {
      id: true,
      date: true,
      itemId: true,
      stockBucket: true,
      transactionType: true,
      qtyIn: true,
      qtyOut: true,
      reason: true,
      refId: true,
    },
  });
  const txByItem = {};
  for (const t of tx) {
    (txByItem[t.itemId] = txByItem[t.itemId] || []).push(t);
  }
  for (const ln of rsLines) {
    // eslint-disable-next-line no-console
    console.log("USABLE_TX_SAMPLE_ITEM", ln.itemId, ln.itemName, (txByItem[ln.itemId] || []).slice(0, 40));
  }
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

