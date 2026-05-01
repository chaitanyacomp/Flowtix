const { prisma } = require("../utils/prisma");
const { DocType } = require("@prisma/client");
const { allocateDocNo } = require("./docNoService");

async function createSalesOrderFromPo(poId) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.salesOrder.findUnique({ where: { poId } });
    if (existing) {
      return { salesOrder: existing, created: false };
    }

    const po = await tx.customerPO.findUnique({
      where: { id: poId },
      include: { lines: true },
    });
    if (!po) {
      const err = new Error("Customer PO not found");
      err.statusCode = 404;
      throw err;
    }
    if (!po.lines.length) {
      const err = new Error("PO has no lines");
      err.statusCode = 400;
      throw err;
    }

    const docNo = await allocateDocNo(tx, { docType: DocType.SALES_ORDER, date: new Date() });
    const so = await tx.salesOrder.create({
      data: {
        docNo,
        poId: po.id,
        customerId: po.customerId,
        internalStatus: "APPROVED",
        lines: {
          create: po.lines.map((l) => ({
            itemId: l.itemId,
            qty: l.qty,
            customerPoQty: l.qty,
            bufferPercent: 0,
          })),
        },
      },
      include: { lines: { include: { item: true } } },
    });

    await tx.customerPO.update({ where: { id: po.id }, data: { status: "COMPLETED" } });

    return { salesOrder: so, created: true };
  });
}

module.exports = { createSalesOrderFromPo };
