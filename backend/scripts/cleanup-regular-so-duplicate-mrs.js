const fs = require("fs");
const path = require("path");

const { prisma } = require("../src/utils/prisma");
const { computeFgGapLinesForSalesOrder } = require("../src/services/rmCheckService");
const { evaluateWoPrepareReadiness } = require("../src/services/materialPlanningService");

function argValue(name, fallback = null) {
  const idx = process.argv.findIndex((v) => v === `--${name}` || v === `--${name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`);
  if (idx >= 0 && process.argv[idx + 1] && !String(process.argv[idx + 1]).startsWith("--")) return process.argv[idx + 1];
  return fallback;
}

function hasProcurementLinks(mr) {
  return (mr.lines || []).some((line) =>
    (line.procurementLinks || []).some((link) => link.rmPoLine?.rmPo?.status !== "CANCELLED") ||
    (line.purchaseRequestSourceLinks || []).some((source) =>
      (source.purchaseRequestLine?.poLinks || []).some((link) => link.rmPoLine?.rmPo?.status !== "CANCELLED"),
    ),
  );
}

function latestRowFirst(a, b) {
  const at = new Date(a.updatedAt || a.createdAt || 0).getTime();
  const bt = new Date(b.updatedAt || b.createdAt || 0).getTime();
  if (at !== bt) return bt - at;
  return b.id - a.id;
}

async function main() {
  const salesOrderRef = argValue("sales-order", "SO-26-0001");
  const dryRun = process.argv.includes("--dry-run");

  const so = await prisma.salesOrder.findFirst({
    where: {
      OR: [
        { docNo: salesOrderRef },
        Number.isFinite(Number(salesOrderRef)) ? { id: Number(salesOrderRef) } : null,
      ].filter(Boolean),
    },
    include: { lines: { include: { item: true } } },
  });
  if (!so) throw new Error(`Sales order not found: ${salesOrderRef}`);

  const { fgLines } = await computeFgGapLinesForSalesOrder(so, prisma);
  const primaryFgLine = fgLines.find((f) => !f.note && Number(f.plannedProductionQty ?? 0) > 0) ?? fgLines.find((f) => !f.note) ?? null;
  const readiness = await evaluateWoPrepareReadiness(so.id, { fgLines }, prisma);
  const shortageLines = readiness.rmSummary.filter((r) => Number(r.shortageQty) > 0).map((r) => ({
    rmItemId: r.rmItemId,
    requiredQty: r.requiredQty,
    shortageQty: r.shortageQty,
    availableQtySnapshot: r.availableQty,
    unitSnapshot: r.unit,
  }));
  if (!primaryFgLine) throw new Error(`No FG line found for sales order ${so.docNo}`);
  if (!shortageLines.length) throw new Error(`No shortage lines found for sales order ${so.docNo}`);

  const rows = await prisma.materialRequirement.findMany({
    where: { salesOrderId: so.id, sourceType: "WORK_ORDER_PLANNING", status: { not: "CANCELLED" } },
    include: {
      lines: {
        include: {
          procurementLinks: {
            include: { rmPoLine: { include: { rmPo: { select: { id: true, status: true } } } } },
          },
          purchaseRequestSourceLinks: {
            include: {
              purchaseRequestLine: {
                include: {
                  purchaseRequest: { select: { id: true, status: true, docNo: true } },
                  poLinks: {
                    include: { rmPoLine: { include: { rmPo: { select: { id: true, status: true } } } } },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });

  const linked = rows.filter(hasProcurementLinks);
  const unlinked = rows.filter((mr) => !hasProcurementLinks(mr));
  const canonical = unlinked[0] ?? linked[0] ?? null;
  if (!canonical) throw new Error(`No material requirements found for sales order ${so.docNo}`);

  const removed = [];
  const updated = [];

  const logPath = path.join(__dirname, `cleanup-regular-so-duplicate-mrs-${so.docNo}.json`);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const mr of unlinked) {
      if (mr.id === canonical.id) continue;
      if (dryRun) {
        removed.push({ id: mr.id, docNo: mr.docNo, from: mr.status, to: "CANCELLED" });
        continue;
      }
      await tx.materialRequirement.update({
        where: { id: mr.id },
        data: {
          status: "CANCELLED",
          closedAt: mr.closedAt ?? now,
          remarks: [mr.remarks, `Voided as duplicate cleanup for ${so.docNo}.`].filter(Boolean).join("\n"),
        },
      });
      removed.push({ id: mr.id, docNo: mr.docNo, from: mr.status, to: "CANCELLED" });
    }

    if (!dryRun) {
      await tx.materialRequirementLine.deleteMany({ where: { materialRequirementId: canonical.id } });
      await tx.materialRequirement.update({
        where: { id: canonical.id },
        data: {
          status: "PENDING_APPROVAL",
          fgItemId: primaryFgLine.fgItemId,
          plannedProductionQty: primaryFgLine.plannedProductionQty ?? primaryFgLine.rmPlanningQty ?? null,
          workOrderId: null,
          approvedByUserId: null,
          approvedAt: null,
          sentToPurchaseAt: null,
          closedAt: null,
          requisitionRemarks: `Clean active RM Requisition for ${so.docNo} / FG ${primaryFgLine.fgName || primaryFgLine.fgItemId}`,
          remarks: `Clean active RM Requisition for ${so.docNo}`,
        },
      });
      await tx.materialRequirementLine.createMany({
        data: shortageLines.map((row) => ({ materialRequirementId: canonical.id, ...row })),
      });
      updated.push({
        id: canonical.id,
        docNo: canonical.docNo,
        status: "PENDING_APPROVAL",
        fgItemId: primaryFgLine.fgItemId,
        plannedProductionQty: String(primaryFgLine.plannedProductionQty ?? primaryFgLine.rmPlanningQty ?? null),
      });
    }
  });

  const report = {
    salesOrder: { id: so.id, docNo: so.docNo },
    canonical: { id: canonical.id, docNo: canonical.docNo, status: canonical.status },
    removed,
    updated,
    linkedPreserved: linked.map((mr) => ({ id: mr.id, docNo: mr.docNo, status: mr.status })),
    dryRun,
  };

  fs.writeFileSync(logPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
