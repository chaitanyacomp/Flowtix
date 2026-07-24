const EPS = 1e-6;

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round3(value) {
  return Math.round(n(value) * 1000) / 1000;
}

function isActiveDraft(row) {
  return row?.reversalOfId == null && String(row?.workflowStatus) === "UNLOCKED" && n(row?.dispatchedQty) > EPS;
}

/**
 * Reservation ownership snapshot for one SO/item.
 * Draft reservations are logical commitments; they do not post stock until finalization.
 */
function resolveDispatchDraftReservation({
  dispatchId,
  itemId,
  requestedQty,
  physicalUsableQty,
  dispatchRows = [],
}) {
  let ownReservedQty = 0;
  let otherReservedQty = 0;
  for (const row of dispatchRows || []) {
    if (!isActiveDraft(row) || Number(row.itemId) !== Number(itemId)) continue;
    if (Number(row.id) === Number(dispatchId)) ownReservedQty += n(row.dispatchedQty);
    else otherReservedQty += n(row.dispatchedQty);
  }
  ownReservedQty = round3(ownReservedQty);
  otherReservedQty = round3(otherReservedQty);
  const physical = round3(Math.max(0, n(physicalUsableQty)));
  const unreservedQty = round3(Math.max(0, physical - ownReservedQty - otherReservedQty));
  // A reservation is ownership, not inventory creation. Legacy drift or a later
  // immutable movement can leave physical stock below the reserved quantity.
  const availableToThisDraftQty = round3(Math.min(physical, ownReservedQty + unreservedQty));
  const requested = round3(Math.max(0, n(requestedQty)));
  const incrementalQtyRequired = round3(Math.max(0, requested - ownReservedQty));
  const releasedQty = round3(Math.max(0, ownReservedQty - requested));
  return {
    ownReservedQty,
    otherReservedQty,
    unreservedQty,
    availableToThisDraftQty,
    requestedQty: requested,
    incrementalQtyRequired,
    releasedQty,
    allowed: requested <= availableToThisDraftQty + EPS,
  };
}

module.exports = {
  EPS,
  isActiveDraft,
  resolveDispatchDraftReservation,
};
