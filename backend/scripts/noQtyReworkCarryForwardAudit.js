/**
 * NO_QTY Rework / Carry-Forward Audit
 *
 * Usage:
 *   node scripts/noQtyReworkCarryForwardAudit.js --soId 123 --itemId 456
 *   node scripts/noQtyReworkCarryForwardAudit.js --soId 123 --itemName "Nozzle"
 *   node scripts/noQtyReworkCarryForwardAudit.js --itemName "Nozzle"   (lists candidate NO_QTY SOs)
 *
 * Prints evidence for:
 * - Dispatch rows (per-cycle operational net)
 * - QC accepted (original + recheck + post-cycle approval) per cycle
 * - RequirementSheet LOCKED planned qty per cycle (latest locked)
 * - Carry-forward calculation currently used by requirementSheets helper (planned - original QC accepted)
 *
 * NOTE:
 * StockTransaction does not carry salesOrderId/cycleId; dispatch + QC rows are the authoritative per-cycle linkage.
 */
const { PrismaClient } = require("../prisma/generated/client");
require("dotenv").config();

const prisma = new PrismaClient();

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}
function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    out[key] = val;
  }
  return out;
}

async function latestLockedRsByCycle(soId) {
  const rows = await prisma.requirementSheet.findMany({
    where: { salesOrderId: soId, status: "LOCKED" },
    select: { id: true, cycleId: true, periodKey: true, version: true, createdAt: true, lines: { select: { itemId: true, requirementQty: true } } },
  });
  /** @type {Map<number, any>} */
  const byCycle = new Map();
  for (const r of rows) {
    const cid = r.cycleId != null ? Number(r.cycleId) : null;
    if (!cid) continue;
    const prev = byCycle.get(cid);
    const rank = `${String(r.periodKey ?? "").padStart(16, " ")}|${String(r.version ?? 0).padStart(6, "0")}|${new Date(r.createdAt).getTime()}|${r.id}`;
    if (!prev || rank > prev.rank) {
      byCycle.set(cid, { ...r, rank });
    }
  }
  return byCycle;
}

async function qcAcceptedOriginalByCycleItem(soId, itemId) {
  // Original QC accepted comes from qcEntry rows linked via production -> work order -> cycleId.
  // We intentionally avoid recheck/post-cycle here; those are separate terms below.
  const rows = await prisma.qcEntry.findMany({
    where: {
      reversedAt: null,
      production: {
        workflowStatus: "APPROVED",
        workOrderLine: {
          fgItemId: itemId,
          workOrder: { salesOrderId: soId },
        },
      },
    },
    select: {
      acceptedQty: true,
      production: {
        select: {
          workOrderLine: {
            select: {
              workOrder: { select: { cycleId: true } },
            },
          },
        },
      },
    },
  });
  const m = new Map();
  for (const r of rows) {
    const cid = r.production?.workOrderLine?.workOrder?.cycleId != null ? Number(r.production.workOrderLine.workOrder.cycleId) : null;
    if (!cid) continue;
    m.set(cid, round3(n(m.get(cid) ?? 0) + n(r.acceptedQty)));
  }
  return m;
}

async function recheckAcceptedByCycleItem(soId, itemId) {
  // Recheck acceptance: disposition rows that become usable for dispatch pool.
  // We can reconstruct by reading disposition records that reference this SO/item and have a resolved cycleId.
  //
  // Implementation detail:
  // We reuse the NO_QTY dispatch helper logic by calling the exported map loader from routes/dispatch.js.
  const { loadNoQtyCycleRecheckAcceptedMap } = require("../src/routes/dispatch");
  const cycles = await prisma.salesOrderCycle.findMany({ where: { salesOrderId: soId }, select: { id: true } });
  const inputs = cycles.map((c) => ({ id: soId, currentCycleId: Number(c.id) }));
  const map = await loadNoQtyCycleRecheckAcceptedMap(prisma, inputs);
  const out = new Map();
  for (const c of cycles) {
    const cid = Number(c.id);
    const key = `${soId}:${cid}:${itemId}`;
    const q = n(map.get(key) ?? 0);
    if (q > 0) out.set(cid, round3(q));
  }
  return out;
}

async function postCycleApprovalByCycleItem(soId, itemId) {
  const { loadNoQtyPostCycleApprovalQtyByItem } = require("../src/services/noQtyPostCycleApprovalService");
  const cycles = await prisma.salesOrderCycle.findMany({ where: { salesOrderId: soId }, select: { id: true } });
  const out = new Map();
  for (const c of cycles) {
    const cid = Number(c.id);
    const byItem = await loadNoQtyPostCycleApprovalQtyByItem(prisma, soId, cid);
    const q = n(byItem.get(itemId) ?? 0);
    if (q > 0) out.set(cid, round3(q));
  }
  return out;
}

async function operationalDispatchByCycleItem(soId, itemId) {
  const rows = await prisma.dispatch.findMany({
    where: { soId, itemId },
    select: { id: true, dispatchedQty: true, cycleId: true, workflowStatus: true, reversalOfId: true, date: true },
    orderBy: { id: "asc" },
  });
  // Operational net is forward LOCKED rows minus reversal rows; but schema stores reversals as separate rows w/ reversalOfId set.
  // Here we net all rows by cycleId by summing dispatchedQty directly (reversals should carry negative qty in this system).
  const m = new Map();
  for (const r of rows) {
    const cid = r.cycleId != null ? Number(r.cycleId) : null;
    if (!cid) continue;
    m.set(cid, round3(n(m.get(cid) ?? 0) + n(r.dispatchedQty)));
  }
  return { rows, byCycle: m };
}

async function listCandidateSos(itemId) {
  const sos = await prisma.salesOrder.findMany({
    where: { orderType: "NO_QTY", lines: { some: { itemId } } },
    select: { id: true, docNo: true, internalStatus: true, currentCycleId: true, createdAt: true },
    orderBy: { id: "desc" },
    take: 25,
  });
  return sos;
}

async function main() {
  const args = parseArgs(process.argv);
  const soId = args.soId ? Number(args.soId) : null;
  const itemIdArg = args.itemId ? Number(args.itemId) : null;
  const itemName = typeof args.itemName === "string" ? String(args.itemName).trim() : "";

  let item = null;
  if (itemIdArg && Number.isFinite(itemIdArg)) {
    item = await prisma.item.findUnique({ where: { id: itemIdArg }, select: { id: true, itemName: true, itemType: true } });
  } else if (itemName) {
    item = await prisma.item.findFirst({
      where: { itemType: "FG", itemName: { contains: itemName } },
      orderBy: { id: "desc" },
      select: { id: true, itemName: true, itemType: true },
    });
  }
  if (!item) {
    console.log(JSON.stringify({ error: "ITEM_NOT_FOUND", hint: "Pass --itemId or --itemName" }, null, 2));
    return;
  }

  if (!soId || !Number.isFinite(soId)) {
    const candidates = await listCandidateSos(item.id);
    console.log(
      JSON.stringify(
        {
          mode: "CANDIDATES",
          item: item,
          candidates: candidates.map((s) => ({
            soId: s.id,
            docNo: s.docNo,
            internalStatus: s.internalStatus,
            currentCycleId: s.currentCycleId,
            createdAt: s.createdAt,
          })),
          hint: "Re-run with --soId <id> (and optionally --itemId) to print full audit",
        },
        null,
        2,
      ),
    );
    return;
  }

  const so = await prisma.salesOrder.findUnique({
    where: { id: soId },
    select: {
      id: true,
      docNo: true,
      orderType: true,
      internalStatus: true,
      currentCycleId: true,
      cycles: { select: { id: true, cycleNo: true, status: true }, orderBy: { cycleNo: "asc" } },
    },
  });
  if (!so) {
    console.log(JSON.stringify({ error: "SO_NOT_FOUND", soId }, null, 2));
    return;
  }
  if (so.orderType !== "NO_QTY") {
    console.log(JSON.stringify({ error: "NOT_NO_QTY", so: { id: so.id, docNo: so.docNo, orderType: so.orderType } }, null, 2));
    return;
  }

  const [rsByCycle, qcOrig, qcRecheck, qcPost, dispatch] = await Promise.all([
    latestLockedRsByCycle(soId),
    qcAcceptedOriginalByCycleItem(soId, item.id),
    recheckAcceptedByCycleItem(soId, item.id),
    postCycleApprovalByCycleItem(soId, item.id),
    operationalDispatchByCycleItem(soId, item.id),
  ]);

  const cycleRows = (so.cycles || []).map((c) => {
    const cid = Number(c.id);
    const rs = rsByCycle.get(cid) ?? null;
    const planned = rs ? n((rs.lines || []).find((ln) => Number(ln.itemId) === Number(item.id))?.requirementQty ?? 0) : 0;
    const qcAccepted = n(qcOrig.get(cid) ?? 0);
    const recheckAccepted = n(qcRecheck.get(cid) ?? 0);
    const postApproved = n(qcPost.get(cid) ?? 0);
    const effective = round3(qcAccepted + recheckAccepted + postApproved);
    const dispatched = n(dispatch.byCycle.get(cid) ?? 0);
    // Current carry-forward basis in requirementSheets: planned - original qc accepted (ignores recheck/post-cycle).
    const shortfall_current_helper = round3(Math.max(0, planned - qcAccepted));
    const shortfall_effective = round3(Math.max(0, planned - effective));
    const qcPoolRemainingAfterDispatch = round3(Math.max(0, effective - dispatched));
    return {
      cycleId: cid,
      cycleNo: c.cycleNo,
      status: c.status,
      plannedQty_lockedRS: round3(planned),
      qcAccepted_original: round3(qcAccepted),
      qcAccepted_recheck: round3(recheckAccepted),
      qcAccepted_postCycleApproval: round3(postApproved),
      effectiveFulfillmentBasis: effective,
      dispatchedOperationalNet: round3(dispatched),
      shortfall_current_helper_basis_planned_minus_originalQC: shortfall_current_helper,
      shortfall_effective_basis_planned_minus_effective: shortfall_effective,
      qcPoolRemainingAfterOperationalDispatch_effectiveMinusDispatch: qcPoolRemainingAfterDispatch,
      lockedRsId: rs?.id ?? null,
    };
  });

  console.log(
    JSON.stringify(
      {
        so: {
          id: so.id,
          docNo: so.docNo,
          orderType: so.orderType,
          internalStatus: so.internalStatus,
          currentCycleId: so.currentCycleId,
        },
        item,
        audit: {
          cycles: cycleRows,
          dispatchRows: dispatch.rows,
          notes: [
            "StockTransaction does not store salesOrderId/cycleId. Per-cycle truth is derived from QC rows (via WO.cycleId) + Dispatch.cycleId.",
            "If shortfall_current_helper is > 0 but shortfall_effective is 0, carry-forward is ignoring recheck/post-cycle accepted quantities.",
          ],
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
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

