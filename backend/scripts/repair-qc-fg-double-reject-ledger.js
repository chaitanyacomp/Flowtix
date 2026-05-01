/**
 * One-time repair: legacy QC stock posting credited FG with qtyIn=accepted and qtyOut=rejected,
 * understating on-hand by rejectedQty per affected QcEntry.
 *
 * This script adds ADJUSTMENT rows (qtyIn only) to restore the missing FG, without deleting
 * or editing historical QC StockTransaction rows (audit-safe, additive).
 *
 * Idempotency: each correction is a StockTransaction with transactionType=ADJUSTMENT,
 * refId=QcEntry.id, itemId=FG. Manual /api stock adjustments use refId=0; non-zero refId
 * ADJUSTMENT here means "QC legacy ledger correction (double-reject)".
 *
 * Usage (from backend/):
 *   node scripts/repair-qc-fg-double-reject-ledger.js           # dry-run (default)
 *   node scripts/repair-qc-fg-double-reject-ledger.js --apply # write corrections
 *
 * Requires DATABASE_URL in .env (same as the app).
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { prisma } = require("../src/utils/prisma");

const EPS = 1e-6;
const APPLY = process.argv.includes("--apply");

/** @param {string|number|import('@prisma/client/runtime/library').Decimal} d */
function num(d) {
  return Number(d ?? 0);
}

async function main() {
  const rows = [];

  const qcs = await prisma.qcEntry.findMany({
    where: { reversedAt: null },
    include: {
      production: { include: { workOrderLine: { select: { fgItemId: true } } } },
    },
    orderBy: { id: "asc" },
  });

  for (const qc of qcs) {
    const fgItemId = qc.production?.workOrderLine?.fgItemId;
    if (fgItemId == null) continue;

    const qcLedgers = await prisma.stockTransaction.findMany({
      where: { transactionType: "QC", refId: qc.id },
    });

    const itemIds = [...new Set(qcLedgers.map((t) => t.itemId))];
    if (itemIds.length > 1) {
      console.warn(`[warn] QcEntry ${qc.id}: multiple itemIds on QC stock rows ${itemIds.join(",")} — skipping.`);
      continue;
    }
    if (itemIds.length === 1 && itemIds[0] !== fgItemId) {
      console.warn(
        `[warn] QcEntry ${qc.id}: QC stock itemId ${itemIds[0]} !== WO FG ${fgItemId} — skipping.`,
      );
      continue;
    }

    const wrongOutSum = qcLedgers.reduce((s, t) => s + num(t.qtyOut), 0);
    if (wrongOutSum <= EPS) continue;

    const acceptedQty = num(qc.acceptedQty);
    const rejectedQty = num(qc.rejectedQty);
    const correctionQty = wrongOutSum;

    if (Math.abs(wrongOutSum - rejectedQty) > EPS) {
      console.warn(
        `[warn] QcEntry ${qc.id}: sum(QC qtyOut)=${wrongOutSum} differs from rejectedQty=${rejectedQty} — correcting by ledger sum.`,
      );
    }

    const existingFix = await prisma.stockTransaction.findFirst({
      where: {
        transactionType: "ADJUSTMENT",
        refId: qc.id,
        itemId: fgItemId,
      },
    });

    let status;

    if (existingFix) {
      const existingIn = num(existingFix.qtyIn);
      const existingOut = num(existingFix.qtyOut);
      if (existingOut > EPS) {
        status = "SKIP_CONFLICT_ADJUSTMENT_HAS_OUT";
      } else if (Math.abs(existingIn - correctionQty) <= EPS) {
        status = "SKIP_ALREADY_CORRECTED";
      } else {
        status = "SKIP_CONFLICT_ADJUSTMENT_QTY_MISMATCH";
      }
    } else if (!APPLY) {
      status = "WOULD_APPLY";
    } else {
      await prisma.stockTransaction.create({
        data: {
          itemId: fgItemId,
          transactionType: "ADJUSTMENT",
          refId: qc.id,
          qtyIn: String(correctionQty),
          qtyOut: "0",
        },
      });
      status = "APPLIED";
    }

    rows.push({
      qcEntryId: qc.id,
      fgItemId,
      acceptedQty,
      rejectedQty,
      wrongLedgerEffect: `+${acceptedQty} IN, -${wrongOutSum} OUT (net ${acceptedQty - wrongOutSum})`,
      correctLedgerEffect: `+${acceptedQty} IN only (net ${acceptedQty})`,
      correctionQty,
      status,
    });
  }

  console.log(
    APPLY
      ? "\n=== repair-qc-fg-double-reject-ledger (--apply) ===\n"
      : "\n=== repair-qc-fg-double-reject-ledger (DRY-RUN; add --apply to write) ===\n",
  );

  console.table(
    rows.map((r) => ({
      qcEntryId: r.qcEntryId,
      fgItemId: r.fgItemId,
      acceptedQty: r.acceptedQty,
      rejectedQty: r.rejectedQty,
      correctionQty: r.correctionQty,
      status: r.status,
    })),
  );

  if (rows.length === 0) {
    console.log("No affected QcEntry rows found (no active QC with QC ledger qtyOut > 0).");
  }

  const detail = rows.filter((r) => r.status === "WOULD_APPLY" || r.status === "APPLIED");
  if (detail.length > 0) {
    console.log("\nLedger effect detail (affected rows):");
    for (const r of detail) {
      console.log(
        `  QcEntry ${r.qcEntryId} item ${r.fgItemId}: wrong=${r.wrongLedgerEffect} → target=${r.correctLedgerEffect} → +${r.correctionQty} ADJUSTMENT`,
      );
    }
  }

  const skipped = rows.filter((r) => r.status.startsWith("SKIP"));

  const applied = rows.filter((r) => r.status === "APPLIED").length;
  const would = rows.filter((r) => r.status === "WOULD_APPLY").length;
  console.log(
    `\nSummary: ${APPLY ? `${applied} ADJUSTMENT(s) inserted` : `${would} would be corrected (dry-run)`}; ${skipped.length} skipped.`,
  );

  if (!APPLY && detail.length > 0) {
    console.log("\nRe-run with --apply after DB backup to insert ADJUSTMENT rows.");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect().finally(() => process.exit(1));
});
