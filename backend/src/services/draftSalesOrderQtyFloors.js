/**
 * Draft sales order line quantity floor validation (pure).
 * PUT /sales-orders/:id and PATCH /sales-orders/:id/lines sum proposed qty per itemId
 * against max(net dispatched, WO planned, produced) for that item on the order.
 *
 * Line removal on draft SOs: after a line is deleted, remaining lines’ total per itemId is validated
 * here (SO+item aggregate). Per-line dispatch attribution must still be zero before delete (FIFO).
 */

const { STOCK_EPS: DEFAULT_EPS } = require("./transactionalIntegrityGuards");

/**
 * @param {object} p
 * @param {{ id: number, itemId: number, qty: number }[]} p.lines
 * @param {Map<number, number>} p.proposedQtyByLineId
 * @param {Iterable<number>} p.itemIdsToValidate
 * @param {Map<number, number>} p.netDispatchedByItemId
 * @param {Map<number, number>} p.woPlannedByItemId
 * @param {Map<number, number>} p.producedByItemId
 * @param {number} [p.eps]
 * @returns {{ itemId: number, floor: number, totalProposed: number, dispatched: number, woPlanned: number, produced: number }[]}
 */
function getDraftSoItemQtyFloorViolations(p) {
  const eps = p.eps ?? DEFAULT_EPS;
  const proposedQtyByLineId = p.proposedQtyByLineId;
  const lines = p.lines ?? [];
  const violations = [];
  for (const itemId of p.itemIdsToValidate) {
    const dispatched = p.netDispatchedByItemId.get(itemId) ?? 0;
    const woPlanned = p.woPlannedByItemId.get(itemId) ?? 0;
    const produced = p.producedByItemId.get(itemId) ?? 0;
    const floor = Math.max(dispatched, woPlanned, produced);
    const totalProposed = lines
      .filter((l) => l.itemId === itemId)
      .reduce((s, l) => s + (proposedQtyByLineId.get(l.id) ?? Number(l.qty)), 0);
    if (totalProposed < floor - eps) {
      violations.push({ itemId, floor, totalProposed, dispatched, woPlanned, produced });
    }
  }
  return violations;
}

/**
 * @param {{ dispatched: number, woPlanned: number, produced: number, floor: number }} v
 */
function formatDraftSoFloorViolationMessage(v) {
  return (
    `Total quantity for this finished good on the order cannot go below what is already committed ` +
    `(dispatched ${v.dispatched}, planned on work orders ${v.woPlanned}, produced ${v.produced}). ` +
    `Minimum total for this item: ${v.floor}.`
  );
}

module.exports = {
  getDraftSoItemQtyFloorViolations,
  formatDraftSoFloorViolationMessage,
};
