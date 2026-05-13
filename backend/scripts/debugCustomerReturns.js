const { PrismaClient } = require("../prisma/generated/client");

const prisma = new PrismaClient();

function pad(n, width) {
  const s = String(n);
  return s.length >= width ? s : "0".repeat(width - s.length) + s;
}

async function main() {
  const returns = await prisma.customerReturn.findMany({
    orderBy: { id: "desc" },
    take: 25,
  });

  const ids = returns.map((r) => r.id);
  const txns = await prisma.stockTransaction.findMany({
    where: {
      refId: { in: ids },
      transactionType: { in: ["CUSTOMER_RETURN", "SCRAP"] },
    },
    orderBy: { id: "desc" },
  });

  const txnsByRef = new Map();
  for (const t of txns) {
    if (!txnsByRef.has(t.refId)) txnsByRef.set(t.refId, []);
    txnsByRef.get(t.refId).push({
      id: t.id,
      type: t.transactionType,
      bucket: t.stockBucket,
      qtyIn: Number(t.qtyIn),
      qtyOut: Number(t.qtyOut),
      createdAt: t.createdAt,
    });
  }

  const out = returns.map((r) => ({
    id: r.id,
    dispatchId: r.dispatchId,
    itemId: r.itemId,
    returnedQty: Number(r.returnedQty),
    disposition: r.disposition,
    status: r.status,
    reversedAt: r.reversedAt,
    createdAt: r.createdAt,
    currentBucket: r.currentBucket,
    stockTxns: txnsByRef.get(r.id) || [],
  }));

  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

