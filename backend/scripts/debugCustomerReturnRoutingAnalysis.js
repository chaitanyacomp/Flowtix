const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function expectedRoutingFromDisposition(disposition) {
  if (disposition === "REWORK") return { shouldBe: "IN_REWORK", qcQueue: false, reworkQueue: true };
  if (disposition === "QC_HOLD") return { shouldBe: "IN_QC_HOLD", qcQueue: true, reworkQueue: false };
  if (disposition === "TO_STOCK") return { shouldBe: "APPROVED_TO_STOCK", qcQueue: false, reworkQueue: false };
  return { shouldBe: "UNKNOWN", qcQueue: false, reworkQueue: false };
}

async function main() {
  const returns = await prisma.customerReturn.findMany({
    orderBy: { id: "desc" },
    take: 25,
  });
  const ids = returns.map((r) => r.id);
  const txns = await prisma.stockTransaction.findMany({
    where: { transactionType: { in: ["CUSTOMER_RETURN", "SCRAP"] }, refId: { in: ids } },
    orderBy: { id: "desc" },
  });
  const txnsByRef = new Map();
  for (const t of txns) {
    if (!txnsByRef.has(t.refId)) txnsByRef.set(t.refId, []);
    txnsByRef.get(t.refId).push(t);
  }

  const analysis = returns.map((r) => {
    const exp = expectedRoutingFromDisposition(r.disposition);
    const shouldAppearInQc = r.reversedAt == null && r.status === "IN_QC_HOLD";
    const whyExcluded = shouldAppearInQc
      ? null
      : r.reversedAt != null
        ? "Excluded because reversedAt is set"
        : r.status !== "IN_QC_HOLD"
          ? `Excluded because status is ${r.status} (QC requires IN_QC_HOLD)`
          : "Excluded by unknown condition";

    const stock = (txnsByRef.get(r.id) || []).map((t) => ({
      id: t.id,
      type: t.transactionType,
      itemId: t.itemId,
      qtyIn: Number(t.qtyIn),
      qtyOut: Number(t.qtyOut),
      stockBucket: t.stockBucket,
      refId: t.refId,
      createdAt: t.createdAt,
    }));

    return {
      id: r.id,
      dispatchId: r.dispatchId,
      itemId: r.itemId,
      returnedQty: Number(r.returnedQty),
      disposition: r.disposition,
      status: r.status,
      currentBucket: r.currentBucket,
      reversedAt: r.reversedAt,
      createdAt: r.createdAt,
      expectedFromDisposition: exp,
      shouldAppearInQcQueueNow: shouldAppearInQc,
      whyExcludedFromQcQueue: whyExcluded,
      stockTxns: stock,
    };
  });

  console.log(JSON.stringify(analysis, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

