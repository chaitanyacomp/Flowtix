/**
 * Regular (NORMAL) sales order line quantities.
 * Customer PO qty is the commercial commitment; line.qty matches it (no SO-level production buffer).
 * Optional rejection buffer is applied only at work-order planning, not on the sales order.
 * Dispatch FIFO and caps use {@link dispatchFifoQtyForSoLine} / {@link mapSoLinesToDispatchFifoInputs} only for NORMAL.
 */

/**
 * @param {number|string|import("@prisma/client").Decimal|null|undefined} customerPoQty
 * @param {number|string|import("@prisma/client").Decimal|null|undefined} bufferPercent
 * @returns {number}
 */
function computePlannedQtyFromCustomerBuffer(customerPoQty, bufferPercent) {
  const c = Number(customerPoQty);
  const b = Number(bufferPercent);
  if (!Number.isFinite(c) || c <= 0) return 0;
  if (!Number.isFinite(b) || b <= 0) return c;
  const planned = c + (c * b) / 100;
  return planned;
}

/**
 * Per-line qty used for SO-line FIFO dispatch allocation and remaining customer commitment.
 * REPLACEMENT / NO_QTY: {@link line.qty} is the dispatch/planning basis.
 * NORMAL (and legacy regular rows where orderType is null): use {@link line.customerPoQty} when set — never planned {@link line.qty}.
 * @param {{ qty?: unknown; customerPoQty?: unknown }} line
 * @param {string | null | undefined} orderType
 */
function dispatchFifoQtyForSoLine(line, orderType) {
  if (orderType === "REPLACEMENT" || orderType === "NO_QTY") {
    return Math.max(0, Number(line.qty) || 0);
  }
  const cp = line.customerPoQty;
  if (cp != null && cp !== undefined && String(cp).trim() !== "") {
    const v = Number(cp);
    if (Number.isFinite(v)) return Math.max(0, v);
  }
  return Math.max(0, Number(line.qty) || 0);
}

/**
 * @param {Array<{ id: number; itemId: number; qty?: unknown; customerPoQty?: unknown }>} lines
 * @param {string | null | undefined} orderType
 * @returns {{ id: number; itemId: number; qty: number }[]}
 */
function mapSoLinesToDispatchFifoInputs(lines, orderType) {
  return (lines || []).map((l) => ({
    id: l.id,
    itemId: l.itemId,
    qty: dispatchFifoQtyForSoLine(l, orderType),
  }));
}

/**
 * Sum dispatch-relevant commitment per FG item (NORMAL uses customerPoQty).
 * @param {Array<{ itemId: number; qty?: unknown; customerPoQty?: unknown }>} lines
 * @param {string | null | undefined} orderType
 * @returns {Map<number, number>}
 */
function aggregateSoDispatchCommitmentQtyByItemId(lines, orderType) {
  const m = new Map();
  for (const l of lines || []) {
    const id = l.itemId;
    const q = dispatchFifoQtyForSoLine(l, orderType);
    m.set(id, (m.get(id) ?? 0) + q);
  }
  return m;
}

/**
 * @param {number|string|null|undefined} maxFromDb
 */
function clampMaxRegularSoBufferPercent(maxFromDb) {
  const v = Number(maxFromDb);
  if (!Number.isFinite(v) || v < 0) return 10;
  return Math.min(100, Math.max(0, v));
}

/**
 * Normalize draft SO line edit payload → persisted quantities.
 * @param {{ lineId?: number; qty?: unknown; customerPoQty?: unknown; bufferPercent?: unknown }} bodyLine
 * @param {string} orderType
 * @param {number} maxBufferPercent
 */
function normalizeSalesOrderDraftLineQuantities(bodyLine, orderType, maxBufferPercent) {
  const maxB = clampMaxRegularSoBufferPercent(maxBufferPercent);
  if (orderType === "NO_QTY") {
    return { customerPoQty: 0, bufferPercent: 0, plannedQty: 0 };
  }
  if (orderType === "REPLACEMENT") {
    const q = Number(bodyLine.qty != null ? bodyLine.qty : bodyLine.customerPoQty);
    if (!Number.isFinite(q) || q <= 0) {
      const err = new Error("Enter valid quantities for all lines.");
      err.statusCode = 400;
      throw err;
    }
    return { customerPoQty: q, bufferPercent: 0, plannedQty: q };
  }
  if (orderType === "NORMAL") {
    const cp = Number(bodyLine.customerPoQty != null ? bodyLine.customerPoQty : bodyLine.qty);
    if (!Number.isFinite(cp) || cp <= 0) {
      const err = new Error("Customer PO Qty must be greater than zero for each line.");
      err.statusCode = 400;
      throw err;
    }
    // SO stores pure customer commitment; WO planning may add optional buffer separately.
    return { customerPoQty: cp, bufferPercent: 0, plannedQty: cp };
  }
  const q = Number(bodyLine.qty);
  return { customerPoQty: q, bufferPercent: 0, plannedQty: q };
}

/**
 * Enforce customer PO qty against approved quotation lines for REGULAR from-quotation create.
 * Structural item/order matching is assumed to be checked by the caller when override lines are provided.
 * Duplicate itemIds are aggregated defensively before comparing to quoted totals.
 *
 * @param {Array<{ itemId: number; qty?: unknown }>} quotationLines
 * @param {Array<{ itemId: number; customerPoQty?: unknown }> | null | undefined} overrideLines
 *   When null/undefined, defaults use quotation qty (always within cap).
 */
function assertFromQuotationCustomerPoQuantities(quotationLines, overrideLines) {
  const qLines = quotationLines || [];
  if (!qLines.length) {
    const err = new Error("Quotation has no lines");
    err.statusCode = 400;
    err.code = "QUOTATION_HAS_NO_LINES";
    throw err;
  }

  if (overrideLines == null) return;

  if (overrideLines.length !== qLines.length) {
    const err = new Error("Line count must match the quotation.");
    err.statusCode = 400;
    err.code = "SO_LINE_COUNT_MISMATCH";
    throw err;
  }

  /** @type {Map<number, number>} */
  const quotedByItem = new Map();
  /** @type {Map<number, number>} */
  const enteredByItem = new Map();

  for (let i = 0; i < qLines.length; i += 1) {
    const qLine = qLines[i];
    const oLine = overrideLines[i];
    if (Number(qLine.itemId) !== Number(oLine.itemId)) {
      const err = new Error("Line itemId order must match the quotation.");
      err.statusCode = 400;
      err.code = "SO_LINE_ITEM_MISMATCH";
      throw err;
    }

    const quoted = Number(qLine.qty);
    const entered = Number(oLine.customerPoQty);
    if (!Number.isFinite(entered) || entered <= 0) {
      const err = new Error("Customer PO Qty must be greater than zero for each line.");
      err.statusCode = 400;
      err.code = "SO_CUSTOMER_PO_QTY_INVALID";
      throw err;
    }
    if (!Number.isFinite(quoted) || quoted < 0) {
      const err = new Error("Approved quotation line quantity is invalid.");
      err.statusCode = 400;
      err.code = "QUOTATION_LINE_QTY_INVALID";
      throw err;
    }

    if (entered > quoted) {
      const err = new Error(
        `Customer PO qty (${entered}) exceeds approved quotation qty (${quoted}) for this line.`,
      );
      err.statusCode = 422;
      err.code = "SO_QTY_EXCEEDS_QUOTATION";
      err.details = { itemId: Number(qLine.itemId), quotedQty: quoted, enteredQty: entered, lineIndex: i };
      throw err;
    }

    const itemId = Number(qLine.itemId);
    quotedByItem.set(itemId, (quotedByItem.get(itemId) ?? 0) + quoted);
    enteredByItem.set(itemId, (enteredByItem.get(itemId) ?? 0) + entered);
  }

  for (const [itemId, enteredSum] of enteredByItem) {
    const quotedSum = quotedByItem.get(itemId) ?? 0;
    if (enteredSum > quotedSum) {
      const err = new Error(
        `Customer PO qty (${enteredSum}) exceeds approved quotation qty (${quotedSum}) for item ${itemId}.`,
      );
      err.statusCode = 422;
      err.code = "SO_QTY_EXCEEDS_QUOTATION";
      err.details = { itemId, quotedQty: quotedSum, enteredQty: enteredSum };
      throw err;
    }
  }
}

module.exports = {
  computePlannedQtyFromCustomerBuffer,
  dispatchFifoQtyForSoLine,
  mapSoLinesToDispatchFifoInputs,
  aggregateSoDispatchCommitmentQtyByItemId,
  clampMaxRegularSoBufferPercent,
  normalizeSalesOrderDraftLineQuantities,
  assertFromQuotationCustomerPoQuantities,
};
