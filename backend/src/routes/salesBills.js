const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const auditLog = require("../services/auditLog");
const {
  listSalesBills,
  getEligibleDispatches,
  getEligibleDispatchesForSalesOrder,
  createDraftFromDispatch,
  createDraftFromSalesOrder,
  updateDraftAllocations,
  updateDraft,
  finalizeBill,
  cancelBill,
  deleteDraft,
  getSalesBillById,
  patchDraftSalesBillLineRate,
  getDraftShipToOptions,
  patchDraftShipTo,
  refreshDraftCustomerDetails,
  updateSalesBillPaymentTracking,
  addSalesBillReceipt,
  deleteSalesBillReceipt,
} = require("../services/salesBillService");
const {
  SALES_BILL_WRITE_ROLES,
  SALES_BILL_READ_ROLES,
  SALES_BILL_CANCEL_ROLES,
} = require("../constants/erpRoles");
const { mapSalesBillToTallyExportPayload } = require("../services/salesBillTallyExportPayload");
const { buildSalesBillTallyXml, buildSalesBillTallyMastersXml } = require("../services/salesBillTallyXml");
const { exportSalesBillsToTallyBulk } = require("../services/salesBillTallyExportActions");
const { assessSalesBillTallyExportReadiness } = require("../services/salesBillTallyExportReadiness");
const {
  loadCompanyStateForTallyExport,
  logSalesBillExportFailureOnce,
} = require("../services/salesBillTallyExportSupport");
const { logActivity } = require("../services/activityLogService");
const {
  ACTIVITY_MODULES,
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
} = require("../constants/activityLogConstants");
const { displaySalesBillNo } = require("../utils/docNoLabels");
const { assertAdminPassword, assertAnyAdminPassword } = require("../services/adminPasswordAuth");

const salesBillsRouter = express.Router();

const tallyExportBillInclude = {
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

const dateInput = z.union([z.string().min(1), z.number(), z.coerce.date()]);

function friendly400(message, extras = null) {
  if (extras && typeof extras === "object") {
    return { error: { message, ...extras } };
  }
  return { error: { message } };
}

function toNum(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function isNonEmptyStr(v) {
  return typeof v === "string" && v.trim() !== "";
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

  // NO_QTY: must be dispatch-derived (phase 1 bills are dispatch-wise).
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

function tallyExportErrorExtras(payload, errMsg) {
  const readiness = assessSalesBillTallyExportReadiness(payload);
  const issue =
    readiness.primaryIssue && readiness.primaryIssue.message === errMsg
      ? readiness.primaryIssue
      : readiness.issues.find((i) => i.message === errMsg) || null;
  return {
    code: issue?.code ?? null,
    action: issue?.action ?? null,
    tallyExportReadiness: {
      ready: readiness.ready,
      status: readiness.status,
      label: readiness.label,
      issues: readiness.issues,
      primaryIssue: readiness.primaryIssue,
      masterReferences: readiness.masterReferences,
      blockingMasterCount: readiness.blockingMasterCount,
    },
  };
}

const RE_EXPORT_AUTH_REQUIRED_MESSAGE =
  "This sales bill is already exported. Admin authorization is required for re-export.";

async function authorizeSalesBillReExportIfNeeded({ bill, adminPassword }) {
  if (!bill?.isExported) return { reExport: false, adminUserId: null };
  const password = typeof adminPassword === "string" ? adminPassword.trim() : "";
  if (!password) {
    const err = new Error(RE_EXPORT_AUTH_REQUIRED_MESSAGE);
    err.statusCode = 409;
    throw err;
  }
  try {
    const adminUserId = await assertAnyAdminPassword(prisma, { password });
    return { reExport: true, adminUserId };
  } catch (e) {
    const err = new Error("Invalid admin password.");
    err.statusCode = 401;
    throw err;
  }
}

async function exportSalesBillXmlResponse(req, res, { bill, adminPassword, dispatchId = null, viaDispatch = false }) {
  const { reExport, adminUserId } = await authorizeSalesBillReExportIfNeeded({ bill, adminPassword });

  const companyState = await loadCompanyStateForTallyExport(prisma);

  const payload = mapSalesBillToTallyExportPayload({ bill, companyState });
  const errMsg = validateTallyExportEligibility({ bill, payload });
  if (errMsg) {
    await logSalesBillExportFailureOnce({
      user: req.user,
      bill,
      errMsg,
      dispatchId,
      extras: { code: tallyExportErrorExtras(payload, errMsg).code },
    });
    return res.status(400).json(friendly400(errMsg, tallyExportErrorExtras(payload, errMsg)));
  }

  let xml;
  try {
    xml = buildSalesBillTallyXml(payload);
  } catch (buildErr) {
    const msg = buildErr instanceof Error ? buildErr.message : "Tally XML generation failed.";
    await logSalesBillExportFailureOnce({
      user: req.user,
      bill,
      errMsg: msg,
      dispatchId,
      extras: { code: tallyExportErrorExtras(payload, msg).code },
    });
    return res.status(400).json(friendly400(msg, tallyExportErrorExtras(payload, msg)));
  }
  const safeNo = String(bill.billNo || `SB-${bill.id}`).replace(/[^\w\-\.]+/g, "-");
  const filename = `sales-bill-${safeNo}.xml`;

  // Generating/downloading XML is not Tally acceptance — do not flip isExported here.
  // Confirm via POST /:id/confirm-tally-export after a successful Tally import response.
  const sbDocOk = displaySalesBillNo(bill.id, bill.billNo, bill.docNo);
  await logActivity({
    user: req.user,
    module: ACTIVITY_MODULES.SALES_BILL,
    entityType: ACTIVITY_ENTITY_TYPES.SALES_BILL,
    entityId: bill.id,
    docNo: sbDocOk,
    action: ACTIVITY_ACTIONS.EXPORTED,
    message: `Sales Bill ${sbDocOk} Tally XML generated${reExport ? " (re-download)" : ""} — confirmation pending`,
    metadata: {
      fileName: filename,
      dispatchIds: dispatchId != null ? [dispatchId] : bill.dispatchId != null ? [bill.dispatchId] : undefined,
      reExport,
      authorizedByAdminUserId: adminUserId,
      exportLifecycle: "GENERATED",
    },
  });
  if (req.user?.userId) {
    await auditLog.write(prisma, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `SALES_BILL:${bill.id}`,
      actorUserId: req.user.userId,
      actorRole: req.user.role,
      summary: `Sales bill ${bill.billNo || `SB-${bill.id}`} Tally XML generated${viaDispatch ? " (via dispatch)" : ""} — not marked exported until Tally confirmation`,
      payload: {
        module: "REPORTS",
        actionLabel: reExport ? "RE_DOWNLOAD" : "GENERATE",
        ref: { type: "TALLY_EXPORT", id: String(bill.id), no: filename },
        snapshot: {
          salesBillId: bill.id,
          dispatchId: dispatchId ?? bill.dispatchId ?? null,
          fileName: filename,
          reExport,
          authorizedByAdminUserId: adminUserId ?? null,
          exportLifecycle: "GENERATED",
        },
      },
    });
  }

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
  return res.status(200).send(xml);
}

salesBillsRouter.get("/", requireAuth, requireRole(SALES_BILL_READ_ROLES), async (req, res, next) => {
  try {
    const rows = await listSalesBills(prisma, req.query);
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.get("/eligible-dispatches", requireAuth, requireRole(SALES_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const rows = await getEligibleDispatches(prisma);
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.get("/sales-orders/:soId/eligible-dispatches", requireAuth, requireRole(SALES_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const rows = await getEligibleDispatchesForSalesOrder(prisma, Number(req.params.soId), Number(req.query.billId) || null);
    return res.json(rows);
  } catch (e) { return next(e); }
});

const allocationInput = z.object({ dispatchId: z.number().int().positive(), billNowQty: z.number().positive() });
const transportationInput = z.object({
  amount: z.number().nonnegative().default(0),
  chargedBy: z.enum(["OUR_COMPANY", "TRANSPORTER_DIRECTLY"]).default("OUR_COMPANY"),
  transporterName: z.string().max(256).optional().nullable(), referenceNo: z.string().max(128).optional().nullable(),
  remarks: z.string().max(4000).optional().nullable(),
}).default({ amount: 0, chargedBy: "OUR_COMPANY" });

salesBillsRouter.post("/from-sales-order", requireAuth, requireRole(SALES_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const body = z.object({ salesOrderId: z.number().int().positive(), billDate: dateInput.optional(),
      allocations: z.array(allocationInput).min(1), transportation: transportationInput.optional() }).parse(req.body ?? {});
    const selected = await getEligibleDispatchesForSalesOrder(prisma, body.salesOrderId);
    if (body.allocations.some((row) => !selected.some((d) => d.dispatchId === row.dispatchId))) {
      return res.status(409).json(friendly400("Every selected dispatch must belong to the selected Sales Order."));
    }
    const result = await createDraftFromSalesOrder(prisma, body, req.user?.userId ?? null);
    return res.status(201).json(result.bill);
  } catch (e) { return next(e); }
});

salesBillsRouter.put("/:id/allocations", requireAuth, requireRole(SALES_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const body = z.object({ allocations: z.array(allocationInput).min(1), transportation: transportationInput.optional() }).parse(req.body ?? {});
    const bill = await updateDraftAllocations(prisma, Number(req.params.id), body, req.user?.userId ?? null);
    return res.json(bill);
  } catch (e) { return next(e); }
});

/**
 * Bulk Tally XML export for finalized, not-yet-exported sales bills.
 * POST /api/sales-bills/export/tally-bulk
 * Body: { ids: number[] }
 * Returns a single combined XML attachment; marks each bill exported atomically.
 */
salesBillsRouter.post(
  "/export/tally-bulk",
  requireAuth,
  requireRole(SALES_BILL_WRITE_ROLES),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          ids: z.array(z.number().int().positive()).min(1, "Select at least one sales bill"),
        })
        .parse(req.body ?? {});

      const out = await exportSalesBillsToTallyBulk(prisma, body.ids, {
        userId: req.user?.userId,
        role: req.user?.role,
        user: req.user,
      });

      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=\"${out.filename}\"`);
      return res.status(200).send(out.xml);
    } catch (e) {
      return next(e);
    }
  },
);

salesBillsRouter.patch("/:id/lines/:lineId/rate", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const billId = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    const body = z.object({ rate: z.number().positive(), adminPassword: z.string().min(1) }).parse(req.body);
    await assertAdminPassword(prisma, { userId: req.user.userId, password: body.adminPassword });
    const updated = await patchDraftSalesBillLineRate(prisma, billId, lineId, body.rate);
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.patch("/:id/payment-tracking", requireAuth, requireRole(SALES_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const updated = await updateSalesBillPaymentTracking(prisma, id, req.body ?? {});
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.post("/:id/receipts", requireAuth, requireRole(SALES_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const updated = await addSalesBillReceipt(prisma, id, req.body ?? {}, {
      userId: req.user?.userId,
      role: req.user?.role,
    });
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.delete("/:id/receipts/:receiptId", requireAuth, requireRole(SALES_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const receiptId = Number(req.params.receiptId);
    const updated = await deleteSalesBillReceipt(prisma, id, receiptId, {
      role: req.user?.role,
      adminPassword: req.body?.adminPassword,
    });
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.get("/:id/ship-to-options", requireAuth, requireRole(SALES_BILL_READ_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const options = await getDraftShipToOptions(prisma, id);
    return res.json(options);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.patch("/:id/ship-to", requireAuth, requireRole(SALES_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const schema = z.object({
      shipToAddressId: z.number().int().positive(),
      confirmed: z.boolean().optional(),
      reason: z.string().max(4000).optional().nullable(),
    });
    const body = schema.parse(req.body);
    const updated = await patchDraftShipTo(prisma, id, body, { userId: req.user?.userId });
    const audit = updated._shipToAudit;
    delete updated._shipToAudit;

    const sbDoc = displaySalesBillNo(updated.id, updated.billNo, updated.docNo);
    await logActivity({
      user: req.user,
      module: ACTIVITY_MODULES.SALES_BILL,
      entityType: ACTIVITY_ENTITY_TYPES.SALES_BILL,
      entityId: updated.id,
      docNo: sbDoc,
      action: ACTIVITY_ACTIONS.UPDATED,
      subAction: "SHIP_TO_CHANGED",
      message: `Sales Bill ${sbDoc} Ship To updated`,
      reason: body.reason ?? null,
      metadata: audit
        ? {
            dispatchShipToLabel: audit.dispatchShipTo?.label,
            dispatchShipToStateCode: audit.dispatchShipTo?.stateCode,
            invoiceShipToLabel: audit.invoiceShipTo?.label,
            invoiceShipToStateCode: audit.invoiceShipTo?.stateCode,
            differsFromDispatch: audit.differsFromDispatch,
          }
        : undefined,
    });

    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.post("/:id/refresh-customer-details", requireAuth, requireRole(SALES_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const updated = await refreshDraftCustomerDetails(prisma, id, { userId: req.user?.userId });
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.get("/:id", requireAuth, requireRole(SALES_BILL_READ_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const bill = await getSalesBillById(prisma, id);
    const companyState = await loadCompanyStateForTallyExport(prisma);
    const payload = mapSalesBillToTallyExportPayload({ bill, companyState });
    const tallyExportReadiness = assessSalesBillTallyExportReadiness(payload);
    return res.json({ ...bill, tallyExportReadiness });
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.post("/from-dispatch/:dispatchId", requireAuth, requireRole(SALES_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const dispatchId = Number(req.params.dispatchId);
    const parsedBody = z.object({ billDate: dateInput.optional() }).safeParse(req.body ?? {});
    const billDate = parsedBody.success ? parsedBody.data.billDate : undefined;
    const { bill, created } = await createDraftFromDispatch(prisma, dispatchId, { billDate });
    if (created) {
      const sbDoc = displaySalesBillNo(bill.id, bill.billNo, bill.docNo);
      await logActivity({
        user: req.user,
        module: ACTIVITY_MODULES.SALES_BILL,
        entityType: ACTIVITY_ENTITY_TYPES.SALES_BILL,
        entityId: bill.id,
        docNo: sbDoc,
        action: ACTIVITY_ACTIONS.CREATED,
        message: `Sales Bill ${sbDoc} created`,
        metadata: {
          customerId: bill.customerId,
          customerName: bill.customerNameSnapshot || bill.customer?.name,
          dispatchIds: bill.dispatchId != null ? [bill.dispatchId] : undefined,
          totalAmount: bill.netAmount != null ? String(bill.netAmount) : undefined,
        },
      });
    }
    if (created && req.user?.userId) {
      await auditLog.write(prisma, {
        action: auditLog.AuditAction.CREATE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `SALES_BILL:${bill.id}`,
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        summary: `Sales bill ${bill.billNo || `SB-${bill.id}`} created from dispatch #${dispatchId}`,
        payload: {
          module: "ADMIN",
          actionLabel: "CREATE",
          ref: { type: "SALES_BILL", id: String(bill.id), no: bill.billNo || `SB-${bill.id}` },
          snapshot: { dispatchId, status: bill.status },
          status: { from: null, to: bill.status },
        },
      });
    }
    return res.status(created ? 201 : 200).json({ id: bill.id });
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.put("/:id", requireAuth, requireRole(SALES_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    // Dispatch-wise billing: line qty/rate are source-based and cannot be edited in phase 1.
    if (req.body && typeof req.body === "object" && "lines" in req.body) {
      return res.status(400).json(friendly400("Sales Bill line rate/qty cannot be edited. Edit the source (Sales Order) instead."));
    }
    const schema = z.object({
      billNo: z.string().max(128).optional().nullable(),
      billDate: dateInput,
      remarks: z.string().max(4000).optional().nullable(),
    });
    const body = schema.parse(req.body);
    const updated = await updateDraft(prisma, id, body);
    if (req.user?.userId) {
      await auditLog.write(prisma, {
        action: auditLog.AuditAction.UPDATE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `SALES_BILL:${id}`,
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        summary: `Sales bill ${updated.billNo || `SB-${id}`} updated`,
        payload: {
          module: "ADMIN",
          actionLabel: "UPDATE",
          ref: { type: "SALES_BILL", id: String(id), no: updated.billNo || `SB-${id}` },
        },
      });
    }
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.post("/:id/finalize", requireAuth, requireRole(SALES_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const finalized = await finalizeBill(prisma, id, req.user?.userId);
    const sbDoc = displaySalesBillNo(id, finalized.billNo, finalized.docNo);
    await logActivity({
      user: req.user,
      module: ACTIVITY_MODULES.SALES_BILL,
      entityType: ACTIVITY_ENTITY_TYPES.SALES_BILL,
      entityId: id,
      docNo: sbDoc,
      action: ACTIVITY_ACTIONS.FINALIZED,
      message: `Sales Bill ${sbDoc} finalized`,
      metadata: {
        customerId: finalized.customerId,
        customerName: finalized.customerNameSnapshot || finalized.customer?.name,
        dispatchIds: finalized.dispatchId != null ? [finalized.dispatchId] : undefined,
        totalAmount: finalized.netAmount != null ? String(finalized.netAmount) : undefined,
      },
    });
    if (req.user?.userId) {
      await auditLog.write(prisma, {
        action: auditLog.AuditAction.APPROVE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `SALES_BILL:${id}`,
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        summary: `Sales bill ${finalized.billNo || `SB-${id}`} finalized`,
        payload: {
          module: "ADMIN",
          actionLabel: "FINALIZE",
          ref: { type: "SALES_BILL", id: String(id), no: finalized.billNo || `SB-${id}` },
          status: { from: "DRAFT", to: "FINALIZED" },
        },
      });
    }
    return res.json({
      ...finalized,
      tallyExportReadiness: assessSalesBillTallyExportReadiness(
        mapSalesBillToTallyExportPayload({
          bill: finalized,
          companyState: await loadCompanyStateForTallyExport(prisma),
        }),
      ),
    });
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.post("/:id/cancel", requireAuth, requireRole(SALES_BILL_CANCEL_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = z.object({ reason: z.string().min(1), adminPassword: z.string().min(1).optional() }).parse(req.body);
    const bill = await prisma.salesBill.findUnique({ where: { id }, select: { id: true, isExported: true } });
    if (!bill) return res.status(404).json(friendly400("Sales bill not found."));
    if (bill.isExported) {
      if (req.user?.role !== "ADMIN") return res.status(409).json(friendly400("Cannot cancel: this sales bill has already been exported."));
      await assertAdminPassword(prisma, { userId: req.user?.userId, password: body.adminPassword });
    }
    const updated = await cancelBill(prisma, id, { reason: body.reason, userId: req.user?.userId });
    const reason = String(body.reason || "").trim();
    const sbDoc = displaySalesBillNo(id, updated.billNo, updated.docNo);
    await logActivity({
      user: req.user,
      module: ACTIVITY_MODULES.SALES_BILL,
      entityType: ACTIVITY_ENTITY_TYPES.SALES_BILL,
      entityId: id,
      docNo: sbDoc,
      action: ACTIVITY_ACTIONS.CANCELLED,
      message: `Sales Bill ${sbDoc} cancelled`,
      reason,
      metadata: {
        customerId: updated.customerId,
        customerName: updated.customerNameSnapshot || updated.customer?.name,
      },
    });
    if (req.user?.userId) {
      await auditLog.write(prisma, {
        action: auditLog.AuditAction.CANCEL,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `SALES_BILL:${id}`,
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        summary: `Sales bill ${updated.billNo || `SB-${id}`} cancelled`,
        reason: reason || null,
        payload: {
          module: "ADMIN",
          actionLabel: "CANCEL",
          ref: { type: "SALES_BILL", id: String(id), no: updated.billNo || `SB-${id}` },
          status: { from: "FINALIZED", to: "CANCELLED" },
        },
      });
    }
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.delete("/:id", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await deleteDraft(prisma, id);
    if (req.user?.userId) {
      await auditLog.write(prisma, {
        action: auditLog.AuditAction.DELETE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `SALES_BILL:${id}`,
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        summary: `Sales bill SB-${id} deleted (draft)`,
        payload: { module: "ADMIN", actionLabel: "DELETE", ref: { type: "SALES_BILL", id: String(id), no: `SB-${id}` } },
      });
    }
    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.get("/:id/export/tally.xml", requireAuth, requireRole(SALES_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid sales bill id"));

    const bill = await prisma.salesBill.findUnique({
      where: { id },
      include: tallyExportBillInclude,
    });
    if (!bill) return res.status(404).json(friendly400("Sales bill not found"));
    if (bill.isExported) {
      return res.status(409).json(friendly400(RE_EXPORT_AUTH_REQUIRED_MESSAGE));
    }

    const companyState = await loadCompanyStateForTallyExport(prisma);

    const payload = mapSalesBillToTallyExportPayload({ bill, companyState });
    const errMsg = validateTallyExportEligibility({ bill, payload });
    if (errMsg) {
      await logSalesBillExportFailureOnce({
        user: req.user,
        bill,
        errMsg,
        extras: { code: tallyExportErrorExtras(payload, errMsg).code },
      });
      return res.status(400).json(friendly400(errMsg, tallyExportErrorExtras(payload, errMsg)));
    }

    let xml;
    try {
      xml = buildSalesBillTallyXml(payload);
    } catch (buildErr) {
      const msg = buildErr instanceof Error ? buildErr.message : "Tally XML generation failed.";
      await logSalesBillExportFailureOnce({
        user: req.user,
        bill,
        errMsg: msg,
        extras: { code: tallyExportErrorExtras(payload, msg).code },
      });
      return res.status(400).json(friendly400(msg, tallyExportErrorExtras(payload, msg)));
    }
    const safeNo = String(bill.billNo || `SB-${bill.id}`).replace(/[^\w\-\.]+/g, "-");
    const filename = `sales-bill-${safeNo}.xml`;

    // Download generates voucher XML only — does not mark the bill exported.
    const sbDocOk = displaySalesBillNo(bill.id, bill.billNo, bill.docNo);
    await logActivity({
      user: req.user,
      module: ACTIVITY_MODULES.SALES_BILL,
      entityType: ACTIVITY_ENTITY_TYPES.SALES_BILL,
      entityId: bill.id,
      docNo: sbDocOk,
      action: ACTIVITY_ACTIONS.EXPORTED,
      message: `Sales Bill ${sbDocOk} Tally XML generated — confirmation pending`,
      metadata: { fileName: filename, dispatchIds: bill.dispatchId != null ? [bill.dispatchId] : undefined, exportLifecycle: "GENERATED" },
    });

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
    return res.status(200).send(xml);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.post("/:id/export/tally-masters.xml", requireAuth, requireRole(SALES_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid sales bill id"));

    const bill = await prisma.salesBill.findUnique({
      where: { id },
      include: tallyExportBillInclude,
    });
    if (!bill) return res.status(404).json(friendly400("Sales bill not found"));
    if (bill.status !== "FINALIZED") return res.status(400).json(friendly400("Only finalized Sales Bills can export masters."));

    const companyState = await loadCompanyStateForTallyExport(prisma);
    const payload = mapSalesBillToTallyExportPayload({ bill, companyState });
    let xml;
    try {
      xml = buildSalesBillTallyMastersXml(payload);
    } catch (buildErr) {
      const msg = buildErr instanceof Error ? buildErr.message : "Tally masters XML generation failed.";
      return res.status(400).json(friendly400(msg, tallyExportErrorExtras(payload, msg)));
    }
    const safeNo = String(bill.billNo || `SB-${bill.id}`).replace(/[^\w\-\.]+/g, "-");
    const filename = `sales-bill-${safeNo}-masters.xml`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
    return res.status(200).send(xml);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.post("/:id/confirm-tally-export", requireAuth, requireRole(SALES_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid sales bill id"));
    const bill = await prisma.salesBill.findUnique({ where: { id } });
    if (!bill) return res.status(404).json(friendly400("Sales bill not found"));
    if (bill.status !== "FINALIZED") return res.status(400).json(friendly400("Only finalized Sales Bills can be confirmed."));
    if (bill.isExported) return res.json(bill);

    const filename = bill.exportedFileName || `sales-bill-${String(bill.billNo || `SB-${bill.id}`).replace(/[^\w\-\.]+/g, "-")}.xml`;
    const updated = await prisma.salesBill.update({
      where: { id: bill.id },
      data: {
        isExported: true,
        exportedAt: new Date(),
        exportedFileName: filename,
        exportedById: req.user?.userId ?? null,
      },
    });
    const sbDocOk = displaySalesBillNo(bill.id, bill.billNo, bill.docNo);
    await logActivity({
      user: req.user,
      module: ACTIVITY_MODULES.SALES_BILL,
      entityType: ACTIVITY_ENTITY_TYPES.SALES_BILL,
      entityId: bill.id,
      docNo: sbDocOk,
      action: ACTIVITY_ACTIONS.EXPORTED,
      message: `Sales Bill ${sbDocOk} confirmed exported in Tally`,
      metadata: { fileName: filename, exportLifecycle: "ACCEPTED" },
    });
    return res.json(updated);
  } catch (e) {
    return next(e);
  }
});

const mapMasterBody = z.object({
  type: z.enum(["CUSTOMER", "ITEM", "UNIT", "SUPPLIER"]),
  erpId: z.number().int().positive(),
  tallyName: z.string().trim().min(1).max(255),
  tallyGuid: z.string().trim().max(64).optional().nullable(),
});

salesBillsRouter.post("/:id/tally-master-map", requireAuth, requireRole(SALES_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid sales bill id"));
    const parsed = mapMasterBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json(friendly400("Invalid master mapping payload."));

    const bill = await prisma.salesBill.findUnique({
      where: { id },
      include: { lines: { select: { itemId: true } }, customerId: true },
    });
    if (!bill) return res.status(404).json(friendly400("Sales bill not found"));

    const { type, erpId, tallyName, tallyGuid } = parsed.data;
    const identity = {
      tallyName,
      tallyGuid: tallyGuid?.trim() || null,
      tallyImportedAt: new Date(),
    };

    if (type === "CUSTOMER") {
      if (bill.customerId !== erpId) return res.status(400).json(friendly400("Customer is not on this Sales Bill."));
      await prisma.customer.update({ where: { id: erpId }, data: identity });
    } else if (type === "ITEM") {
      const onBill = bill.lines.some((l) => l.itemId === erpId);
      if (!onBill) return res.status(400).json(friendly400("Item is not on this Sales Bill."));
      await prisma.item.update({ where: { id: erpId }, data: identity });
    } else if (type === "UNIT") {
      await prisma.unit.update({ where: { id: erpId }, data: identity });
    } else if (type === "SUPPLIER") {
      await prisma.supplier.update({ where: { id: erpId }, data: identity });
    }

    const refreshed = await getSalesBillById(prisma, id);
    const companyState = await loadCompanyStateForTallyExport(prisma);
    const payload = mapSalesBillToTallyExportPayload({ bill: refreshed, companyState });
    const tallyExportReadiness = assessSalesBillTallyExportReadiness(payload);
    return res.json({ ...refreshed, tallyExportReadiness });
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.post("/:id/export/tally.xml", requireAuth, requireRole(SALES_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid sales bill id"));

    const body = z.object({ adminPassword: z.string().optional() }).parse(req.body ?? {});
    const bill = await prisma.salesBill.findUnique({
      where: { id },
      include: tallyExportBillInclude,
    });
    if (!bill) return res.status(404).json(friendly400("Sales bill not found"));

    return exportSalesBillXmlResponse(req, res, {
      bill,
      adminPassword: body.adminPassword,
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * Download Tally XML for an already-exported bill (does not flip export flags).
 * GET /api/sales-bills/:id/download/tally.xml
 */
salesBillsRouter.get("/:id/download/tally.xml", requireAuth, requireRole(SALES_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json(friendly400("Invalid sales bill id"));

    const bill = await prisma.salesBill.findUnique({
      where: { id },
      include: tallyExportBillInclude,
    });
    if (!bill) return res.status(404).json(friendly400("Sales bill not found"));
    if (!bill.isExported) return res.status(400).json(friendly400("This sales bill is not exported yet."));

    const companyState = await loadCompanyStateForTallyExport(prisma);

    const payload = mapSalesBillToTallyExportPayload({ bill, companyState });
    const errMsg = validateTallyExportEligibility({ bill, payload });
    if (errMsg) return res.status(400).json(friendly400(errMsg, tallyExportErrorExtras(payload, errMsg)));

    let xml;
    try {
      xml = buildSalesBillTallyXml(payload);
    } catch (buildErr) {
      const msg = buildErr instanceof Error ? buildErr.message : "Tally XML generation failed.";
      return res.status(400).json(friendly400(msg, tallyExportErrorExtras(payload, msg)));
    }
    const filename =
      (typeof bill.exportedFileName === "string" && bill.exportedFileName.trim() ? bill.exportedFileName.trim() : null) ??
      `sales-bill-${String(bill.billNo || `SB-${bill.id}`).replace(/[^\w\-\.]+/g, "-")}.xml`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
    return res.status(200).send(xml);
  } catch (e) {
    return next(e);
  }
});

salesBillsRouter.post("/:id/reset-export", requireAuth, requireRole(["ADMIN"]), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = z.object({ reason: z.string().min(1) }).parse(req.body);
    const reason = body.reason.trim();
    if (!reason) return res.status(400).json(friendly400("Reason is required."));
    const bill = await prisma.salesBill.findUnique({ where: { id } });
    if (!bill) return res.status(404).json(friendly400("Sales bill not found"));
    if (!bill.isExported) return res.status(400).json(friendly400("This sales bill is not exported."));
    await prisma.salesBill.update({
      where: { id },
      data: { isExported: false, exportResetAt: new Date(), exportResetReason: reason, exportResetById: req.user?.userId ?? null },
    });
    if (req.user?.userId) {
      await auditLog.write(prisma, {
        action: auditLog.AuditAction.UPDATE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `SALES_BILL:${id}`,
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        summary: `Sales bill SB-${id} export status reset`,
        reason,
        payload: { module: "ADMIN", actionLabel: "OVERRIDE", ref: { type: "SALES_BILL", id: String(id), no: `SB-${id}` } },
      });
    }
    return res.json({ message: "Export status reset. You can export this bill again." });
  } catch (e) {
    return next(e);
  }
});

/**
 * Export Sales Bill XML by dispatch id (dispatch-wise billing).
 * POST /api/sales-bills/:dispatchId/export-tally
 *
 * Creates the bill from dispatch if missing, finalizes if draft, then exports.
 */
salesBillsRouter.post("/:dispatchId/export-tally", requireAuth, requireRole(SALES_BILL_WRITE_ROLES), async (req, res, next) => {
  try {
    const dispatchId = Number(req.params.dispatchId);
    if (!Number.isFinite(dispatchId) || dispatchId <= 0) return res.status(400).json(friendly400("Invalid dispatch id"));
    const body = z.object({ adminPassword: z.string().optional() }).parse(req.body ?? {});

    // Must be a completed (locked) forward dispatch row.
    const dispatchRow = await prisma.dispatch.findUnique({
      where: { id: dispatchId },
      select: { id: true, workflowStatus: true, reversalOfId: true, dispatchedQty: true },
    });
    if (!dispatchRow) return res.status(404).json(friendly400("Dispatch not found"));
    if (dispatchRow.reversalOfId != null) return res.status(409).json(friendly400("Cannot export from a reversal dispatch row."));
    if (dispatchRow.workflowStatus !== "LOCKED") return res.status(409).json(friendly400("Only finalized (completed) dispatch can be exported."));
    if (!(Number(dispatchRow.dispatchedQty) > 0)) return res.status(409).json(friendly400("Dispatch quantity must be positive to export."));

    // Ensure bill exists (dispatch-wise) and is finalized.
    const { bill } = await createDraftFromDispatch(prisma, dispatchId);
    const ensured = bill.status === "DRAFT" ? await finalizeBill(prisma, bill.id, req.user?.userId) : bill;
    if (ensured.status !== "FINALIZED") return res.status(409).json(friendly400("Only finalized Sales Bills can be exported."));

    const fullBill = await prisma.salesBill.findUnique({
      where: { id: ensured.id },
      include: tallyExportBillInclude,
    });
    if (!fullBill) return res.status(404).json(friendly400("Sales bill not found"));
    return exportSalesBillXmlResponse(req, res, {
      bill: fullBill,
      adminPassword: body.adminPassword,
      dispatchId,
      viaDispatch: true,
    });
  } catch (e) {
    return next(e);
  }
});

module.exports = { salesBillsRouter };
