const { mapPurchaseBillToTallyExportPayload } = require("./purchaseBillTallyExportPayload");
const { buildPurchaseBillTallyXml, buildPurchaseBillTallyBulkXml } = require("./purchaseBillTallyXml");
const auditLog = require("./auditLog");
const { logActivity } = require("./activityLogService");
const {
  ACTIVITY_MODULES,
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
} = require("../constants/activityLogConstants");
const { displayPurchaseBillNo } = require("../utils/docNoLabels");

const billIncludeForTallyExport = {
  supplier: { include: { stateRef: { select: { id: true, stateName: true, stateCode: true } } } },
  grn: { select: { id: true, date: true } },
  lines: {
    orderBy: { id: "asc" },
    include: { item: { include: { unitRef: { select: { id: true, unitName: true } } } } },
  },
};

function isNonEmptyStr(v) {
  return typeof v === "string" && v.trim() !== "";
}

function toNum(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function validateTallyExportEligibility({ bill, payload }) {
  if (!bill) return "Purchase bill not found.";
  if (bill.status !== "FINALIZED") return "Only finalized purchase bills can be exported.";
  if (bill.status === "CANCELLED") return "Cancelled purchase bills cannot be exported.";
  if (bill.hasTemporaryTaxData) {
    return "Cannot export to Tally: bill contains temporary tax values from testing mode.";
  }
  if (!bill.supplier) return "Cannot export purchase bill because supplier is missing.";

  const supplierStateCode =
    (payload?.purchaseSource?.stateCode ?? null) ||
    (payload?.supplierStateCodeSnapshot ?? null) ||
    bill.purchaseSourceStateCodeSnapshot ||
    bill.supplierStateCodeSnapshot ||
    bill.supplier.stateCode ||
    bill.supplier.stateRef?.stateCode ||
    null;
  if (!isNonEmptyStr(supplierStateCode)) {
    return "Cannot export purchase bill because supplier state is missing.";
  }

  const lines = Array.isArray(bill.lines) ? bill.lines : [];
  if (!lines.length) return "Cannot export purchase bill because it has no line items.";
  for (const ln of lines) {
    const q = toNum(ln.qty);
    if (!Number.isFinite(q) || q <= 0) return "Purchase Bill has no valid quantity to export.";
    const r = toNum(ln.rate);
    if (!Number.isFinite(r) || r <= 0) return "Purchase Bill has no valid rate to export.";
    if (!isNonEmptyStr(ln.itemNameSnapshot) || !isNonEmptyStr(ln.hsnCodeSnapshot)) {
      return "Cannot export purchase bill because tax data is incomplete.";
    }
    if (String(ln.hsnCodeSnapshot || "").trim() === "0000") {
      return "Cannot export purchase bill because HSN is not valid for production export.";
    }
    const g = toNum(ln.gstRate);
    if (!Number.isFinite(g) || g < 0 || g > 100) {
      return "Cannot export purchase bill because tax data is incomplete.";
    }
    if (g <= 0) {
      return "Cannot export purchase bill because GST rate is not valid for production export.";
    }
  }

  const tax = payload?.tax ?? null;
  const net = toNum(tax?.totalAmount);
  if (!Number.isFinite(net) || net <= 0) {
    return "Cannot export purchase bill because totals are invalid.";
  }
  const distinctRates = Array.from(new Set(lines.map((l) => String(l?.gstRate ?? "").trim()).filter(Boolean)));
  if (distinctRates.length > 1) {
    return "Cannot export purchase bill because it contains multiple GST rates. Export currently supports single-rate bills only.";
  }
  return null;
}

function safeTallyFilename(bill) {
  const safeNo = String(bill.billNo || `PB-${bill.id}`).replace(/[^\w\-\.]+/g, "-");
  return `purchase-bill-${safeNo}.xml`;
}

async function loadCompanyState(prisma) {
  return prisma.appSetting.findUnique({
    where: { id: 1 },
    select: {
      companyGstin: true,
      companyState: true,
      companyStateRef: { select: { id: true, stateName: true, stateCode: true } },
    },
  });
}

async function preparePurchaseBillTallyExport(prisma, billId) {
  const bill = await prisma.purchaseBill.findUnique({
    where: { id: billId },
    include: billIncludeForTallyExport,
  });
  if (!bill) {
    const err = new Error("Purchase bill not found");
    err.statusCode = 404;
    throw err;
  }
  const companyState = await loadCompanyState(prisma);
  const payload = mapPurchaseBillToTallyExportPayload({ bill, companyState });
  return { bill, payload };
}

async function logExportFailure({ user, bill, errMsg }) {
  const pbDoc = displayPurchaseBillNo(bill.id, bill.billNo);
  await logActivity({
    user,
    module: ACTIVITY_MODULES.PURCHASE_BILL,
    entityType: ACTIVITY_ENTITY_TYPES.PURCHASE_BILL,
    entityId: bill.id,
    docNo: pbDoc,
    action: ACTIVITY_ACTIONS.EXPORT_FAILED,
    message: `Purchase Bill ${pbDoc} Tally export failed`,
    metadata: { error: String(errMsg).slice(0, 240) },
  });
}

async function markBillExported(tx, bill, filename, actor) {
  await tx.purchaseBill.update({
    where: { id: bill.id },
    data: {
      isExported: true,
      exportedAt: new Date(),
      exportedFileName: filename,
    },
  });
  const pbDocOk = displayPurchaseBillNo(bill.id, bill.billNo);
  await logActivity({
    user: actor?.user ?? actor,
    module: ACTIVITY_MODULES.PURCHASE_BILL,
    entityType: ACTIVITY_ENTITY_TYPES.PURCHASE_BILL,
    entityId: bill.id,
    docNo: pbDocOk,
    action: ACTIVITY_ACTIONS.EXPORTED,
    message: `Purchase Bill ${pbDocOk} exported to Tally`,
    metadata: { fileName: filename },
  });
  if (actor?.userId) {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `PURCHASE_BILL:${bill.id}`,
      actorUserId: actor.userId,
      actorRole: actor.role,
      summary: `Purchase bill ${bill.billNo || `PB-${bill.id}`} exported to Tally XML`,
      payload: {
        module: "REPORTS",
        actionLabel: "EXPORT",
        ref: { type: "TALLY_EXPORT", id: String(bill.id), no: filename },
        snapshot: { purchaseBillId: bill.id, fileName: filename },
      },
    });
  }
}

/**
 * Export one finalized, not-yet-exported purchase bill to Tally XML and mark exported.
 */
async function exportSinglePurchaseBillToTally(prisma, billId, actor = {}) {
  const { bill, payload } = await preparePurchaseBillTallyExport(prisma, billId);
  if (bill.isExported) {
    const err = new Error("This purchase bill has already been exported. Reset export to export again.");
    err.statusCode = 400;
    throw err;
  }
  const errMsg = validateTallyExportEligibility({ bill, payload });
  if (errMsg) {
    await logExportFailure({ user: actor, bill, errMsg });
    const err = new Error(errMsg);
    err.statusCode = 400;
    throw err;
  }
  const xml = buildPurchaseBillTallyXml(payload);
  const filename = safeTallyFilename(bill);
  await prisma.$transaction(async (tx) => {
    await markBillExported(tx, bill, filename, actor);
  });
  return { xml, filename, billIds: [bill.id] };
}

/**
 * Bulk export: validate all bills first, then mark all exported and return combined XML.
 */
async function exportPurchaseBillsToTallyBulk(prisma, rawIds, actor = {}) {
  const ids = [...new Set((rawIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) {
    const err = new Error("Select at least one purchase bill to export.");
    err.statusCode = 400;
    throw err;
  }

  const prepared = [];
  for (const id of ids) {
    const { bill, payload } = await preparePurchaseBillTallyExport(prisma, id);
    if (bill.status !== "FINALIZED" || bill.cancelledAt) {
      const pbDoc = displayPurchaseBillNo(bill.id, bill.billNo);
      const err = new Error(`${pbDoc} is not eligible for Tally export.`);
      err.statusCode = 400;
      throw err;
    }
    if (bill.isExported) {
      const pbDoc = displayPurchaseBillNo(bill.id, bill.billNo);
      const err = new Error(`${pbDoc} has already been exported.`);
      err.statusCode = 400;
      throw err;
    }
    const errMsg = validateTallyExportEligibility({ bill, payload });
    if (errMsg) {
      await logExportFailure({ user: actor, bill, errMsg });
      const pbDoc = displayPurchaseBillNo(bill.id, bill.billNo);
      const err = new Error(`${pbDoc}: ${errMsg}`);
      err.statusCode = 400;
      throw err;
    }
    prepared.push({ bill, payload });
  }

  const payloads = prepared.map((p) => p.payload);
  const xml =
    payloads.length === 1 ? buildPurchaseBillTallyXml(payloads[0]) : buildPurchaseBillTallyBulkXml(payloads);
  const filename =
    payloads.length === 1
      ? safeTallyFilename(prepared[0].bill)
      : `purchase-bills-tally-${payloads.length}-bills.xml`;

  await prisma.$transaction(async (tx) => {
    for (const { bill } of prepared) {
      const perFile = payloads.length === 1 ? filename : safeTallyFilename(bill);
      await markBillExported(tx, bill, perFile, actor);
    }
  });

  return { xml, filename, billIds: prepared.map((p) => p.bill.id), count: prepared.length };
}

module.exports = {
  validateTallyExportEligibility,
  exportSinglePurchaseBillToTally,
  exportPurchaseBillsToTallyBulk,
  preparePurchaseBillTallyExport,
};
