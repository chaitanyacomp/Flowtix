/**
 * Batch 3F — lightweight performance probe (representative local DB).
 */
const { performance } = require("node:perf_hooks");
const { prisma } = require("../src/utils/prisma");

async function timed(label, fn) {
  const t0 = performance.now();
  const result = await fn(prisma);
  const ms = Math.round(performance.now() - t0);
  return {
    label,
    ms,
    meta: result?.meta ?? (Array.isArray(result) ? { count: result.length } : null),
  };
}

async function main() {
  const {
    getNoQtyRecoveryDashboardSnapshot,
    fetchNoQtyRecoveryPendingActions,
    getNoQtyRecoveryControlTowerSlice,
    buildNoQtyRecoveryTraceReport,
    assessNoQtySoClosureMany,
  } = require("../src/services/noQtyRecoveryAnalyticsService");
  const { assessNoQtySoClosure } = require("../src/services/noQtySoClosureService");
  const { getAvailableRecovery } = require("../src/services/noQtyRecoveryService");

  const openRows = await prisma.salesOrder.findMany({
    where: {
      orderType: "NO_QTY",
      internalStatus: { in: ["OPEN", "APPROVED", "IN_PROCESS", "DRAFT"] },
    },
    select: { id: true },
    take: 50,
  });
  const ids = openRows.map((r) => r.id);
  const sampleId = ids[0] || null;

  const results = [];
  results.push({ label: "list-open-noqty", ms: 0, meta: { count: ids.length } });
  results.push(
    await timed("dashboard-no-qty-recovery", () =>
      getNoQtyRecoveryDashboardSnapshot(prisma, { userRole: "ADMIN" }),
    ),
  );
  results.push(
    await timed("pending-actions-recovery", () =>
      fetchNoQtyRecoveryPendingActions(prisma, { role: "ADMIN" }),
    ),
  );
  results.push(await timed("control-tower-slice", () => getNoQtyRecoveryControlTowerSlice(prisma)));
  results.push(await timed("recovery-trace-report", () => buildNoQtyRecoveryTraceReport(prisma, {})));
  if (sampleId) {
    results.push(await timed("so-closure-assessment", () => assessNoQtySoClosure(prisma, sampleId)));
    results.push(
      await timed("rs-recovery-availability", () =>
        getAvailableRecovery(prisma, { salesOrderId: sampleId }),
      ),
    );
    results.push(
      await timed("assess-batch-open", () => assessNoQtySoClosureMany(prisma, ids.slice(0, 20))),
    );
  }

  console.log(
    JSON.stringify({ generatedAt: new Date().toISOString(), openNoQtyCount: ids.length, results }, null, 2),
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
