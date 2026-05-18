const { computeNoQtyCreateNextRsEligibilityResolved } = require("./noQtyCreateNextRsEligibility");

/**
 * NO_QTY rolling planning navigation hints (read-only).
 * Picks the next-cycle draft RS when present, else a later-cycle locked RS surfaced by create-next eligibility.
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number} salesOrderId
 * @param {number | null} evalCycleId
 * @returns {Promise<{ sheetId: number | null; cycleId: number | null }>}
 */
async function findNoQtyNextRollingRequirementSheetTarget(db, salesOrderId, evalCycleId) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) return { sheetId: null, cycleId: null };
  const cid = evalCycleId != null ? Number(evalCycleId) : null;
  if (!Number.isFinite(cid) || cid <= 0) return { sheetId: null, cycleId: null };

  const cur = await db.salesOrderCycle.findFirst({
    where: { id: cid, salesOrderId: soId },
    select: { id: true, cycleNo: true },
  });
  if (!cur) return { sheetId: null, cycleId: null };
  const curNo = Number(cur.cycleNo);
  if (!Number.isFinite(curNo)) return { sheetId: null, cycleId: null };

  const laterCycles = await db.salesOrderCycle.findMany({
    where: { salesOrderId: soId, cycleNo: { gt: curNo } },
    orderBy: { cycleNo: "asc" },
    select: { id: true },
  });
  for (const cy of laterCycles) {
    const draft = await db.requirementSheet.findFirst({
      where: { salesOrderId: soId, cycleId: cy.id, status: "DRAFT" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (draft?.id != null) {
      return { sheetId: Number(draft.id), cycleId: Number(cy.id) };
    }
  }

  const cr = await computeNoQtyCreateNextRsEligibilityResolved(db, soId);
  const existingId = cr?.existingNextRsId != null ? Number(cr.existingNextRsId) : null;
  if (Number.isFinite(existingId) && existingId > 0) {
    const sh = await db.requirementSheet.findUnique({
      where: { id: existingId },
      select: { cycleId: true },
    });
    const nextCyc = sh?.cycleId != null ? Number(sh.cycleId) : null;
    return { sheetId: existingId, cycleId: Number.isFinite(nextCyc) && nextCyc > 0 ? nextCyc : null };
  }

  return { sheetId: null, cycleId: null };
}

module.exports = { findNoQtyNextRollingRequirementSheetTarget };
