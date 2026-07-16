/**
 * Read-only diagnostic: why SO-26-0003 cannot close (NO_QTY).
 * Does not mutate data.
 */
const dotenv = require("dotenv");
dotenv.config();

const { prisma } = require("../src/utils/prisma");
const { assessNoQtySoClosure } = require("../src/services/noQtySoClosureService");
const { assessNoQtyCycleDispatchCapMet } = require("../src/services/noQtySoOperationalGates");
const { getRecoverySummary } = require("../src/services/noQtyRecoveryService");

function num(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

async function main() {
  const so = await prisma.salesOrder.findFirst({
    where: { docNo: "SO-26-0003" },
    select: {
      id: true,
      docNo: true,
      orderType: true,
      internalStatus: true,
      currentCycleId: true,
      customerId: true,
    },
  });
  if (!so) {
    console.log(JSON.stringify({ error: "SO_NOT_FOUND" }, null, 2));
    return;
  }

  const cycles = await prisma.salesOrderCycle.findMany({
    where: { salesOrderId: so.id },
    orderBy: { cycleNo: "asc" },
    select: { id: true, cycleNo: true, status: true },
  });

  const activeCycle = cycles.find((c) => c.status === "ACTIVE") || null;
  const cycleId = activeCycle?.id ?? so.currentCycleId;

  const sheets = await prisma.requirementSheet.findMany({
    where: { salesOrderId: so.id },
    orderBy: [{ cycleId: "asc" }, { id: "asc" }],
    select: {
      id: true,
      docNo: true,
      status: true,
      cycleId: true,
      version: true,
      lines: {
        select: {
          id: true,
          itemId: true,
          requirementQty: true,
          suggestedWoQtySnapshot: true,
          baseDemandQty: true,
          item: { select: { itemName: true, itemType: true } },
        },
      },
    },
  });

  const wos = await prisma.workOrder.findMany({
    where: { salesOrderId: so.id },
    orderBy: { id: "asc" },
    select: {
      id: true,
      docNo: true,
      status: true,
      cycleId: true,
      lines: {
        select: {
          id: true,
          fgItemId: true,
          plannedQty: true,
          shortfallQty: true,
          fgItem: { select: { itemName: true } },
        },
      },
    },
  });

  const woIds = wos.map((w) => w.id);
  let executions = [];
  try {
    executions = woIds.length
      ? await prisma.workOrderProductionExecution.findMany({
          where: { workOrderId: { in: woIds } },
          select: {
            id: true,
            workOrderId: true,
            executionStatus: true,
            lastResolutionType: true,
            completedAt: true,
          },
        })
      : [];
  } catch (e) {
    executions = [];
    console.error("workOrderProductionExecution query failed:", e.message);
  }
  const execByWo = new Map(executions.map((e) => [e.workOrderId, e]));

  let qcByWo = {};
  try {
    const qcRows = woIds.length
      ? await prisma.qcEntry.findMany({
          where: { workOrderId: { in: woIds } },
          select: {
            workOrderId: true,
            status: true,
            acceptedQty: true,
            rejectedQty: true,
          },
        })
      : [];
    for (const q of qcRows) {
      const cur = qcByWo[q.workOrderId] || { accepted: 0, rejected: 0, rows: 0 };
      cur.accepted += num(q.acceptedQty);
      cur.rejected += num(q.rejectedQty);
      cur.rows += 1;
      qcByWo[q.workOrderId] = cur;
    }
  } catch (e) {
    qcByWo = { _note: `QC query skipped: ${e.message}` };
  }

  let producedByWo = {};
  try {
    const reports = woIds.length
      ? await prisma.productionWorkOrderReport.findMany({
          where: { workOrderId: { in: woIds }, status: "CONFIRMED" },
          select: { workOrderId: true, producedQty: true },
        })
      : [];
    for (const r of reports) {
      producedByWo[r.workOrderId] = num(producedByWo[r.workOrderId]) + num(r.producedQty);
    }
  } catch (e) {
    producedByWo = { _note: e.message };
  }

  const lockedActive = sheets.find((s) => s.cycleId === cycleId && s.status === "LOCKED");
  let dispatchCap = null;
  if (cycleId) {
    dispatchCap = await assessNoQtyCycleDispatchCapMet(prisma, { soId: so.id, cycleId: Number(cycleId) });
  }

  const woCountActive = wos.filter((w) => w.cycleId === cycleId && w.status !== "REJECTED").length;

  let recovery = null;
  try {
    recovery = await getRecoverySummary(prisma, so.id);
  } catch (e) {
    recovery = { error: e.message };
  }

  const assessment = await assessNoQtySoClosure(prisma, so.id);

  // RS balance heuristic: requirement/suggested vs WO placed on same cycle+item
  const cycleWos = wos.filter((w) => w.cycleId === cycleId && w.status !== "REJECTED");
  const placedByItem = new Map();
  for (const w of cycleWos) {
    for (const l of w.lines) {
      placedByItem.set(l.fgItemId, num(placedByItem.get(l.fgItemId)) + num(l.plannedQty));
    }
  }

  const rsBalanceLines = (lockedActive?.lines || [])
    .filter((l) => l.item?.itemType === "FG" || !l.item?.itemType)
    .map((l) => {
      const req = num(l.requirementQty);
      const suggested = num(l.suggestedWoQtySnapshot);
      const base = num(l.baseDemandQty);
      const placed = num(placedByItem.get(l.itemId));
      const balance = Math.max(0, Math.max(suggested, req) - placed);
      return {
        itemId: l.itemId,
        itemName: l.item?.itemName,
        baseDemandQty: base,
        requirementQty: req,
        suggestedWoQtySnapshot: suggested,
        woPlacedOnCycle: placed,
        derivedBalance: balance,
      };
    });

  const bills = await prisma.salesBill.findMany({
    where: { soIdSnapshot: so.id },
    select: { id: true, docNo: true, status: true, isExported: true, exportedAt: true },
  });

  console.log(
    JSON.stringify(
      {
        salesOrder: so,
        cycles,
        activeCycle,
        lockedRsActiveCycle: lockedActive
          ? {
              id: lockedActive.id,
              docNo: lockedActive.docNo,
              status: lockedActive.status,
              cycleId: lockedActive.cycleId,
              version: lockedActive.version,
            }
          : null,
        allRequirementSheets: sheets.map((s) => ({
          id: s.id,
          docNo: s.docNo,
          status: s.status,
          cycleId: s.cycleId,
          version: s.version,
          fgLineCount: s.lines.filter((l) => l.item?.itemType === "FG").length,
        })),
        woCountActiveCycleNonRejected: woCountActive,
        woPendingGate: {
          hasLockedRs: !!lockedActive,
          woCount: woCountActive,
          wouldFireWoPending: !!(lockedActive && woCountActive === 0),
          dispatchCap,
          emptyCapExempt:
            dispatchCap?.complete === true &&
            (dispatchCap?.reason === "EMPTY_CYCLE_CAP" || dispatchCap?.reason === "NO_LOCKED_RS"),
        },
        rsBalanceLines,
        workOrders: wos.map((w) => {
          const ex = execByWo.get(w.id);
          return {
            id: w.id,
            docNo: w.docNo,
            status: w.status,
            cycleId: w.cycleId,
            cycleNo: cycles.find((c) => c.id === w.cycleId)?.cycleNo ?? null,
            lines: w.lines.map((l) => ({
              fgItemId: l.fgItemId,
              itemName: l.fgItem?.itemName,
              plannedQty: num(l.plannedQty),
              shortfallQty: num(l.shortfallQty),
            })),
            execution: ex
              ? {
                  executionStatus: ex.executionStatus,
                  lastResolutionType: ex.lastResolutionType,
                  completedAt: ex.completedAt,
                }
              : null,
            producedConfirmed: producedByWo[w.id] ?? 0,
            qc: qcByWo[w.id] || null,
          };
        }),
        recovery,
        salesBills: bills,
        assessment: {
          eligible: assessment.eligible,
          mode: assessment.mode,
          blockers: assessment.blockers,
          warnings: assessment.warnings,
          pendingProductionShortfallQty: assessment.pendingProductionShortfallQty,
          pendingQcRecoveryQty: assessment.pendingQcRecoveryQty,
          proposedWaiverQty: assessment.proposedWaiverQty,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
