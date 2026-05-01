/**
 * Shared payload for customer return list rows (GET /api/customer-returns and QC report).
 * Keeps qcAcceptedQty, pendingInProcessQty, dispatchableQty, etc. in one place.
 *
 * `alreadyUsedInReplacementQty` = max(sum of replacement SO line qty, operational net dispatched on that SO
 * for the return’s item) so headroom matches physical dispatch, not draft lines alone.
 * `availableForReplacementQty` = max(0, qcAcceptedQty - alreadyUsedInReplacementQty).
 */
const { sumQcAcceptedForSoItem } = require("./dispatchQcCap");
const { netDispatchedByItemId, DISPATCH_ALLOC_MODE } = require("./salesOrderDispatchAllocation");

function roundQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 1000) / 1000;
}

function approvedQtyToStock(r) {
  if (!r) return 0;
  if (r.reversedAt != null) return 0;
  return r.status === "APPROVED_TO_STOCK" ? Number(r.returnedQty ?? 0) : 0;
}

/**
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} tx
 * @param {number[]} returnIds
 */
async function replacementUsageByReturnId(tx, returnIds) {
  const ids = (returnIds || []).filter((n) => Number.isFinite(n) && n > 0);
  const unique = Array.from(new Set(ids));
  if (!unique.length) return new Map();

  const replacementSos = await tx.salesOrder.findMany({
    where: {
      customerReturnId: { in: unique },
      orderType: "REPLACEMENT",
      /** Include COMPLETED so line reservations still count after the SO is closed. */
      internalStatus: { in: ["DRAFT", "APPROVED", "IN_PROCESS", "COMPLETED"] },
    },
    include: { lines: true },
  });

  const usedByReturnId = new Map();
  for (const so of replacementSos) {
    const used = (so.lines || []).reduce((s, l) => s + Number(l.qty || 0), 0);
    usedByReturnId.set(so.customerReturnId, used);
  }
  return usedByReturnId;
}

/**
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} prisma
 * @param {import("@prisma/client").Prisma.CustomerReturnGetPayload<{ include: { customer: true; item: true; dispatch: true } }>[]} rows
 */
async function buildCustomerReturnListPayload(prisma, rows) {
  const ids = rows.map((r) => r.id);
  const usedByReturnId = await replacementUsageByReturnId(prisma, ids);

  const replacementSos = await prisma.salesOrder.findMany({
    where: { customerReturnId: { in: ids } },
    select: {
      id: true,
      customerReturnId: true,
      docNo: true,
    },
  });
  /** @type {Map<number, { id: number; docNo: string | null }>} */
  const replacementByReturnId = new Map();
  for (const so of replacementSos) {
    if (so.customerReturnId != null) replacementByReturnId.set(so.customerReturnId, so);
  }
  const repSoIds = [...new Set(replacementSos.map((s) => s.id))];
  /** @type {Map<number, { itemId: number; dispatchedQty: unknown; reversalOfId: number | null; workflowStatus: string | null }[]>} */
  const dispsBySoId = new Map();
  if (repSoIds.length) {
    const disps = await prisma.dispatch.findMany({
      where: { soId: { in: repSoIds } },
      select: {
        soId: true,
        itemId: true,
        dispatchedQty: true,
        reversalOfId: true,
        workflowStatus: true,
      },
    });
    for (const d of disps) {
      const sid = Number(d.soId);
      const arr = dispsBySoId.get(sid) ?? [];
      arr.push(d);
      dispsBySoId.set(sid, arr);
    }
  }

  /** @type {Map<string, Promise<number>>} */
  const qcInflight = new Map();
  function qcAcceptedFor(soId, itemId) {
    const k = `${soId}:${itemId}`;
    if (!qcInflight.has(k)) {
      qcInflight.set(k, sumQcAcceptedForSoItem(prisma, soId, itemId));
    }
    return qcInflight.get(k);
  }

  return Promise.all(
    rows.map(async (r) => {
      const returnQty = roundQty(Number(r.returnedQty ?? 0));
      const rep = replacementByReturnId.get(r.id);
      let qcAcceptedQty = 0;
      let replacementNetDispatchedQty = 0;
      if (rep) {
        qcAcceptedQty = roundQty(await qcAcceptedFor(rep.id, r.itemId));
        // Return approved to usable stock counts as cleared for this return's qty (replacement SO dispatch pool).
        if (r.status === "APPROVED_TO_STOCK" && r.reversedAt == null) {
          qcAcceptedQty = roundQty(Math.max(qcAcceptedQty, returnQty));
        }
        const dr = (dispsBySoId.get(rep.id) ?? []).filter((d) => Number(d.itemId) === Number(r.itemId));
        replacementNetDispatchedQty = roundQty(netDispatchedByItemId(dr, DISPATCH_ALLOC_MODE.OPERATIONAL).get(r.itemId) ?? 0);
      } else if (r.status === "APPROVED_TO_STOCK" && r.reversedAt == null) {
        qcAcceptedQty = returnQty;
      }
      const scrapQty = r.status === "SCRAPPED" && r.reversedAt == null ? returnQty : 0;
      const pendingInProcessQty = Math.max(0, roundQty(returnQty - qcAcceptedQty - scrapQty));
      const dispatchableQty = Math.max(0, roundQty(qcAcceptedQty - replacementNetDispatchedQty));

      /** Sum of replacement SO line qty (reservation). Dispatch can consume pool even when lines show 0. */
      const lineReservedQty = rep ? roundQty(usedByReturnId.get(r.id) ?? 0) : 0;
      const alreadyUsedInReplacementQty = rep
        ? roundQty(Math.max(lineReservedQty, replacementNetDispatchedQty))
        : 0;
      const availableForReplacementQty = rep
        ? Math.max(0, roundQty(qcAcceptedQty - alreadyUsedInReplacementQty))
        : Math.max(0, roundQty(approvedQtyToStock(r) - alreadyUsedInReplacementQty));

      return {
        id: r.id,
        returnNo: `RET-${String(r.id).padStart(6, "0")}`,
        date: r.returnDate,
        customer: { id: r.customerId, name: r.customer?.name ?? "Unknown" },
        item: { id: r.itemId, name: r.item?.itemName ?? `Item #${r.itemId}`, unit: r.item?.unit ?? "" },
        qty: returnQty,
        disposition: r.disposition,
        status: r.status,
        dispatchId: r.dispatchId,
        dispatchNo: `DSP-${String(r.dispatchId).padStart(6, "0")}`,
        reversedAt: r.reversedAt,
        originalSalesOrderId: r.salesOrderId,
        qcAcceptedQty,
        scrapQty,
        pendingInProcessQty,
        dispatchableQty,
        replacementNetDispatchedQty,
        alreadyUsedInReplacementQty,
        availableForReplacementQty,
        replacementSalesOrderId: rep?.id ?? null,
        replacementSalesOrderDocNo: rep?.docNo ?? null,
      };
    }),
  );
}

module.exports = {
  roundQty,
  approvedQtyToStock,
  replacementUsageByReturnId,
  buildCustomerReturnListPayload,
};
