/**
 * Shared guard for open Production Report RM return rows awaiting Store receipt.
 */

const { qtyToNumber } = require("./rmPurchaseHelpers");
const { round3 } = require("./bomExplosionService");

function n(v) {
  return qtyToNumber(v);
}

function formatRmReturnPendingBlockMessage(rows, totalCount = rows.length) {
  if (!rows.length) {
    return totalCount > 0
      ? "RM Return Pending — waiting for Store to receive returned material."
      : null;
  }
  const detail = rows
    .map((p) => {
      const qty = round3(n(p.requestedQty));
      const unit = String(p.item?.unit ?? "").trim();
      const name = p.item?.itemName || "RM";
      return unit ? `${name} — ${qty} ${unit}` : `${name} — ${qty}`;
    })
    .join("; ");
  return `RM Return Pending — ${detail}. Waiting for Store to receive returned material.`;
}

async function assertNoOpenProductionRmReturnPending(db, workOrderId) {
  const model = db?.productionRmReturnPending;
  if (!model) return true;

  if (typeof model.findMany === "function") {
    const rows = await model.findMany({
      where: { workOrderId, status: "PENDING" },
      include: { item: { select: { itemName: true, unit: true } } },
      take: 5,
    });
    if (!rows.length) return true;
    const message = formatRmReturnPendingBlockMessage(rows);
    const err = new Error(message);
    err.statusCode = 409;
    err.code = "RM_RETURN_PENDING_STORE_ACK_REQUIRED";
    err.pendingReturnCount = rows.length;
    throw err;
  }

  if (typeof model.count === "function") {
    const count = await model.count({ where: { workOrderId, status: "PENDING" } });
    if (count <= 0) return true;
    const err = new Error(formatRmReturnPendingBlockMessage([], count));
    err.statusCode = 409;
    err.code = "RM_RETURN_PENDING_STORE_ACK_REQUIRED";
    err.pendingReturnCount = count;
    throw err;
  }

  return true;
}

module.exports = {
  assertNoOpenProductionRmReturnPending,
  formatRmReturnPendingBlockMessage,
};
