const { mapSoLinesToDispatchFifoInputs } = require("./regularSoBufferQty");

/**
 * Sales order line vs dispatch reconciliation.
 *
 * Dispatch is stored at SO + itemId only. When multiple SO lines share the same itemId,
 * attributing net dispatched FIFO by SalesOrderLine.id (oldest first) keeps per-line
 * remaining/pending consistent with a single global net dispatch total for that item.
 *
 * Allocation modes:
 * - **operational**: forward UNLOCKED + LOCKED + reversal rows — used for caps, QC pool,
 *   line remaining, and dispatchable (draft qty reserves SO/QC capacity before lock).
 * - **confirmed**: LOCKED forward + reversal rows only — excludes draft UNLOCKED forwards;
 *   used for "confirmed shipped" stats and work-order tracking dispatch attribution.
 */

/** @typedef {'operational' | 'confirmed'} DispatchAllocMode */

const DISPATCH_ALLOC_MODE = {
  OPERATIONAL: "operational",
  CONFIRMED: "confirmed",
};

/**
 * @param {{ reversalOfId?: number | null }} d
 */
function isDispatchReversalRow(d) {
  return d.reversalOfId != null;
}

/**
 * Forward row not yet locked (draft — no stock movement yet).
 * @param {{ reversalOfId?: number | null; workflowStatus?: string | null }} d
 */
function isForwardUnlocked(d) {
  return d.reversalOfId == null && d.workflowStatus === "UNLOCKED";
}

/**
 * Rows that count toward "confirmed" net dispatch (locked forward + all reversals).
 * @param {{ reversalOfId?: number | null; workflowStatus?: string | null }} d
 */
function isConfirmedDispatchRow(d) {
  if (isDispatchReversalRow(d)) return true;
  return !isForwardUnlocked(d);
}

/**
 * @param {{ itemId: number; dispatchedQty: unknown }[] | null | undefined} dispatchRecords
 * @param {DispatchAllocMode} mode
 */
function filterDispatchRecordsForMode(dispatchRecords, mode) {
  if (mode === DISPATCH_ALLOC_MODE.CONFIRMED) {
    return (dispatchRecords || []).filter(isConfirmedDispatchRow);
  }
  return dispatchRecords || [];
}

/**
 * @param {{ itemId: number; dispatchedQty: unknown }[]} dispatchRecords
 * @param {DispatchAllocMode} [mode] — default operational (all forward + reversal rows)
 * @returns {Map<number, number>} itemId -> sum(dispatchedQty) including reversal negatives
 */
function netDispatchedByItemId(dispatchRecords, mode = DISPATCH_ALLOC_MODE.OPERATIONAL) {
  const filtered = filterDispatchRecordsForMode(dispatchRecords, mode);
  const m = new Map();
  for (const d of filtered) {
    const id = d.itemId;
    m.set(id, (m.get(id) ?? 0) + Number(d.dispatchedQty));
  }
  return m;
}

/**
 * @param {{ id: number; itemId: number; qty: number }[]} lines
 * @param {{ itemId: number; dispatchedQty: unknown; reversalOfId?: number | null; workflowStatus?: string | null }[]} dispatchRecords
 * @param {DispatchAllocMode} [mode]
 * @returns {Map<number, number>} salesOrderLineId -> dispatched qty attributed to that line
 */
function allocateDispatchAcrossSalesOrderLines(lines, dispatchRecords, mode = DISPATCH_ALLOC_MODE.OPERATIONAL) {
  const filtered = filterDispatchRecordsForMode(dispatchRecords, mode);
  const byItem = new Map();
  for (const l of lines) {
    if (!byItem.has(l.itemId)) byItem.set(l.itemId, []);
    byItem.get(l.itemId).push(l);
  }
  for (const arr of byItem.values()) {
    arr.sort((a, b) => a.id - b.id);
  }

  const out = new Map();
  for (const l of lines) {
    out.set(l.id, 0);
  }

  const netByItem = netDispatchedByItemId(filtered, mode);
  for (const [itemId, rawNet] of netByItem) {
    const group = byItem.get(itemId);
    if (!group?.length) continue;
    let rem = rawNet;
    for (const l of group) {
      const ord = Number(l.qty);
      const take = Math.min(Math.max(0, rem), ord);
      out.set(l.id, take);
      rem -= take;
    }
  }
  return out;
}

/**
 * Remaining dispatch capacity for an item on the SO (sum over lines with that itemId).
 * Uses operational mode (includes draft forwards).
 * @param {{ id: number; itemId: number; qty: number }[]} allSoLines
 * @param {{ itemId: number; dispatchedQty: unknown }[]} dispatchRecords
 * @param {number} itemId
 */
function remainingDispatchCapacityForSoItem(allSoLines, dispatchRecords, itemId) {
  const alloc = allocateDispatchAcrossSalesOrderLines(allSoLines, dispatchRecords, DISPATCH_ALLOC_MODE.OPERATIONAL);
  let sum = 0;
  for (const l of allSoLines) {
    if (l.itemId !== itemId) continue;
    const a = alloc.get(l.id) ?? 0;
    sum += Math.max(0, Number(l.qty) - a);
  }
  return sum;
}

/**
 * FIFO-attributed dispatch for one sales order line (same rules as dispatch UI / backlog).
 * Default operational allocation.
 *
 * @param {{ id: number; itemId: number; qty: number | string | import("@prisma/client").Decimal }[]} lines
 * @param {{ itemId: number; dispatchedQty: unknown }[]} dispatchRecords
 * @param {number} salesOrderLineId
 * @param {string | null | undefined} [orderType] — when set, NORMAL uses customerPoQty for FIFO caps
 */
function getAttributedDispatchQtyForSalesOrderLine(lines, dispatchRecords, salesOrderLineId, orderType) {
  const lineInputs =
    orderType != null && orderType !== undefined
      ? mapSoLinesToDispatchFifoInputs(lines, orderType)
      : (lines ?? []).map((l) => ({
          id: l.id,
          itemId: l.itemId,
          qty: Number(l.qty),
        }));
  const alloc = allocateDispatchAcrossSalesOrderLines(lineInputs, dispatchRecords ?? [], DISPATCH_ALLOC_MODE.OPERATIONAL);
  return alloc.get(salesOrderLineId) ?? 0;
}

module.exports = {
  DISPATCH_ALLOC_MODE,
  isConfirmedDispatchRow,
  isForwardUnlocked,
  netDispatchedByItemId,
  allocateDispatchAcrossSalesOrderLines,
  remainingDispatchCapacityForSoItem,
  getAttributedDispatchQtyForSalesOrderLine,
};
