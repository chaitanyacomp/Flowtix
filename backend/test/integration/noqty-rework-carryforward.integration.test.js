/**
 * NO_QTY recovery closes shortage (rework / post-cycle approvals).
 *
 * Scenario:
 * - Cycle 2: planned 3000, original QC accepted 2900, rejected 100 → later recovered
 * - Cycle 3: planned 4000, cycle 3 RS embeds prior shortfall snapshot 100 (gross 4100)
 *   Recovery 100 becomes usable after Cycle 2 closes, and is dispatched in Cycle 3.
 *
 * Assertion:
 * - Carry-forward to Cycle 4 is 0 (shortfall map empty) because recovery counts toward Cycle 3 gross fulfillment.
 */
const { runIntegration } = require("./_integrationEnv");

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");

const d = runIntegration ? describe : describe.skip;

const { prisma } = require("../../src/utils/prisma");
const { loadNoQtyCarryForwardShortfallByItem } = require("../../src/routes/requirementSheets");

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

d("NO_QTY carry-forward closes after recovery", () => {
  /** @type {{ soId:number, itemId:number, c2:number, c3:number, c4:number }} */
  let ctx;

  before(async () => {
    await prisma.$queryRaw`SELECT 1`;

    const tag = `noqty_recovery_${Date.now()}`;
    const customer = await prisma.customer.create({ data: { name: `IntegCust_${tag}` } });
    const fg = await prisma.item.create({
      data: { itemName: `IntegFG_${tag}`, itemType: "FG", unit: "PCS", minStockLevel: "0" },
    });

    // Create NO_QTY sales order
    const so = await prisma.salesOrder.create({
      data: {
        customerId: customer.id,
        orderType: "NO_QTY",
        internalStatus: "IN_PROCESS",
        lines: { create: [{ itemId: fg.id, qty: "0", rate: "0" }] },
      },
      select: { id: true },
    });

    // Create 4 cycles (1..4). Cycle 4 is active.
    const c1 = await prisma.salesOrderCycle.create({
      data: { salesOrderId: so.id, cycleNo: 1, status: "CLOSED", closedAt: daysAgo(10) },
      select: { id: true },
    });
    const c2 = await prisma.salesOrderCycle.create({
      data: { salesOrderId: so.id, cycleNo: 2, status: "CLOSED", closedAt: daysAgo(7) },
      select: { id: true },
    });
    const c3 = await prisma.salesOrderCycle.create({
      data: { salesOrderId: so.id, cycleNo: 3, status: "CLOSED", closedAt: daysAgo(4) },
      select: { id: true },
    });
    const c4 = await prisma.salesOrderCycle.create({
      data: { salesOrderId: so.id, cycleNo: 4, status: "ACTIVE" },
      select: { id: true },
    });
    await prisma.salesOrder.update({ where: { id: so.id }, data: { currentCycleId: c4.id } });

    // Locked requirement sheets for cycles 1..3
    async function lockedRs(cycleId, periodKey, requirementQty, shortfallQtySnapshot) {
      const sh = await prisma.requirementSheet.create({
        data: {
          salesOrderId: so.id,
          cycleId,
          periodKey,
          version: 1,
          status: "LOCKED",
          lines: {
            create: [
              {
                itemId: fg.id,
                requirementQty: String(requirementQty),
                shortfallQtySnapshot: shortfallQtySnapshot != null ? String(shortfallQtySnapshot) : null,
              },
            ],
          },
        },
        select: { id: true },
      });
      return sh.id;
    }
    await lockedRs(c1.id, "2026-01", 10000, null);
    await lockedRs(c2.id, "2026-02", 3000, null);
    // Cycle 3 embeds carry-forward 100 (gross 4100)
    await lockedRs(c3.id, "2026-03", 4000, 100);

    // Work orders + production + QC accepted
    async function makeCycleQc(cycleId, acceptedQty) {
      const wo = await prisma.workOrder.create({
        data: { salesOrderId: so.id, cycleId, status: "APPROVED", docNo: `WO_${tag}_${cycleId}` },
        select: { id: true },
      });
      const wol = await prisma.workOrderLine.create({
        data: { workOrderId: wo.id, fgItemId: fg.id, plannedQty: "0", qty: "0" },
        select: { id: true },
      });
      const pe = await prisma.productionEntry.create({
        data: { workOrderLineId: wol.id, workflowStatus: "APPROVED", qty: "0" },
        select: { id: true },
      });
      await prisma.qcEntry.create({
        data: { productionId: pe.id, acceptedQty: String(acceptedQty), rejectedQty: "0" },
      });
      return { woId: wo.id };
    }
    await makeCycleQc(c1.id, 10000);
    const c2Wo = await makeCycleQc(c2.id, 2900);
    await makeCycleQc(c3.id, 4000);

    // Cycle 2 rejection disposition + recovery to usable AFTER cycle 2 close (post-cycle approval)
    const disp = await prisma.qcRejectedDisposition.create({
      data: {
        workOrderId: c2Wo.woId,
        itemId: fg.id,
        remainingQty: "100",
        status: "REWORK_READY_FOR_QC",
        phase: "FIRST_QC",
      },
      select: { id: true },
    });
    await prisma.stockTransaction.create({
      data: {
        itemId: fg.id,
        transactionType: "BUCKET_TRANSFER",
        refId: disp.id,
        qcRejectedDispositionId: disp.id,
        stockBucket: "USABLE",
        qtyIn: "100",
        qtyOut: "0",
        // after cycle 2 close → should count as post-cycle approval for cycle 3
        date: daysAgo(6),
      },
    });

    // Dispatch in cycle 3 includes recovered 100 (4100 total)
    await prisma.dispatch.create({
      data: { soId: so.id, itemId: fg.id, cycleId: c3.id, dispatchedQty: "4100", workflowStatus: "LOCKED" },
    });

    ctx = { soId: so.id, itemId: fg.id, c2: c2.id, c3: c3.id, c4: c4.id };
  });

  it("carry-forward shortfall for next cycle is 0", async () => {
    const r = await loadNoQtyCarryForwardShortfallByItem({ salesOrderId: ctx.soId, currentCycleId: ctx.c4 });
    assert.equal(r.shortfallByItem.size, 0);
  });
});

