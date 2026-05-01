/**
 * Idempotent repair: backfill RM PO lines and headers from item/supplier masters.
 * Only fills null/blank/missing numeric snapshots; never overwrites valid stored values.
 * Line tax resolution uses relaxed fallbacks so repair always completes without throwing.
 * @module services/rmPoTaxRepair
 */

const { prisma } = require("../utils/prisma");
const {
  resolveLineTaxFromItem,
  computeLineAmount,
  resolveSupplierSnapshots,
} = require("./rmPoTaxFields");

function isBlankSnapshot(v) {
  return v == null || String(v).trim() === "";
}

/**
 * @returns {Promise<{ updatedLines: number; updatedPos: number; updatedSuppliers: number }>}
 */
async function repairRmPurchaseTaxData() {
  let updatedLines = 0;
  let updatedPos = 0;
  let updatedSuppliers = 0;

  const lines = await prisma.rmPurchaseOrderLine.findMany({
    include: { item: { include: { unitRef: { select: { unitName: true } } } } },
  });

  for (const line of lines) {
    const item = line.item;
    const needsUnit = isBlankSnapshot(line.unit);
    const needsHsn = isBlankSnapshot(line.hsn);
    const needsGst = line.gstRate == null || !Number.isFinite(Number(line.gstRate));
    const needsAmount = line.amount == null || !Number.isFinite(Number(line.amount));

    if (!needsUnit && !needsHsn && !needsGst && !needsAmount) continue;

    const resolved = resolveLineTaxFromItem(item, { relaxed: true });
    const patch = {};
    if (needsUnit) patch.unit = resolved.unit;
    if (needsHsn) patch.hsn = resolved.hsn;
    if (needsGst) patch.gstRate = String(resolved.gstRate);

    const q = Number(line.qty);
    const r = Number(line.rate);
    if (needsAmount && Number.isFinite(q) && Number.isFinite(r)) {
      patch.amount = String(computeLineAmount(q, r));
    }

    if (Object.keys(patch).length === 0) continue;

    await prisma.rmPurchaseOrderLine.update({
      where: { id: line.id },
      data: patch,
    });
    updatedLines += 1;
  }

  const pos = await prisma.rmPurchaseOrder.findMany({
    include: {
      supplier: { include: { stateRef: { select: { stateName: true, stateCode: true } } } },
    },
  });

  for (const po of pos) {
    const needsState = isBlankSnapshot(po.supplierStateSnapshot);
    const needsCode = isBlankSnapshot(po.supplierStateCodeSnapshot);
    if (!needsState && !needsCode) continue;

    const snap = resolveSupplierSnapshots(po.supplier, { relaxed: true });
    const data = {};
    if (needsState && snap.supplierStateSnapshot) data.supplierStateSnapshot = snap.supplierStateSnapshot;
    if (needsCode && snap.supplierStateCodeSnapshot) data.supplierStateCodeSnapshot = snap.supplierStateCodeSnapshot;

    if (Object.keys(data).length) {
      await prisma.rmPurchaseOrder.update({ where: { id: po.id }, data });
      updatedPos += 1;
    }
  }

  const suppliers = await prisma.supplier.findMany({
    include: { stateRef: { select: { stateName: true, stateCode: true } } },
  });

  for (const s of suppliers) {
    const patch = {};
    if (isBlankSnapshot(s.stateName) && s.stateRef?.stateName) patch.stateName = s.stateRef.stateName;
    if (isBlankSnapshot(s.stateCode) && s.stateRef?.stateCode) patch.stateCode = s.stateRef.stateCode;
    if (Object.keys(patch).length) {
      await prisma.supplier.update({ where: { id: s.id }, data: patch });
      updatedSuppliers += 1;
    }
  }

  return { updatedLines, updatedPos, updatedSuppliers };
}

module.exports = {
  repairRmPurchaseTaxData,
};
