/**
 * Repair NO_QTY LOCKED requirement sheet lines: recompute shortfallQtySnapshot (confirmed carry only,
 * excluding pending QC disposition) and suggestedWoQtySnapshot per current lock rules.
 *
 * Usage (from backend/):
 *   node scripts/repairNoQtyRsShortfallSnapshots.mjs              # dry-run
 *   node scripts/repairNoQtyRsShortfallSnapshots.mjs --apply      # write updates
 *   node scripts/repairNoQtyRsShortfallSnapshots.mjs --apply --docNo SO-26-0008
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { prisma } = require("../src/utils/prisma.js");
const {
  loadNoQtyCarryForwardShortfallByItem,
  loadNoQtyPriorCycleUndispatchedAcceptedByItem,
} = require("../src/routes/requirementSheets.js");
const {
  loadNoQtyPostCycleApprovalQtyByItem,
  loadNoQtyPendingQcDispositionQtyByItem,
} = require("../src/services/noQtyPostCycleApprovalService.js");

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

const EPS = 1e-6;

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const docIdx = argv.indexOf("--docNo");
  const docNo = docIdx >= 0 && argv[docIdx + 1] ? String(argv[docIdx + 1]) : null;

  const where = {
    status: "LOCKED",
    cycleId: { not: null },
    salesOrder: docNo ? { orderType: "NO_QTY", docNo } : { orderType: "NO_QTY" },
  };

  const sheets = await prisma.requirementSheet.findMany({
    where,
    select: {
      id: true,
      salesOrderId: true,
      cycleId: true,
      docNo: true,
      salesOrder: { select: { docNo: true } },
      lines: { select: { id: true, itemId: true, requirementQty: true, shortfallQtySnapshot: true, suggestedWoQtySnapshot: true } },
    },
    orderBy: { id: "asc" },
  });

  let examined = 0;
  let changed = 0;

  for (const sheet of sheets) {
    const cid = sheet.cycleId != null ? Number(sheet.cycleId) : null;
    if (!cid || cid <= 0) continue;

    const { shortfallByItem } = await loadNoQtyCarryForwardShortfallByItem({
      salesOrderId: sheet.salesOrderId,
      currentCycleId: cid,
    });
    const [postMap, pendMap, undMap] = await Promise.all([
      loadNoQtyPostCycleApprovalQtyByItem(prisma, sheet.salesOrderId, cid),
      loadNoQtyPendingQcDispositionQtyByItem(prisma, sheet.salesOrderId, cid),
      loadNoQtyPriorCycleUndispatchedAcceptedByItem(prisma, sheet.salesOrderId, cid),
    ]);

    for (const ln of sheet.lines || []) {
      examined++;
      const raw = n(shortfallByItem.get(ln.itemId)?.rawShortfall ?? 0);
      const pend = round3(n(pendMap.get(ln.itemId) ?? 0));
      const snapNew = round3(Math.max(0, raw - pend));
      const postPc = round3(n(postMap.get(ln.itemId) ?? 0));
      const und = round3(n(undMap.get(ln.itemId) ?? 0));
      const req = n(ln.requirementQty);
      const sugNew = round3(Math.max(0, snapNew + req - postPc - und));

      const oldSf = ln.shortfallQtySnapshot != null ? round3(n(ln.shortfallQtySnapshot)) : null;
      const oldSug = ln.suggestedWoQtySnapshot != null ? round3(n(ln.suggestedWoQtySnapshot)) : null;

      const sfDrift = oldSf == null ? Math.abs(snapNew) > EPS : Math.abs(oldSf - snapNew) > EPS;
      const sugDrift = oldSug == null ? Math.abs(sugNew) > EPS : Math.abs(oldSug - sugNew) > EPS;
      if (!sfDrift && !sugDrift) continue;

      changed++;
      const row = {
        sheetId: sheet.id,
        soDocNo: sheet.salesOrder?.docNo ?? null,
        lineId: ln.id,
        itemId: ln.itemId,
        oldShortfallQtySnapshot: oldSf,
        newShortfallQtySnapshot: snapNew,
        oldSuggestedWoQtySnapshot: oldSug,
        newSuggestedWoQtySnapshot: sugNew,
      };
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(row));

      if (apply) {
        await prisma.requirementSheetLine.update({
          where: { id: ln.id },
          data: {
            shortfallQtySnapshot: snapNew,
            suggestedWoQtySnapshot: sugNew,
          },
        });
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({ dryRun: !apply, docNoFilter: docNo, sheets: sheets.length, linesExamined: examined, linesUpdated: changed }, null, 2),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
