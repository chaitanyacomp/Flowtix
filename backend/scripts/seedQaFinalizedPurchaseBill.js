/**
 * Idempotent QA helper: ensures one finalized Purchase Bill exists for payment/receipt smoke tests.
 *
 * Looks for an existing FINALIZED bill whose remarks contain "QA seed finalized".
 * Otherwise picks the latest GRN with billingStatus PENDING, creates a draft from it,
 * sets supplier invoice no + remarks, and finalizes.
 *
 * Requires: at least one GRN with remaining billable qty (billingStatus PENDING).
 *
 * Usage (from backend/): node scripts/seedQaFinalizedPurchaseBill.js
 */
const { PrismaClient } = require("../prisma/generated/client");
const { createDraftForGrn, updateDraft, finalizeBill } = require("../src/services/purchaseBillService");

const prisma = new PrismaClient();

const QA_MARKER = "QA seed finalized purchase bill";

async function main() {
  const existing = await prisma.purchaseBill.findFirst({
    where: {
      status: "FINALIZED",
      remarks: { contains: "QA seed finalized" },
    },
    select: { id: true, billNo: true, netAmount: true, remarks: true },
    orderBy: { id: "desc" },
  });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log(
      `QA purchase bill already exists: id=${existing.id} billNo=${existing.billNo ?? "—"} net=${existing.netAmount}`,
    );
    return;
  }

  const grn = await prisma.grn.findFirst({
    where: { reversedAt: null, billingStatus: "PENDING" },
    orderBy: { id: "desc" },
    select: { id: true },
  });
  if (!grn) {
    // eslint-disable-next-line no-console
    console.error("No unbilled GRN (billingStatus=PENDING). Receive RM against a PO first.");
    process.exit(1);
  }

  const { bill } = await createDraftForGrn(prisma, grn.id);
  const billDateIso =
    bill.billDate instanceof Date ? bill.billDate.toISOString() : String(bill.billDate ?? new Date().toISOString());

  await updateDraft(prisma, bill.id, {
    billNo: `QA-INV-SEED-${bill.id}`,
    billDate: billDateIso,
    dueDate: null,
    remarks: QA_MARKER,
    lines: bill.lines.map((ln) => ({
      id: ln.id,
      qty: Number(ln.qty),
      rate: Number(ln.rate),
    })),
  });

  const finalized = await finalizeBill(prisma, bill.id);
  // eslint-disable-next-line no-console
  console.log(
    `Created QA finalized purchase bill id=${finalized.id} billNo=${finalized.billNo ?? "—"} net=${finalized.netAmount}`,
  );
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
