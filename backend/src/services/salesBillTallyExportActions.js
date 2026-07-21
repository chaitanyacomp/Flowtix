const { mapSalesBillToTallyExportPayload } = require("./salesBillTallyExportPayload");
const { buildSalesBillTallyXml, buildSalesBillTallyBulkXml } = require("./salesBillTallyXml");
const { assessSalesBillTallyExportReadiness } = require("./salesBillTallyExportReadiness");
const { loadCompanyStateForTallyExport, logSalesBillExportFailureOnce } = require("./salesBillTallyExportSupport");
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
    include: {
      item: {
        include: {
          unitRef: { select: { unitName: true, unitCode: true, tallyName: true, tallyGuid: true } },
        },
      },
    },
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
  const readiness = assessSalesBillTallyExportReadiness(payload);
  if (!readiness.ready && readiness.primaryIssue?.message) {
    return readiness.primaryIssue.message;
  }
  return null;
}

function safeTallyFilename(bill) {
  const safeNo = String(bill.billNo || `SB-${bill.id}`).replace(/[^\w\-\.]+/g, "-");
  return `sales-bill-${safeNo}.xml`;
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
  const companyState = await loadCompanyStateForTallyExport(prisma);
  const payload = mapSalesBillToTallyExportPayload({ bill, companyState });
  return { bill, payload };
}

async function logExportFailure({ user, bill, errMsg }) {
  await logSalesBillExportFailureOnce({ user, bill, errMsg });
}

async function logBulkXmlGenerated(tx, bill, filename, actor) {
  const sbDocOk = displaySalesBillNo(bill.id, bill.billNo, bill.docNo);
  await logActivity({
    user: actor?.user ?? actor,
    module: ACTIVITY_MODULES.SALES_BILL,
    entityType: ACTIVITY_ENTITY_TYPES.SALES_BILL,
    entityId: bill.id,
    docNo: sbDocOk,
    action: ACTIVITY_ACTIONS.EXPORTED,
    message: `Sales Bill ${sbDocOk} Tally XML generated (bulk) — confirmation pending`,
    metadata: {
      fileName: filename,
      dispatchIds: bill.dispatchId != null ? [bill.dispatchId] : undefined,
      bulk: true,
      exportLifecycle: "GENERATED",
    },
  });
  if (actor?.userId) {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `SALES_BILL:${bill.id}`,
      actorUserId: actor.userId,
      actorRole: actor.role,
      summary: `Sales bill ${bill.billNo || `SB-${bill.id}`} Tally XML generated (bulk) — not marked exported until Tally confirmation`,
      payload: {
        module: "REPORTS",
        actionLabel: "GENERATE",
        ref: { type: "TALLY_EXPORT", id: String(bill.id), no: filename },
        snapshot: {
          salesBillId: bill.id,
          dispatchId: bill.dispatchId ?? null,
          fileName: filename,
          bulk: true,
          exportLifecycle: "GENERATED",
        },
      },
    });
  }
}

/**
 * Bulk export: validate all bills first, then return combined voucher-only XML.
 * Does not mark bills exported — confirm after Tally accepts the import.
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
      const err = new Error(`${sbDoc} has already been confirmed exported. Reset export to generate XML again.`);
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
  let xml;
  try {
    xml =
      payloads.length === 1 ? buildSalesBillTallyXml(payloads[0]) : buildSalesBillTallyBulkXml(payloads);
  } catch (buildErr) {
    const msg = buildErr instanceof Error ? buildErr.message : "Tally XML generation failed.";
    for (const { bill } of prepared) {
      await logExportFailure({ user: actor?.user ?? actor, bill, errMsg: msg });
    }
    const err = new Error(msg);
    err.statusCode = 400;
    throw err;
  }
  const filename =
    payloads.length === 1
      ? safeTallyFilename(prepared[0].bill)
      : `sales-bills-tally-${payloads.length}-bills.xml`;

  await prisma.$transaction(async (tx) => {
    for (const { bill } of prepared) {
      const perFile = payloads.length === 1 ? filename : safeTallyFilename(bill);
      await logBulkXmlGenerated(tx, bill, perFile, actor);
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
