import { prisma } from "../src/utils/prisma.js";

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function pick(v, keys) {
  const out = {};
  for (const k of keys) out[k] = v?.[k] ?? null;
  return out;
}

async function main() {
  const soId = Number(process.env.SO_ID || process.argv[2] || 0);
  const itemId = Number(process.env.ITEM_ID || process.argv[3] || 0);
  if (!Number.isFinite(soId) || soId <= 0 || !Number.isFinite(itemId) || itemId <= 0) {
    console.error("Usage: node backend/scripts/auditNoQtyUsableInconsistency.mjs <SO_ID> <ITEM_ID>");
    process.exit(1);
  }

  const so = await prisma.salesOrder.findUnique({
    where: { id: soId },
    select: {
      id: true,
      docNo: true,
      orderType: true,
      currentCycleId: true,
      cycles: { select: { id: true, cycleNo: true, status: true, closedAt: true }, orderBy: { cycleNo: "asc" } },
      dispatch: {
        select: { id: true, cycleId: true, itemId: true, dispatchedQty: true, reversalOfId: true, workflowStatus: true, date: true, docNo: true },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!so) throw new Error(`SO ${soId} not found`);
  console.log("=== SalesOrder ===");
  console.log({ id: so.id, docNo: so.docNo, orderType: so.orderType, currentCycleId: so.currentCycleId });
  console.log("Cycles:", so.cycles.map((c) => pick(c, ["id", "cycleNo", "status", "closedAt"])));

  const txns = await prisma.stockTransaction.findMany({
    where: { itemId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  console.log("\n=== StockTransaction (item) ===");
  const usable = txns.filter((t) => t.stockBucket === "USABLE");
  console.log("USABLE rows:", usable.length);
  for (const t of usable) {
    console.log({
      id: t.id,
      createdAt: t.createdAt,
      transactionType: t.transactionType,
      stockBucket: t.stockBucket,
      qtyIn: t.qtyIn,
      qtyOut: t.qtyOut,
      refId: t.refId,
      reversalOfId: t.reversalOfId,
      qcEntryId: t.qcEntryId,
      productionEntryId: t.productionEntryId,
      qcRejectedDispositionId: t.qcRejectedDispositionId,
      reason: t.reason,
    });
  }
  const usableNet = usable.reduce((s, t) => s + n(t.qtyIn) - n(t.qtyOut), 0);
  console.log("USABLE net balance:", usableNet);

  console.log("\n=== Dispatch rows (SO + item) ===");
  const disp = (so.dispatch || []).filter((d) => Number(d.itemId) === itemId);
  for (const d of disp) {
    console.log({
      id: d.id,
      docNo: d.docNo,
      date: d.date,
      cycleId: d.cycleId,
      dispatchedQty: n(d.dispatchedQty),
      workflowStatus: d.workflowStatus,
      reversalOfId: d.reversalOfId,
    });
  }
  const lockedNet = disp
    .filter((d) => d.workflowStatus !== "UNLOCKED") // operationally confirmed
    .reduce((s, d) => s + n(d.dispatchedQty), 0);
  const operationalNet = disp.reduce((s, d) => s + n(d.dispatchedQty), 0);
  console.log("Dispatch net (locked/confirmed):", lockedNet);
  console.log("Dispatch net (operational incl drafts):", operationalNet);

  console.log("\n=== Quick reconciliation ===");
  console.log({
    usableNetBalance: usableNet,
    dispatchNetLocked: lockedNet,
    note:
      "If Optional Dispatch remains >0 while usableNetBalance is 0, the issue is likely cycle headroom attribution (QC/rework credited to one cycle, dispatch consumed under another cycleId).",
  });

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});

