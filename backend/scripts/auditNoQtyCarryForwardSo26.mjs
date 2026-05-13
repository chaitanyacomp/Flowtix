/**
 * One-off audit: SO-26-0007 / Cap — run: node scripts/auditNoQtyCarryForwardSo26.mjs
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { prisma } = require("../src/utils/prisma.js");
const { loadNoQtyCarryForwardShortfallByItem } = require("../src/routes/requirementSheets.js");

const QC_ENTRY_ACTIVE_WHERE = { reversedAt: null };

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function pickWinningLockedRequirementSheet(a, b) {
  const pkA = String(a.periodKey ?? "");
  const pkB = String(b.periodKey ?? "");
  if (pkA !== pkB) return pkA > pkB ? a : b;
  const vA = Number(a.version ?? 0);
  const vB = Number(b.version ?? 0);
  if (vA !== vB) return vA >= vB ? a : b;
  const tA = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
  const tB = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
  if (tA !== tB) return tA >= tB ? a : b;
  return Number(a.id) >= Number(b.id) ? a : b;
}

const DOC_NO = "SO-26-0007";
const ITEM_NAME_SUBSTR = "Cap";

async function main() {
  const so = await prisma.salesOrder.findFirst({
    where: { docNo: DOC_NO },
    select: { id: true, docNo: true, currentCycleId: true },
  });
  if (!so) {
    console.log(JSON.stringify({ error: "SO not found", DOC_NO }, null, 2));
    return;
  }

  const capItem = await prisma.item.findFirst({
    where: { itemName: { contains: ITEM_NAME_SUBSTR } },
    select: { id: true, itemName: true },
  });

  const cycles = await prisma.salesOrderCycle.findMany({
    where: { salesOrderId: so.id },
    orderBy: { cycleNo: "asc" },
    select: { id: true, cycleNo: true, status: true },
  });

  const cycle4 = cycles.find((c) => c.cycleNo === 4);
  const currentCycleId = cycle4?.id ?? so.currentCycleId;

  const helperOut = await loadNoQtyCarryForwardShortfallByItem({
    salesOrderId: so.id,
    currentCycleId: Number(currentCycleId),
  });

  const capId = capItem?.id ?? null;
  const sfRow = capId ? helperOut.shortfallByItem?.get(capId) : null;
  const breakdown = capId ? helperOut.carryForwardBreakdownByItem?.get(capId) : null;

  console.log("\n=== NO_QTY_CARRY_FORWARD_SHORTFALL (equivalent log payload) ===\n");
  console.log(
    JSON.stringify(
      {
        salesOrderId: so.id,
        docNo: so.docNo,
        currentCycleId: Number(currentCycleId),
        currentCycleNo: cycle4?.cycleNo ?? null,
        capItemId: capId,
        capItemName: capItem?.itemName ?? null,
        shortfallForCap: sfRow ?? null,
        breakdownForCap: breakdown ?? null,
      },
      null,
      2,
    ),
  );

  const prevCycles = cycles.filter((c) => (cycle4 ? c.cycleNo < cycle4.cycleNo : true));

  console.log("\n=== CYCLE-WISE AUDIT TABLE (cycles before Cycle 4) ===\n");

  for (const cy of prevCycles) {
    if (cycle4 && cy.cycleNo >= cycle4.cycleNo) continue;

    const cid = cy.id;
    const lockedSheets = await prisma.requirementSheet.findMany({
      where: { salesOrderId: so.id, status: "LOCKED", cycleId: cid },
      select: { id: true, docNo: true, periodKey: true, version: true, createdAt: true, status: true },
    });
    let winning = null;
    for (const sh of lockedSheets) {
      winning = winning ? pickWinningLockedRequirementSheet(winning, sh) : sh;
    }

    const allSheets = await prisma.requirementSheet.findMany({
      where: { salesOrderId: so.id, cycleId: cid },
      select: {
        id: true,
        docNo: true,
        status: true,
        periodKey: true,
        version: true,
      },
      orderBy: [{ id: "asc" }],
    });

    let grossPlannedCap = 0;
    let rsReqCap = null;
    let rsSfCap = null;
    let winningLineNote = "";
    if (winning && capId) {
      const ln = await prisma.requirementSheetLine.findFirst({
        where: { sheetId: winning.id, itemId: capId },
        select: { requirementQty: true, shortfallQtySnapshot: true },
      });
      if (ln) {
        const req = n(ln.requirementQty);
        const sf = ln.shortfallQtySnapshot != null ? n(ln.shortfallQtySnapshot) : 0;
        rsReqCap = req;
        rsSfCap = ln.shortfallQtySnapshot != null ? sf : null;
        grossPlannedCap = ln.shortfallQtySnapshot == null ? round3(req) : round3(sf + req);
        winningLineNote = `shortfallQtySnapshot ${ln.shortfallQtySnapshot == null ? "null → gross=req" : "set → gross=sf+req"}`;
      }
    }

    const wos = await prisma.workOrder.findMany({
      where: { salesOrderId: so.id, cycleId: cid },
      select: { id: true, docNo: true },
    });
    const woIds = wos.map((w) => w.id);

    let woPlannedCap = 0;
    const wolLines = await prisma.workOrderLine.findMany({
      where: { workOrderId: { in: woIds }, fgItemId: capId ?? -1 },
      select: { id: true, workOrderId: true, plannedQty: true, qty: true },
    });
    for (const l of wolLines) {
      woPlannedCap += n(l.plannedQty ?? l.qty);
    }

    const productions = await prisma.productionEntry.findMany({
      where: {
        workflowStatus: "APPROVED",
        workOrderLine: {
          workOrder: {
            salesOrderId: so.id,
            cycleId: cid,
            status: { not: "REJECTED" },
          },
          ...(capId ? { fgItemId: capId } : {}),
        },
      },
      select: { id: true, producedQty: true, workOrderLine: { select: { fgItemId: true, workOrderId: true } } },
    });
    let prodQty = 0;
    for (const p of productions) {
      prodQty += n(p.producedQty);
    }

    const prodIds = productions.map((p) => p.id).filter((x) => x > 0);
    let qcAccepted = 0;
    if (prodIds.length) {
      const qcAgg = await prisma.qcEntry.groupBy({
        by: ["productionId"],
        where: { productionId: { in: prodIds }, ...QC_ENTRY_ACTIVE_WHERE },
        _sum: { acceptedQty: true },
      });
      for (const r of qcAgg) {
        qcAccepted += n(r._sum.acceptedQty);
      }
    }

    const dispRows = await prisma.dispatch.findMany({
      where: {
        soId: so.id,
        cycleId: cid,
        ...(capId ? { itemId: capId } : {}),
        reversalOfId: null,
      },
      select: { id: true, dispatchedQty: true, workflowStatus: true },
    });
    let dispatchQty = 0;
    for (const d of dispRows) {
      dispatchQty += n(d.dispatchedQty);
    }

    const plannedForShortage = winning ? grossPlannedCap : 0;
    const qcForShortage = qcAccepted;
    const cycleShortage = Math.max(0, plannedForShortage - qcForShortage);

    console.log(`--- Cycle ${cy.cycleNo} (id=${cid}, status=${cy.status}) ---`);
    console.log(
      JSON.stringify(
        {
          cycleNo: cy.cycleNo,
          cycleId: cid,
          cycleStatus: cy.status,
          rsIdsAllSheets: allSheets.map((s) => ({ id: s.id, docNo: s.docNo, status: s.status })),
          winningLockedRsId: winning?.id ?? null,
          winningLockedRsDocNo: winning?.docNo ?? null,
          winningLockedRsNote: lockedSheets.length ? `${lockedSheets.length} LOCKED; winner id=${winning?.id}` : "no LOCKED RS",
          rsRequirementQtyCap: rsReqCap,
          rsShortfallSnapshotCap: rsSfCap,
          grossPlannedQtyUsedByHelper_Cap: grossPlannedCap,
          winningLineLogic: winningLineNote || "n/a",
          woIds,
          woPlannedQtySum_Cap: woPlannedCap,
          productionApprovedQtySum_Cap: prodQty,
          qcAcceptedQty_Cap: qcAccepted,
          dispatchQtySum_Cap: dispatchQty,
          helperPlannedMinusQc_Cap: { planned: plannedForShortage, qc: qcForShortage, shortage: cycleShortage },
          includedInCarryForward_preOct2025_logic: "N/A (inclusion filter removed)",
        },
        null,
        2,
      ),
    );
    console.log("");
  }

  const draftSheetsC4 = await prisma.requirementSheet.findMany({
    where: { salesOrderId: so.id, cycleId: cycle4?.id, status: "DRAFT" },
    select: { id: true, docNo: true },
  });
  if (capId && cycle4) {
    const draftLine = await prisma.requirementSheetLine.findFirst({
      where: {
        sheetId: { in: draftSheetsC4.map((s) => s.id) },
        itemId: capId,
      },
      select: { sheetId: true, shortfallQtySnapshot: true, requirementQty: true },
    });
    console.log("=== Cycle 4 draft RS line for Cap (persisted snapshot vs live) ===\n");
    console.log(
      JSON.stringify(
        {
          draftRsIds: draftSheetsC4,
          draftLine: draftLine ?? null,
          liveHelperRawShortfallForCap: sfRow?.rawShortfall ?? null,
          note:
            "Draft UI Last Shortage uses loadNoQtyCarryForwardShortfallByItem at mapSheetDetail time (live), not the draft line shortfallQtySnapshot until lock.",
        },
        null,
        2,
      ),
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
