const { mapSalesBillToTallyExportPayload } = require("./salesBillTallyExportPayload");
const { buildSalesBillTallyXml, buildSalesBillTallyBulkXml } = require("./salesBillTallyXml");
const auditLog = require("./auditLog");
const { logActivity } = require("./activityLogService");
const {
  ACTIVITY_MODULES,
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
} = require("../constants/activityLogConstants");
const { displaySalesBillNo } = require("../utils/docNoLabels");

const billIncludeForTallyExport = {
  customer: { include: { stateRef: true } },
  dispatch: { include: { salesOrder: true } },
  lines: {
    include: { item: { include: { unitRef: { select: { unitName: true } } } } },
    orderBy: { id: "asc" },
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
  if (!bill) return "Sales bill not found.";
  if (bill.status !== "FINALIZED") return "Only finalized Sales Bills can be exported.";
  if (!bill.customer) return "Cannot export sales bill because customer is missing.";
  const stateCode =
    payload?.placeOfSupply?.stateCode ??
    payload?.customer?.customerStateCode ??
    bill.customerStateCodeSnapshot ??
    bill.customer?.stateRef?.stateCode ??
    null;
  if (!isNonEmptyStr(stateCode)) return "Cannot export sales bill because customer state is missing.";
  const lines = Array.isArray(bill.lines) ? bill.lines : [];
  if (!lines.length) return "Cannot export sales bill because it has no line items.";
  for (const ln of lines) {
    const q = toNum(ln.qty);
    if (!Number.isFinite(q) || q <= 0) {
      return "Sales Bill has no valid quantity to export.";
    }
    const unit =
      (typeof ln.unitSnapshot === "string" && ln.unitSnapshot.trim()) ||
      (typeof ln.item?.unit === "string" && ln.item.unit.trim()) ||
      (typeof ln.item?.unitRef?.unitName === "string" && ln.item.unitRef.unitName.trim()) ||
      "";
    if (!unit) {
      return "Cannot export sales bill because line unit is missing.";
    }
    const r = toNum(ln.rate);
    if (!Number.isFinite(r) || r <= 0) {
      return "Cannot export sales bill because line rate is missing.";
    }
  }
  for (const ln of lines) {
    if (!isNonEmptyStr(ln.itemNameSnapshot) || !isNonEmptyStr(ln.hsnCodeSnapshot)) {
      return "Cannot export sales bill because tax data is incomplete.";
    }
    const g = toNum(ln.gstRate);
    if (!Number.isFinite(g) || g < 0 || g > 100) {
      return "Cannot export sales bill because tax data is incomplete.";
    }
  }
  const net = toNum(payload?.tax?.totalAmount);
  if (!Number.isFinite(net) || net <= 0) return "Cannot export sales bill because totals are invalid.";

  if (payload?.meta?.orderType === "NO_QTY") {
    if (!bill.dispatchId || !Number.isFinite(Number(bill.dispatchId))) {
      return "Billing quantity must be based on dispatch.";
    }
  }
  return null;
}

function safeTallyFilename(bill) {
  const safeNo = String(bill.billNo || `SB-${bill.id}`).replace(/[^\w\-\.]+/g, "-");
  return `sales-bill-${safeNo}.xml`;
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

async function prepareSalesBillTallyExport(prisma, billId) {
  const bill = await prisma.salesBill.findUnique({
    where: { id: billId },
    include: billIncludeForTallyExport,
  });
  if (!bill) {
    const err = new Error("Sales bill not found");
    err.statusCode = 404;
    throw err;
  }
  const companyState = await loadCompanyState(prisma);
  const payload = mapSalesBillToTallyExportPayload({ bill, companyState });
  return { bill, payload };
}

async function logExportFailure({ user, bill, errMsg }) {
  const sbDoc = displaySalesBillNo(bill.id, bill.billNo, bill.docNo);
  await logActivity({
    user,
    module: ACTIVITY_MODULES.SALES_BILL,
    entityType: ACTIVITY_ENTITY_TYPES.SALES_BILL,
    entityId: bill.id,
    docNo: sbDoc,
    action: ACTIVITY_ACTIONS.EXPORT_FAILED,
    message: `Sales Bill ${sbDoc} Tally export failed`,
    metadata: { error: String(errMsg).slice(0, 240) },
  });
}

async function markBillExported(tx, bill, filename, actor) {
  const flipResult = await tx.salesBill.updateMany({
    where: { id: bill.id, isExported: false },
    data: {
      isExported: true,
      exportedAt: new Date(),
      exportedFileName: filename,
      exportedById: actor?.userId ?? null,
    },
  });
  if (flipResult.count !== 1) {
    const sbDoc = displaySalesBillNo(bill.id, bill.billNo, bill.docNo);
    const err = new Error(`${sbDoc} was already exported. Refresh and try again.`);
    err.statusCode = 409;
    throw err;
  }

  const sbDocOk = displaySalesBillNo(bill.id, bill.billNo, bill.docNo);
  await logActivity({
    user: actor?.user ?? actor,
    module: ACTIVITY_MODULES.SALES_BILL,
    entityType: ACTIVITY_ENTITY_TYPES.SALES_BILL,
    entityId: bill.id,
    docNo: sbDocOk,
    action: ACTIVITY_ACTIONS.EXPORTED,
    message: `Sales Bill ${sbDocOk} exported to Tally`,
    metadata: {
      fileName: filename,
      dispatchIds: bill.dispatchId != null ? [bill.dispatchId] : undefined,
      bulk: true,
    },
  });
  if (actor?.userId) {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `SALES_BILL:${bill.id}`,
      actorUserId: actor.userId,
      actorRole: actor.role,
      summary: `Sales bill ${bill.billNo || `SB-${bill.id}`} exported to Tally XML`,
      payload: {
        module: "REPORTS",
        actionLabel: "EXPORT",
        ref: { type: "TALLY_EXPORT", id: String(bill.id), no: filename },
        snapshot: {
          salesBillId: bill.id,
          dispatchId: bill.dispatchId ?? null,
          fileName: filename,
          bulk: true,
        },
      },
    });
  }
}

/**
 * Bulk export: validate all bills first, then mark all exported and return combined XML.
 * Rejects already-exported bills (no silent re-export / duplicate flip).
 */
async function exportSalesBillsToTallyBulk(prisma, rawIds, actor = {}) {
  const ids = [...new Set((rawIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) {
    const err = new Error("Select at least one sales bill to export.");
    err.statusCode = 400;
    throw err;
  }

  const prepared = [];
  for (const id of ids) {
    const { bill, payload } = await prepareSalesBillTallyExport(prisma, id);
    if (bill.status !== "FINALIZED" || bill.cancelledAt) {
      const sbDoc = displaySalesBillNo(bill.id, bill.billNo, bill.docNo);
      const err = new Error(`${sbDoc} is not eligible for Tally export.`);
      err.statusCode = 400;
      throw err;
    }
    if (bill.isExported) {
      const sbDoc = displaySalesBillNo(bill.id, bill.billNo, bill.docNo);
      const err = new Error(`${sbDoc} has already been exported (XML already downloaded). Reset export to export again.`);
      err.statusCode = 400;
      throw err;
    }
    const errMsg = validateTallyExportEligibility({ bill, payload });
    if (errMsg) {
      await logExportFailure({ user: actor?.user ?? actor, bill, errMsg });
      const sbDoc = displaySalesBillNo(bill.id, bill.billNo, bill.docNo);
      const err = new Error(`${sbDoc}: ${errMsg}`);
      err.statusCode = 400;
      throw err;
    }
    prepared.push({ bill, payload });
  }

  const payloads = prepared.map((p) => p.payload);
  const xml =
    payloads.length === 1 ? buildSalesBillTallyXml(payloads[0]) : buildSalesBillTallyBulkXml(payloads);
  const filename =
    payloads.length === 1
      ? safeTallyFilename(prepared[0].bill)
      : `sales-bills-tally-${payloads.length}-bills.xml`;

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
  exportSalesBillsToTallyBulk,
  prepareSalesBillTallyExport,
  billIncludeForTallyExport,
};
