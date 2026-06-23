/**
 * Backfill non-overridden Monthly Production Plan lines so plannedFgQty matches
 * live suggested production (RS + green shortage).
 *
 * Does NOT change RM snapshot lines — only MonthlyProductionPlanLine columns.
 *
 * Usage:
 *   node scripts/backfill-monthly-plan-planned-qty.js --docNo DOC-26-0001
 *   node scripts/backfill-monthly-plan-planned-qty.js --docNo DOC-26-0001 --apply
 *   node scripts/backfill-monthly-plan-planned-qty.js --planId 18 --apply
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { backfillNonOverriddenPlannedQtyForPlan } = require("../src/services/monthlyPlanningProductionLinePlannedQty");

function readArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

const APPLY = process.argv.includes("--apply");
const docNo = readArg("--docNo");
const planIdRaw = readArg("--planId");
const planId = planIdRaw != null ? Number(planIdRaw) : null;

async function main() {
  if (!docNo && !(Number.isFinite(planId) && planId > 0)) {
    console.error("Provide --docNo DOC-26-0001 or --planId <id>. Optional --apply to write.");
    process.exit(1);
  }

  const res = await backfillNonOverriddenPlannedQtyForPlan({
    docNo: docNo ?? undefined,
    planId: docNo ? undefined : planId,
    dryRun: !APPLY,
  });

  console.log(JSON.stringify(res, null, 2));

  if (res.dryRun && res.pending.length > 0) {
    console.log("\nDry-run only. Re-run with --apply to persist changes.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
