/**
 * Batch 3F — post-migration validation on live DB.
 */
const { prisma } = require("../src/utils/prisma");

async function main() {
  const cf = await prisma.$queryRawUnsafe(`
    SELECT recoveryType, recoveryStatus, COUNT(*) AS cnt,
           COALESCE(SUM(sourceQty),0) AS sourceQtySum,
           COALESCE(SUM(waivedQty),0) AS waivedQtySum
    FROM CarryForwardPending
    GROUP BY recoveryType, recoveryStatus
  `);
  const incomplete = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS cnt FROM CarryForwardPending WHERE migrationIncomplete = 1
  `);
  const soStatus = await prisma.$queryRawUnsafe(`
    SELECT internalStatus, COUNT(*) AS cnt FROM SalesOrder WHERE orderType = 'NO_QTY' GROUP BY internalStatus
  `);
  const alloc = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS cnt FROM RecoveryAllocation`);
  const waiver = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS cnt FROM NoQtySoWaiver`);
  const rsLines = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS cnt,
           COALESCE(SUM(baseDemandQty),0) AS baseDemand,
           COALESCE(SUM(productionShortfallQty),0) AS prodShortfall,
           COALESCE(SUM(qcRejectionRecoveryQty),0) AS qcRecovery,
           COALESCE(SUM(approvedManualAdjustmentQty),0) AS manualAdj,
           COALESCE(SUM(totalRsQty),0) AS totalRs
    FROM RequirementSheetLine
  `);
  const sources = await prisma.$queryRawUnsafe(`
    SELECT c.id, c.sourceQty, c.waivedQty, c.recoveryStatus,
           COALESCE((
             SELECT SUM(a.allocatedQty) FROM RecoveryAllocation a
             WHERE a.recoverySourceId = c.id AND a.status IN ('RESERVED','COMMITTED')
           ),0) AS activeAlloc
    FROM CarryForwardPending c
    LIMIT 2000
  `);
  let exceptions = 0;
  for (const s of sources) {
    if (String(s.recoveryStatus) === "CANCELLED") continue;
    const src = Number(s.sourceQty || 0);
    const waived = Number(s.waivedQty || 0);
    const active = Number(s.activeAlloc || 0);
    const avail = Math.max(0, Math.round((src - active - waived) * 1000) / 1000);
    if (Math.abs(src - (active + waived + avail)) > 0.001) exceptions += 1;
  }
  const toPlain = (v) =>
    JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? Number(val) : val)));
  console.log(
    JSON.stringify(
      toPlain({
        migration: "20260710120000_no_qty_recovery_foundation",
        applied: true,
        cfByTypeStatus: cf,
        migrationIncompleteCount: Number(incomplete[0]?.cnt ?? 0),
        noQtySoStatusCounts: soStatus,
        recoveryAllocationCount: Number(alloc[0]?.cnt ?? 0),
        waiverCount: Number(waiver[0]?.cnt ?? 0),
        rsLineComponentSums: rsLines[0],
        reconSampleSize: sources.length,
        reconExceptions: exceptions,
      }),
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
